(function(root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RemovalRegistry = factory();
})(typeof window !== "undefined" ? window : globalThis, function() {
  "use strict";

  var TREE_FORMAT = "epix-removal-merkle-v1";
  var MAX_RECORDS = 10000;
  var MAX_BYTES = 2 * 1024 * 1024;
  var REASONS = Object.freeze({scam: "Scam or phishing", malware: "Malware",
    abuse: "Abuse or exploitation", policy: "Policy violation",
    reinstated: "Reinstated"});
  var CHECKPOINT_FIELDS = ["treeFormat", "policyId", "authority", "root", "sequence", "entryCount", "issuedAt", "expiresAt"];
  var RECORD_FIELDS = ["removedKey", "policyId", "subjectKind", "action", "reasonCode", "decisionId", "revision", "authority"];
  var has = function(object, key) { return Object.prototype.hasOwnProperty.call(object, key); };
  var hexPattern = /^[0-9a-f]{64}$/;

  function fail(code) { throw new Error(code); }
  function exactFields(value, fields) {
    return !!value && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).length === fields.length && fields.every(function(field) { return has(value, field); });
  }
  function policyId(value) { return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value); }
  function integer(value, minimum) { return Number.isSafeInteger(value) && value >= minimum; }
  function seconds() { return Math.floor(Date.now() / 1000); }
  function utf8(value) {
    if (typeof value !== "string") fail("invalid_string");
    var out = [];
    for (var i = 0; i < value.length; i++) {
      var code = value.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        var low = value.charCodeAt(++i);
        if (!(low >= 0xdc00 && low <= 0xdfff)) fail("invalid_unicode");
        code = 0x10000 + ((code - 0xd800) << 10) + low - 0xdc00;
      } else if (code >= 0xdc00 && code <= 0xdfff) fail("invalid_unicode");
      if (code < 0x80) out.push(code);
      else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
      else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
      else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    }
    return new Uint8Array(out);
  }
  function concat(parts) {
    var size = parts.reduce(function(total, part) { return total + part.length; }, 0);
    var out = new Uint8Array(size), offset = 0;
    parts.forEach(function(part) { out.set(part, offset); offset += part.length; });
    return out;
  }
  // Every UTF-8 field is prefixed with its unsigned 32-bit big-endian byte
  // length. In hash encodings, numbers are canonical base-10 strings.
  function encodeFields(fields) {
    var parts = [];
    fields.forEach(function(field) {
      var bytes = utf8(field), length = bytes.length;
      parts.push(new Uint8Array([length >>> 24, length >>> 16, length >>> 8, length]));
      parts.push(bytes);
    });
    return concat(parts);
  }
  function toHex(bytes) { return Array.from(bytes).map(function(byte) { return byte.toString(16).padStart(2, "0"); }).join(""); }

  // SHA-256 compression and padding as specified in FIPS 180-4, sections
  // 5.1.1 and 6.2. No dynamic code, platform crypto, or external dependency.
  // The tests compare block boundaries, Unicode and binary inputs to Node.
  function hashBytes(input) {
    var bytes = typeof input === "string" ? utf8(input) : new Uint8Array(input);
    var length = bytes.length, padded = new Uint8Array(Math.ceil((length + 9) / 64) * 64);
    padded.set(bytes); padded[length] = 0x80;
    var view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
    view.setUint32(padded.length - 4, (length * 8) >>> 0);
    var constants = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    var state = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var words = new Int32Array(64);
    function rotate(word, count) { return (word >>> count) | (word << (32 - count)); }
    for (var offset = 0; offset < padded.length; offset += 64) {
      for (var i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
      for (i = 16; i < 64; i++) {
        var x = words[i - 15], y = words[i - 2];
        words[i] = (words[i - 16] + (rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3)) +
          words[i - 7] + (rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10))) | 0;
      }
      var a = state[0], b = state[1], c = state[2], d = state[3], e = state[4], f = state[5], g = state[6], h = state[7];
      for (i = 0; i < 64; i++) {
        var t1 = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + constants[i] + words[i]) | 0;
        var t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      [a,b,c,d,e,f,g,h].forEach(function(word, index) { state[index] = (state[index] + word) | 0; });
    }
    var result = new Uint8Array(32), resultView = new DataView(result.buffer);
    state.forEach(function(word, index) { resultView.setUint32(index * 4, word); });
    return result;
  }
  function sha256(bytes) { return toHex(hashBytes(bytes)); }

  // Same classic Bech32 epix + 20-byte address format as HubCommunity and
  // the node. Uppercase is equivalent; mixed case and bad checksums fail.
  function normalizeAddress(value) {
    if (typeof value !== "string") return null;
    value = value.trim();
    if (/^epix1/i.test(value)) {
      if (value !== value.toLowerCase() && value !== value.toUpperCase()) return null;
      value = value.toLowerCase();
      if (!/^epix1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(value)) return null;
      var alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l", expanded = [3,3,3,3,0,5,16,9,24];
      for (var i = 5; i < value.length; i++) expanded.push(alphabet.indexOf(value[i]));
      var check = 1, generators = [0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];
      expanded.forEach(function(part) {
        var top = check >>> 25;
        check = ((check & 0x1ffffff) << 5) ^ part;
        for (var bit = 0; bit < 5; bit++) if ((top >>> bit) & 1) check ^= generators[bit];
      });
      return check === 1 ? value : null;
    }
    // Legacy ZeroNet addresses are version-0 Base58Check, not case-folded.
    if (!/^1[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(value)) return null;
    var digits = [0], base58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    for (var position = 0; position < value.length; position++) {
      var carry = base58.indexOf(value[position]);
      for (var digit = 0; digit < digits.length; digit++) {
        carry += digits[digit] * 58; digits[digit] = carry & 255; carry >>>= 8;
      }
      while (carry) { digits.push(carry & 255); carry >>>= 8; }
    }
    var zeroes = 0;
    while (zeroes < value.length - 1 && value[zeroes] === "1") zeroes++;
    var decoded = new Uint8Array(zeroes + digits.length);
    decoded.set(digits.reverse(), zeroes);
    if (decoded.length !== 25 || decoded[0] !== 0) return null;
    var checksum = hashBytes(hashBytes(decoded.subarray(0, 21)));
    for (var j = 0; j < 4; j++) if (checksum[j] !== decoded[21 + j]) return null;
    return value;
  }

  function targetKey(policy, kind, subject) {
    if (!policyId(policy)) fail("invalid_policy");
    var fields = ["epix-removal-v1", policy, kind];
    if (kind === "address") {
      var address = normalizeAddress(subject);
      if (!address) fail("invalid_target");
      fields.push(address);
    } else if (kind === "item") {
      if (!exactFields(subject, ["address", "itemId"])) fail("invalid_target");
      var scope = normalizeAddress(subject.address), itemId = subject.itemId;
      if (!scope || typeof itemId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/.test(itemId) ||
        itemId.split("/").some(function(part) { return part === "" || part === "." || part === ".."; })) fail("invalid_target");
      fields.push(scope, itemId);
    } else if (kind === "content") {
      if (!exactFields(subject, ["algorithm", "digest"])) fail("invalid_target");
      var lengths = {sha256: 64, sha512: 128, "sha512-first256": 64};
      if (!has(lengths, subject.algorithm) || typeof subject.digest !== "string" ||
        subject.digest.length !== lengths[subject.algorithm] || !/^[0-9a-fA-F]+$/.test(subject.digest)) fail("invalid_target");
      fields.push(subject.algorithm, subject.digest.toLowerCase());
    } else fail("invalid_subject_kind");
    return sha256(encodeFields(fields));
  }
  function recordBytes(record) {
    return encodeFields(["epix-removal-record-v1", record.policyId, record.authority, record.removedKey,
      record.subjectKind, record.action, record.reasonCode, record.decisionId, String(record.revision)]);
  }
  function validateRecord(record, checkpoint) {
    if (!exactFields(record, RECORD_FIELDS) || typeof record.removedKey !== "string" || !hexPattern.test(record.removedKey) ||
      record.policyId !== checkpoint.policyId || record.authority !== checkpoint.authority ||
      ["address", "item", "content"].indexOf(record.subjectKind) === -1 ||
      !integer(record.revision, 1) || typeof record.decisionId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/.test(record.decisionId) || normalizeAddress(record.decisionId) || !has(REASONS, record.reasonCode) ||
      (record.action !== "remove" && record.action !== "reinstate") ||
      (record.action === "reinstate") !== (record.reasonCode === "reinstated")) fail("invalid_record");
  }
  function validateCheckpoint(checkpoint) {
    if (!exactFields(checkpoint, CHECKPOINT_FIELDS) || checkpoint.treeFormat !== TREE_FORMAT ||
      !policyId(checkpoint.policyId) || typeof checkpoint.authority !== "string" || !/^epix1/.test(checkpoint.authority) || normalizeAddress(checkpoint.authority) !== checkpoint.authority ||
      typeof checkpoint.root !== "string" || !hexPattern.test(checkpoint.root) || !integer(checkpoint.sequence, 1) ||
      !integer(checkpoint.entryCount, 0) || checkpoint.entryCount > MAX_RECORDS ||
      !integer(checkpoint.issuedAt, 0) || !integer(checkpoint.expiresAt, 0) ||
      (checkpoint.expiresAt !== 0 && checkpoint.expiresAt <= checkpoint.issuedAt)) fail("invalid_checkpoint");
  }
  // RFC 6962 tree shape: split at the largest power of two below n. Do not
  // duplicate an odd leaf. Leaves and inner nodes have different prefixes.
  function merkleRoot(records) {
    var leaves = records.map(function(record) { return hashBytes(concat([new Uint8Array([0]), recordBytes(record)])); });
    function tree(start, count) {
      if (count === 0) return hashBytes(new Uint8Array(0));
      if (count === 1) return leaves[start];
      var split = 1;
      while (split * 2 < count) split *= 2;
      return hashBytes(concat([new Uint8Array([1]), tree(start, split), tree(start + split, count - split)]));
    }
    return toHex(tree(0, leaves.length));
  }
  function checkpointMessage(checkpoint) {
    validateCheckpoint(checkpoint);
    // Stable textual form for optional independent checkpoint signing. The
    // current apps authenticate all fields through their signed root manifest.
    return JSON.stringify(["epix-removal-checkpoint-v1", checkpoint.treeFormat, checkpoint.policyId,
      checkpoint.authority, checkpoint.root, checkpoint.sequence, checkpoint.entryCount,
      checkpoint.issuedAt, checkpoint.expiresAt]);
  }
  function parseSnapshot(snapshot) {
    if (typeof snapshot === "string") {
      if (snapshot.length > MAX_BYTES) fail("snapshot_too_large");
      snapshot = JSON.parse(snapshot);
    }
    if (!exactFields(snapshot, ["version", "checkpoint", "records"]) || snapshot.version !== 1 ||
      !Array.isArray(snapshot.records) || snapshot.records.length > MAX_RECORDS) fail("invalid_snapshot");
    validateCheckpoint(snapshot.checkpoint);
    if (snapshot.records.length !== snapshot.checkpoint.entryCount) fail("incomplete_snapshot");
    var previous = "";
    snapshot.records.forEach(function(record) {
      validateRecord(record, snapshot.checkpoint);
      if (record.removedKey <= previous) fail("unsorted_or_duplicate_key");
      previous = record.removedKey;
    });
    if (utf8(JSON.stringify(snapshot)).length > MAX_BYTES) fail("snapshot_too_large");
    if (merkleRoot(snapshot.records) !== snapshot.checkpoint.root) fail("root_mismatch");
    return snapshot;
  }
  function buildSnapshot(options) {
    if (!options || !Array.isArray(options.records) || options.records.length > MAX_RECORDS) fail("invalid_snapshot");
    var records = options.records.map(function(record) { return Object.assign({}, record); });
    records.sort(function(a, b) { return a.removedKey < b.removedKey ? -1 : a.removedKey > b.removedKey ? 1 : 0; });
    var checkpoint = {treeFormat: TREE_FORMAT, policyId: options.policyId, authority: options.authority,
      root: "0".repeat(64), sequence: options.sequence, entryCount: records.length,
      issuedAt: options.issuedAt, expiresAt: options.expiresAt};
    validateCheckpoint(checkpoint);
    records.forEach(function(record) { validateRecord(record, checkpoint); });
    checkpoint.root = merkleRoot(records);
    return parseSnapshot({version: 1, checkpoint: checkpoint, records: records});
  }

  class RemovalRegistry {
    constructor(options) {
      if (!options || !policyId(options.policyId) || typeof options.authority !== "string" || !/^epix1/.test(options.authority) || normalizeAddress(options.authority) !== options.authority) fail("invalid_policy");
      this.policyId = options.policyId;
      this.authority = options.authority;
      this.highestSequence = options.highestSequence == null ? 0 : options.highestSequence;
      this.highestRoot = options.highestRoot == null ? null : options.highestRoot;
      if (!integer(this.highestSequence, 0) ||
        (this.highestRoot !== null && (typeof this.highestRoot !== "string" || !hexPattern.test(this.highestRoot))) ||
        (this.highestSequence > 0 && this.highestRoot === null)) fail("invalid_sequence_cache");
      this.checkpoint = null;
      this.records = Object.freeze([]);
      this.byKey = Object.create(null);
      this.available = false;
      this.error = "verification_unavailable";
    }

    // trustedCheckpoint MUST come from node-verified root manifest settings,
    // never from the snapshot, user metadata or a catalogue row. Root equality
    // authenticates every decision field, not merely membership of its key.
    accept(input, options) {
      options = options || {};
      try {
        var snapshot = parseSnapshot(input), checkpoint = snapshot.checkpoint;
        validateCheckpoint(options.trustedCheckpoint);
        if (checkpointMessage(checkpoint) !== checkpointMessage(options.trustedCheckpoint)) fail("untrusted_checkpoint");
        if (checkpoint.policyId !== this.policyId || checkpoint.authority !== this.authority) fail("wrong_policy");
        var now = options.now == null ? seconds() : options.now;
        if (!integer(now, 0) || checkpoint.issuedAt > now + 120) fail("future_checkpoint");
        if (checkpoint.expiresAt && checkpoint.expiresAt <= now) fail("expired_checkpoint");
        if (checkpoint.sequence < this.highestSequence ||
          (checkpoint.sequence === this.highestSequence && checkpoint.root !== this.highestRoot)) fail("checkpoint_rollback");
        if (this.checkpoint && checkpoint.sequence === this.checkpoint.sequence &&
          checkpointMessage(checkpoint) !== checkpointMessage(this.checkpoint)) fail("checkpoint_equivocation");
        if (this.checkpoint && checkpoint.issuedAt < this.checkpoint.issuedAt) fail("checkpoint_rollback");
        var next = Object.create(null);
        snapshot.records.forEach(function(record) { next[record.removedKey] = record; });
        this.records.forEach(function(old) {
          var current = next[old.removedKey];
          if (!current) fail("missing_prior_decision");
          if (current.revision < old.revision ||
            (current.revision === old.revision && toHex(recordBytes(current)) !== toHex(recordBytes(old)))) fail("decision_rollback");
          if (current.subjectKind !== old.subjectKind) fail("changed_subject_kind");
        });
        this.records = Object.freeze(snapshot.records.map(function(record) { return Object.freeze(Object.assign({}, record)); }));
        this.byKey = Object.create(null);
        this.records.forEach((record) => { this.byKey[record.removedKey] = record; });
        this.checkpoint = Object.freeze(Object.assign({}, checkpoint));
        this.highestSequence = checkpoint.sequence;
        this.highestRoot = checkpoint.root;
        this.available = true;
        this.error = null;
        return {ok: true, checkpoint: this.checkpoint};
      } catch (error) {
        this.unavailable(error && /^[a-z_]+$/.test(error.message) ? error.message : "invalid_snapshot");
        return {ok: false, error: this.error};
      }
    }

    unavailable(error) {
      this.available = false;
      this.error = typeof error === "string" && /^[a-z_]+$/.test(error) ? error : "verification_unavailable";
    }

    checkTarget(target, now) {
      var key;
      try {
        if (!exactFields(target, ["subjectKind", "subject"])) fail("invalid_target");
        key = targetKey(this.policyId, target.subjectKind, target.subject);
      } catch (error) { return {status: "verification_unavailable", error: "invalid_target"}; }
      var record = this.byKey[key];
      if (record && record.action === "remove") return {status: "removed", removedKey: record.removedKey,
        reasonCode: record.reasonCode, decisionId: record.decisionId, revision: record.revision,
        authority: record.authority, policyId: record.policyId, subjectKind: record.subjectKind,
        policyVersion: this.checkpoint.sequence};
      now = now == null ? seconds() : now;
      if (!this.available || !this.checkpoint || !integer(now, 0) ||
        (this.checkpoint.expiresAt && this.checkpoint.expiresAt <= now)) {
        return {status: "verification_unavailable", error: this.error || "expired_checkpoint"};
      }
      return {status: "allowed", policyId: this.policyId, policyVersion: this.checkpoint.sequence};
    }

    checkTargets(targets, now) {
      if (!Array.isArray(targets) || !targets.length) return {status: "verification_unavailable", error: "invalid_target"};
      var results = targets.map((target) => this.checkTarget(target, now));
      return results.find(function(result) { return result.status === "removed"; }) ||
        results.find(function(result) { return result.status === "verification_unavailable"; }) || results[0];
    }
  }

  RemovalRegistry.normalizeAddress = normalizeAddress;
  RemovalRegistry.targetKey = targetKey;
  RemovalRegistry.buildSnapshot = buildSnapshot;
  RemovalRegistry.checkpointMessage = checkpointMessage;
  RemovalRegistry.sha256 = sha256;
  RemovalRegistry.encodeFields = encodeFields;
  RemovalRegistry.REASONS = REASONS;
  RemovalRegistry.TREE_FORMAT = TREE_FORMAT;
  RemovalRegistry.MAX_RECORDS = MAX_RECORDS;
  RemovalRegistry.MAX_BYTES = MAX_BYTES;
  return RemovalRegistry;
});
