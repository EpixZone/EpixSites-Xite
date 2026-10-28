const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const Registry = require("../js/utils/RemovalRegistry.js");

const AUTHORITY = "epix12fdtj0j77kltvdw2eqfzw392mr34r2al22mqrf";
const TARGET = "epix1searchd8hcnyfacvklmszzxwx9ptnf5rde04xf";
const OTHER = "epix1p0stmcza0xjkvv0vnjlk0ypr7xsunt4lxkhgcm";
const LEGACY = "17Ayo82FwgH2cL7HuFKNT8tdFfBSVLbPVR";
const POLICY = "epix-xite-removal-v1";
const NOW = 1793210400;
const clone = value => JSON.parse(JSON.stringify(value));
const addressTarget = subject => ({subjectKind: "address", subject});
const digest = bytes => crypto.createHash("sha256").update(bytes).digest();
function fields(values) {
  return Buffer.concat(values.map(value => {
    const bytes = Buffer.from(value, "utf8"), length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    return Buffer.concat([length, bytes]);
  }));
}
function record(subject = TARGET, changes = {}) {
  return Object.assign({removedKey: Registry.targetKey(POLICY, "address", subject), policyId: POLICY,
    subjectKind: "address", action: "remove", reasonCode: "malware", decisionId: "R-42", revision: 1,
    authority: AUTHORITY}, changes);
}
function snapshot(records = [], changes = {}) {
  return Registry.buildSnapshot(Object.assign({policyId: POLICY, authority: AUTHORITY, sequence: 1,
    issuedAt: NOW - 60, expiresAt: NOW + 3600, records}, changes));
}
function registry(changes = {}) { return new Registry(Object.assign({policyId: POLICY, authority: AUTHORITY}, changes)); }
function accept(instance, data, changes = {}) {
  return instance.accept(data, Object.assign({trustedCheckpoint: data.checkpoint, now: NOW}, changes));
}
function leaf(row) {
  return digest(Buffer.concat([Buffer.from([0]), fields(["epix-removal-record-v1", row.policyId, row.authority,
    row.removedKey, row.subjectKind, row.action, row.reasonCode, row.decisionId, String(row.revision)])]));
}
function pair(left, right) { return digest(Buffer.concat([Buffer.from([1]), left, right])); }

test("SHA-256 matches independent crypto vectors and block boundaries", () => {
  const values = ["", "abc", "hello 😀 café", "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
    ...[1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 1000, 1000000].map(size => "a".repeat(size))];
  for (const value of values) assert.equal(Registry.sha256(value), digest(Buffer.from(value)).toString("hex"));
  for (const size of [0, 1, 55, 56, 64, 65, 513, 4096]) {
    const bytes = Uint8Array.from({length: size}, (_, index) => (index * 149 + 19) & 255);
    assert.equal(Registry.sha256(bytes), digest(bytes).toString("hex"));
  }
  assert.throws(() => Registry.sha256("\ud800"), /invalid_unicode/);
  assert.throws(() => Registry.sha256("\udc00"), /invalid_unicode/);
});

test("canonical encoding is byte length delimited and matches an independent UTF-8 implementation", () => {
  const vector = ["epix-removal-v1", "é😀", "", "1"];
  assert.deepEqual(Buffer.from(Registry.encodeFields(vector)), fields(vector));
  assert.notDeepEqual(Registry.encodeFields(["a", "bc"]), Registry.encodeFields(["ab", "c"]));
});

test("address normalization validates Epix checksums and preserves Base58 case", () => {
  assert.equal(Registry.normalizeAddress(TARGET), TARGET);
  assert.equal(Registry.normalizeAddress(" \n" + TARGET.toUpperCase() + "\t"), TARGET);
  assert.equal(Registry.normalizeAddress(LEGACY), LEGACY);
  assert.equal(Registry.normalizeAddress(LEGACY.toLowerCase()), null);
  assert.equal(Registry.normalizeAddress(TARGET.slice(0, -1) + "q"), null);
  assert.equal(Registry.normalizeAddress("E" + TARGET.slice(1)), null);
  assert.equal(Registry.normalizeAddress("http://localhost:43110/" + TARGET), null);
  assert.equal(Registry.normalizeAddress(TARGET + "/index.html"), null);
  assert.equal(Registry.normalizeAddress("site.epix"), null);
  assert.equal(Registry.normalizeAddress("1BitcoinEaterAddressDontSendf59kuE"), "1BitcoinEaterAddressDontSendf59kuE");
  assert.equal(Registry.normalizeAddress("1111111111111111111114oLvT2"), "1111111111111111111114oLvT2");
  assert.equal(Registry.normalizeAddress("1111111111111111111114oLvT3"), null);
  assert.equal(Registry.normalizeAddress(null), null);
});

test("deterministic address keys bind policy and kind independently of listing IDs", () => {
  const expected = digest(fields(["epix-removal-v1", POLICY, "address", TARGET])).toString("hex");
  assert.equal(Registry.targetKey(POLICY, "address", TARGET), expected);
  assert.equal(Registry.targetKey(POLICY, "address", TARGET.toUpperCase()), expected);
  assert.notEqual(Registry.targetKey("other-policy", "address", TARGET), expected);
  assert.notEqual(Registry.targetKey(POLICY, "item", {address: TARGET, itemId: "post-42"}), expected);
  assert.notEqual(Registry.targetKey(POLICY, "item", {address: TARGET, itemId: "post-42"}),
    Registry.targetKey(POLICY, "item", {address: TARGET, itemId: "post-43"}));
});

test("item identities remain scoped and exact content keys ignore filenames", () => {
  const content = {algorithm: "sha256", digest: digest(Buffer.from("same bytes")).toString("hex")};
  assert.equal(Registry.targetKey(POLICY, "content", content),
    Registry.targetKey(POLICY, "content", {...content, digest: content.digest.toUpperCase()}));
  assert.notEqual(Registry.targetKey(POLICY, "content", content),
    Registry.targetKey(POLICY, "content", {...content, algorithm: "sha512-first256"}));
  assert.notEqual(Registry.targetKey(POLICY, "item", {address: TARGET, itemId: "post-42"}),
    Registry.targetKey(POLICY, "item", {address: OTHER, itemId: "post-42"}));
  for (const itemId of ["../file", "a/../file", "a//file", "/file", "a/", "a\\file", "a\u0000b"]) {
    assert.throws(() => Registry.targetKey(POLICY, "item", {address: TARGET, itemId}), /invalid_target/);
  }
  assert.throws(() => Registry.targetKey(POLICY, "content", {...content, filename: "secret.mp4"}), /invalid_target/);
  assert.throws(() => Registry.targetKey(POLICY, "content", {...content, algorithm: "md5"}), /invalid_target/);
});

test("Merkle empty, single, two, three and five leaf roots match independent construction", () => {
  const rows = Array.from({length: 5}, (_, index) => record(TARGET, {
    removedKey: digest(Buffer.from(String(index))).toString("hex"), decisionId: "R-" + index
  }));
  assert.equal(snapshot([]).checkpoint.root, digest(Buffer.alloc(0)).toString("hex"));
  const sorted = snapshot(rows).records;
  for (const count of [1, 2, 3, 5]) {
    const leaves = sorted.slice(0, count).map(leaf);
    const expected = count === 1 ? leaves[0] : count === 2 ? pair(...leaves) : count === 3 ?
      pair(pair(leaves[0], leaves[1]), leaves[2]) : pair(pair(pair(leaves[0], leaves[1]), pair(leaves[2], leaves[3])), leaves[4]);
    assert.equal(snapshot(sorted.slice(0, count)).checkpoint.root, expected.toString("hex"));
  }
  assert.equal(snapshot(rows).checkpoint.root, snapshot(rows.slice().reverse()).checkpoint.root);
  assert.notEqual(snapshot([rows[0]]).checkpoint.root, rows[0].removedKey);
});

test("absence requires a full snapshot matching a separately trusted checkpoint", () => {
  const instance = registry(), data = snapshot([record()]);
  assert.equal(instance.checkTarget(addressTarget(OTHER), NOW).status, "verification_unavailable");
  assert.equal(instance.accept(data, {now: NOW}).ok, false);
  assert.equal(accept(instance, data).ok, true);
  assert.equal(instance.checkTarget(addressTarget(TARGET), NOW).status, "removed");
  assert.equal(instance.checkTarget(addressTarget(OTHER), NOW).status, "allowed");
  const empty = snapshot([]);
  assert.equal(accept(instance, empty, {trustedCheckpoint: data.checkpoint}).error, "untrusted_checkpoint");
  assert.equal(instance.checkTarget(addressTarget(TARGET), NOW).status, "removed");
  assert.equal(instance.checkTarget(addressTarget(OTHER), NOW).status, "verification_unavailable");
});

test("tampered reasons, partial snapshots and recomputed attacker roots fail", () => {
  const data = snapshot([record(), record(OTHER)]);
  const tampered = clone(data); tampered.records[0].reasonCode = "scam";
  assert.equal(accept(registry(), tampered, {trustedCheckpoint: data.checkpoint}).error, "root_mismatch");
  const partial = clone(data); partial.records.pop();
  assert.equal(accept(registry(), partial, {trustedCheckpoint: data.checkpoint}).error, "incomplete_snapshot");
  const forged = snapshot([record(TARGET, {reasonCode: "scam"})]);
  assert.equal(accept(registry(), forged, {trustedCheckpoint: data.checkpoint}).error, "untrusted_checkpoint");
  const extraSignature = clone(data); extraSignature.signature = "self-signed";
  assert.equal(accept(registry(), extraSignature).error, "invalid_snapshot");
});

test("every public decision field is committed, including provenance and revision", () => {
  const original = snapshot([record()]);
  for (const changes of [{reasonCode: "scam"}, {decisionId: "R-43"}, {revision: 2},
    {subjectKind: "item"}, {action: "reinstate", reasonCode: "reinstated"}]) {
    assert.notEqual(snapshot([record(TARGET, changes)]).checkpoint.root, original.checkpoint.root);
  }
});

test("schema rejects raw target fields, free-text evidence, inappropriate reasons and duplicates", () => {
  for (const changes of [{address: TARGET}, {title: "removed title"}, {note: "evidence"}, {reasonCode: "spam"},
    {reasonCode: "dead"}, {reasonCode: "copyright"}, {reasonCode: "mature"}, {reasonCode: "adult"},
    {reasonCode: "reinstated"}, {action: "reinstate"}, {revision: 0}, {decisionId: TARGET}]) {
    assert.throws(() => snapshot([record(TARGET, changes)]), /invalid_record/);
  }
  assert.throws(() => snapshot([record(), record()]), /unsorted_or_duplicate_key/);
  const data = snapshot([record(), record(OTHER)]); data.records.reverse();
  assert.equal(accept(registry(), data).error, "unsorted_or_duplicate_key");
});

test("checkpoint schema, authority, count and size are bounded", () => {
  assert.throws(() => registry({authority: null}), /invalid_policy/);
  assert.throws(() => registry({authority: LEGACY}), /invalid_policy/);
  assert.throws(() => registry({authority: AUTHORITY.toUpperCase()}), /invalid_policy/);
  assert.throws(() => snapshot([], {sequence: 0}), /invalid_checkpoint/);
  assert.throws(() => snapshot([], {expiresAt: NOW - 61}), /invalid_checkpoint/);
  const data = snapshot([]);
  data.checkpoint.url = "https://example.test/";
  assert.equal(accept(registry(), data).error, "invalid_checkpoint");
  assert.equal(registry().accept(" ".repeat(Registry.MAX_BYTES + 1), {}).error, "snapshot_too_large");
  assert.throws(() => snapshot(Array(Registry.MAX_RECORDS + 1).fill(record())), /invalid_snapshot/);
});

test("stale and future checkpoints cannot establish absence; prior removals survive outages", () => {
  const data = snapshot([record()]), instance = registry();
  assert.equal(accept(instance, data).ok, true);
  assert.equal(instance.checkTarget(addressTarget(OTHER), data.checkpoint.expiresAt).status, "verification_unavailable");
  assert.equal(instance.checkTarget(addressTarget(TARGET), data.checkpoint.expiresAt).status, "removed");
  instance.unavailable("network_failure");
  assert.equal(instance.checkTarget(addressTarget(TARGET), NOW).status, "removed");
  assert.equal(instance.checkTarget(addressTarget(OTHER), NOW).status, "verification_unavailable");
  assert.equal(accept(registry(), data, {now: data.checkpoint.expiresAt}).error, "expired_checkpoint");
  assert.equal(accept(registry(), data, {now: data.checkpoint.issuedAt - 121}).error, "future_checkpoint");
});

test("zero expiry explicitly disables the clock deadline and still enforces rollback", () => {
  const data = snapshot([], {expiresAt: 0}), instance = registry();
  assert.equal(accept(instance, data).ok, true);
  assert.equal(instance.checkTarget(addressTarget(TARGET), NOW + 86400 * 365).status, "allowed");
  const next = snapshot([], {sequence: 2, expiresAt: 0});
  assert.equal(accept(instance, next).ok, true);
  assert.equal(accept(instance, data).error, "checkpoint_rollback");
});

test("replaying the exact checkpoint is safe, changing its root or fields at the same sequence is rejected", () => {
  const instance = registry(), data = snapshot([record()]);
  assert.equal(accept(instance, data).ok, true);
  assert.equal(accept(instance, JSON.parse(JSON.stringify(data))).ok, true);
  const changedRoot = snapshot([record(TARGET, {reasonCode: "scam"})]);
  assert.equal(accept(instance, changedRoot).error, "checkpoint_rollback");
  const changedTime = snapshot([record()], {expiresAt: NOW + 7200});
  assert.equal(accept(instance, changedTime).error, "checkpoint_equivocation");
});

test("persisted sequence/root rejects earlier snapshots and same-sequence alternative roots", () => {
  const data = snapshot([record()], {sequence: 5});
  const instance = registry({highestSequence: 5, highestRoot: data.checkpoint.root});
  assert.equal(accept(instance, snapshot([], {sequence: 4})).error, "checkpoint_rollback");
  assert.equal(accept(instance, snapshot([], {sequence: 5})).error, "checkpoint_rollback");
  assert.equal(accept(instance, data).ok, true);
  assert.throws(() => registry({highestSequence: 5}), /invalid_sequence_cache/);
});

test("known decisions cannot disappear or change without a newer revision", () => {
  const instance = registry(), data = snapshot([record()]);
  assert.equal(accept(instance, data).ok, true);
  assert.equal(accept(instance, snapshot([], {sequence: 2})).error, "missing_prior_decision");
  assert.equal(accept(instance, snapshot([record(TARGET, {reasonCode: "scam"})], {sequence: 2})).error, "decision_rollback");
  assert.equal(accept(instance, snapshot([record(TARGET, {revision: 2, subjectKind: "item"})], {sequence: 2})).error, "changed_subject_kind");
  assert.equal(instance.checkTarget(addressTarget(TARGET), NOW).status, "removed");
});

test("authorized newer reinstatement reverses only its own policy and target", () => {
  const instance = registry(), first = snapshot([record(), record(OTHER)]);
  assert.equal(accept(instance, first).ok, true);
  const reversal = record(TARGET, {action: "reinstate", reasonCode: "reinstated", decisionId: "R-43", revision: 2});
  assert.equal(accept(instance, snapshot([reversal, record(OTHER)], {sequence: 2})).ok, true);
  assert.equal(instance.checkTarget(addressTarget(TARGET), NOW).status, "allowed");
  assert.equal(instance.checkTarget(addressTarget(OTHER), NOW).status, "removed");
  assert.equal(accept(instance, first).error, "checkpoint_rollback");
  assert.equal(instance.checkTarget(addressTarget(TARGET), NOW).status, "verification_unavailable");
  assert.equal(instance.checkTarget(addressTarget(OTHER), NOW).status, "removed");
  const different = registry({policyId: "other-policy"});
  assert.equal(accept(different, first).error, "wrong_policy");
});

test("item reinstatement cannot override enclosing hub or exact-content removal", () => {
  const item = {subjectKind: "item", subject: {address: TARGET, itemId: "post-42"}};
  const content = {subjectKind: "content", subject: {algorithm: "sha256", digest: "c".repeat(64)}};
  const itemRow = record(TARGET, {subjectKind: "item", removedKey: Registry.targetKey(POLICY, item.subjectKind, item.subject),
    action: "reinstate", reasonCode: "reinstated", revision: 2});
  const contentRow = record(TARGET, {subjectKind: "content", removedKey: Registry.targetKey(POLICY, content.subjectKind, content.subject)});
  const instance = registry();
  assert.equal(accept(instance, snapshot([record(), itemRow, contentRow])).ok, true);
  assert.equal(instance.checkTarget(item, NOW).status, "allowed");
  assert.equal(instance.checkTargets([item, addressTarget(TARGET)], NOW).status, "removed");
  assert.equal(instance.checkTargets([item, content], NOW).status, "removed");
  assert.equal(instance.checkTarget(addressTarget(OTHER), NOW).status, "allowed");
});

test("removal output is sanitized and caller mutation cannot alter accepted decisions", () => {
  const instance = registry(), data = snapshot([record()]);
  assert.equal(accept(instance, data).ok, true);
  data.records[0].reasonCode = "scam";
  data.checkpoint.expiresAt = NOW - 1;
  const result = instance.checkTarget(addressTarget(TARGET), NOW);
  assert.equal(result.reasonCode, "malware");
  assert.equal(JSON.stringify(result).includes(TARGET), false);
  assert.equal(Object.isFrozen(instance.records), true);
  assert.equal(Object.isFrozen(instance.records[0]), true);
  assert.equal(Object.isFrozen(instance.checkpoint), true);
  result.reasonCode = "scam";
  assert.equal(instance.checkTarget(addressTarget(TARGET), NOW).reasonCode, "malware");
});

test("invalid targets and malformed snapshots fail without exposing input text", () => {
  const instance = registry();
  assert.equal(instance.checkTarget(addressTarget("https://secret.example/"), NOW).status, "verification_unavailable");
  assert.equal(JSON.stringify(instance.checkTarget(addressTarget("https://secret.example/"), NOW)).includes("secret"), false);
  assert.equal(instance.accept("{secret", {now: NOW}).error, "invalid_snapshot");
  assert.equal(instance.checkTargets([], NOW).status, "verification_unavailable");
  assert.equal(instance.checkTarget({subjectKind: "address", subject: TARGET, extra: "title"}, NOW).error, "invalid_target");
});

test("browser build works without Node globals or Web Crypto", () => {
  const context = {window: {}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../js/utils/RemovalRegistry.js"), "utf8"), context);
  const BrowserRegistry = context.window.RemovalRegistry;
  const data = snapshot([record()]);
  const instance = new BrowserRegistry({policyId: POLICY, authority: AUTHORITY});
  assert.equal(instance.accept(JSON.stringify(data), {trustedCheckpoint: data.checkpoint, now: NOW}).ok, true);
  assert.equal(instance.checkTarget(addressTarget(TARGET), NOW).status, "removed");
  assert.equal(BrowserRegistry.sha256("abc"), Registry.sha256("abc"));
  assert.equal(BrowserRegistry.targetKey(POLICY, "address", TARGET), Registry.targetKey(POLICY, "address", TARGET));
});
