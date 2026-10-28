(function(root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory(require("./RemovalRegistry.js"));
  else {
    var Client = factory(root.RemovalRegistry);
    root.RemovalPolicy = new Client(function() { return root.Page; });
  }
})(typeof window !== "undefined" ? window : globalThis, function(Registry) {
  "use strict";

  var DEFAULT_POLICY = "epix-xite-removal-v1";
  var plain = function(value) { return !!value && typeof value === "object" && !Array.isArray(value); };
  var clone = function(value) { return JSON.parse(JSON.stringify(value)); };
  var unavailable = function(error) { return {status: "verification_unavailable", error: error || "verification_unavailable"}; };
  var hostName = function(value) {
    if (typeof value !== "string") return null;
    value = value.trim().toLowerCase();
    return value.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(value) ? value : null;
  };

  // The checkpoint is an author-controlled part of the node-verified root
  // content.json. Neither a user record nor removals.json may supply trust.
  class RemovalPolicyClient {
    constructor(getPage, options) {
      options = options || {};
      this.getPage = getPage;
      this.now = options.now || function() { return Math.floor(Date.now() / 1000); };
      this.timeout = options.timeout || 15000;
      this.registry = null;
      this.config = null;
      this.fingerprint = null;
      this.generation = 0;
      this.pending = Promise.resolve();
      this.aliases = new Map();
      this.aliasPending = new Map();
      this.error = "verification_unavailable";
    }

    request(command, params) {
      return new Promise((resolve, reject) => {
        var finished = false;
        var timer = setTimeout(function() {
          if (!finished) { finished = true; reject(new Error("request_timeout")); }
        }, this.timeout);
        var done = function(result) {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          if (result && result.error) reject(new Error("request_failed"));
          else resolve(result);
        };
        try {
          var page = this.getPage();
          if (!page || typeof page.cmd !== "function") throw new Error("bridge_unavailable");
          page.cmd(command, params, done);
        } catch (error) {
          if (!finished) { finished = true; clearTimeout(timer); reject(new Error("bridge_unavailable")); }
        }
      });
    }

    storage() {
      var page = this.getPage();
      if (page && plain(page.local_storage)) return Promise.resolve(page.local_storage);
      return new Promise((resolve, reject) => {
        var timer = setTimeout(function() { reject(new Error("storage_unavailable")); }, this.timeout);
        if (!page || !page.on_local_storage || typeof page.on_local_storage.then !== "function") {
          clearTimeout(timer); reject(new Error("storage_unavailable")); return;
        }
        page.on_local_storage.then(function() {
          clearTimeout(timer);
          if (plain(page.local_storage)) resolve(page.local_storage);
          else reject(new Error("storage_unavailable"));
        });
      });
    }

    configure(siteInfo) {
      var next;
      try {
        var content = siteInfo && siteInfo.content;
        var config = content && content.settings && content.settings.removals;
        var authority = content && Registry.normalizeAddress(content.address);
        if (!authority || !/^epix1/.test(authority) || !plain(config) ||
            Object.keys(config).sort().join(",") !== "checkpoint,policyId,snapshot" ||
            config.snapshot !== "removals.json" || !plain(config.checkpoint) ||
            config.checkpoint.authority !== authority || config.checkpoint.policyId !== config.policyId) {
          throw new Error("invalid_policy");
        }
        next = clone(config);
        // Validate the checkpoint before using it for cache names or reads.
        Registry.checkpointMessage(next.checkpoint);
      } catch (error) {
        this.generation++;
        this.config = null;
        this.fingerprint = null;
        this.error = "invalid_policy";
        if (this.registry) this.registry.unavailable(this.error);
        this.pending = Promise.resolve();
        return this.pending;
      }
      var fingerprint = JSON.stringify(next);
      if (fingerprint === this.fingerprint) return this.pending;
      if (!this.registry || this.registry.policyId !== next.policyId || this.registry.authority !== next.checkpoint.authority) {
        this.registry = new Registry({policyId: next.policyId, authority: next.checkpoint.authority});
      }
      this.config = next;
      this.fingerprint = fingerprint;
      return this.refresh();
    }

    ready() { return this.pending; }

    refresh() {
      var generation = ++this.generation;
      var config = this.config;
      var registry = this.registry;
      if (!config || !registry) return (this.pending = Promise.resolve());
      registry.unavailable("loading");
      this.error = "loading";
      this.pending = (async () => {
        try {
          var storage = await this.storage();
          if (generation !== this.generation) return;
          var cacheName = config.checkpoint.authority + ":" + config.policyId;
          var caches = storage.removal_checkpoints;
          if (caches !== undefined && !plain(caches)) throw new Error("invalid_sequence_cache");
          var cached = caches && caches[cacheName];
          if (cached !== undefined) {
            if (!plain(cached) || Object.keys(cached).sort().join(",") !== "root,sequence,snapshot" ||
                !Number.isSafeInteger(cached.sequence) || cached.sequence < 1 || !/^[0-9a-f]{64}$/.test(cached.root) ||
                !plain(cached.snapshot) || !plain(cached.snapshot.checkpoint) ||
                cached.snapshot.checkpoint.sequence !== cached.sequence || cached.snapshot.checkpoint.root !== cached.root) {
              throw new Error("invalid_sequence_cache");
            }
            // This origin-local state was saved only after a node-authenticated
            // checkpoint was accepted. Restore its complete decisions as well
            // as the floor, so an omitted key cannot become allowed on reload.
            // Use its issuance time to recover even expired known removals;
            // absence still requires a fresh root-pinned load below.
            var recovered = new Registry({policyId: config.policyId, authority: config.checkpoint.authority});
            var restoreOptions = {trustedCheckpoint: cached.snapshot.checkpoint, now: cached.snapshot.checkpoint.issuedAt};
            if (!recovered.accept(cached.snapshot, restoreOptions).ok) throw new Error("invalid_sequence_cache");
            if (cached.sequence >= registry.highestSequence) {
              var restored = registry.accept(cached.snapshot, restoreOptions);
              if (!restored.ok) throw new Error(restored.error);
            }
            registry.unavailable("loading");
          }
          var text = await this.request("fileGet", {inner_path: config.snapshot, required: true});
          if (generation !== this.generation) return;
          if (typeof text !== "string" || text.length > Registry.MAX_BYTES) throw new Error("invalid_snapshot");
          var result = registry.accept(text, {trustedCheckpoint: config.checkpoint, now: this.now()});
          if (!result.ok) throw new Error(result.error);
          registry.unavailable("saving_checkpoint");
          storage.removal_checkpoints = storage.removal_checkpoints || {};
          storage.removal_checkpoints[cacheName] = {sequence: registry.highestSequence, root: registry.highestRoot,
            snapshot: {version: 1, checkpoint: registry.checkpoint, records: registry.records}};
          // The page and wrapper own this object. Preserve other preferences.
          await this.request("wrapperSetLocalStorage", storage);
          if (generation !== this.generation) return;
          registry.available = true;
          registry.error = null;
          this.error = null;
        } catch (error) {
          if (generation !== this.generation) return;
          this.error = error && /^[a-z_]+$/.test(error.message) ? error.message : "verification_unavailable";
          registry.unavailable(this.error);
        }
      })();
      return this.pending;
    }

    canonical(address) {
      var canonical = Registry.normalizeAddress(address);
      if (canonical) return canonical;
      var host = hostName(address), cached = host && this.aliases.get(host);
      return cached && cached.until > this.now() ? cached.address : null;
    }

    async resolve(address, force) {
      var canonical = Registry.normalizeAddress(address);
      if (canonical) return canonical;
      var host = hostName(address);
      if (!host) return null;
      var cached = this.aliases.get(host);
      if (!force && cached && cached.until > this.now()) return cached.address;
      if (this.aliasPending.has(host)) return this.aliasPending.get(host);
      var promise = (async () => {
        var resolved = null;
        try {
          // This reads an existing verified resolution, never downloads the
          // target merely to find out whether it has been removed.
          var result = await this.request("resolveStatus", {host: host});
          if (result && result.state === "resolved" && result.verified === true && result.host === host) {
            resolved = Registry.normalizeAddress(result.address);
          }
        } catch (error) { /* unresolved names stay unavailable */ }
        this.aliases.set(host, {address: resolved, until: this.now() + (resolved ? 60 : 15)});
        this.aliasPending.delete(host);
        return resolved;
      })();
      this.aliasPending.set(host, promise);
      return promise;
    }

    async prepare(addresses) {
      await this.ready();
      if (!Array.isArray(addresses)) return;
      var queue = Array.from(new Set(addresses.filter(function(address) {
        return !Registry.normalizeAddress(address) && !!hostName(address);
      }))).slice(0, 64);
      var next = 0;
      await Promise.all([0, 1, 2, 3].map(async () => {
        while (next < queue.length) await this.resolve(queue[next++], false);
      }));
    }

    key(address) {
      var canonical = this.canonical(address);
      if (!canonical) return null;
      try { return Registry.targetKey(this.config ? this.config.policyId : DEFAULT_POLICY, "address", canonical); }
      catch (error) { return null; }
    }

    check(address) {
      var canonical = this.canonical(address);
      if (!canonical) return unavailable("unresolved_address");
      if (!this.registry) return unavailable(this.error);
      var result = this.registry.checkTarget({subjectKind: "address", subject: canonical}, this.now());
      if (result.status === "allowed") result.canonicalAddress = canonical;
      return result;
    }

    guard(address, callback) {
      var run = (async () => {
        await this.ready();
        var canonical = await this.resolve(address, true);
        // A newer root may have arrived during name resolution.
        await this.ready();
        return canonical ? this.check(canonical) : unavailable("unresolved_address");
      })().catch(function() { return unavailable(); });
      if (typeof callback === "function") run.then(callback);
      return run;
    }

    records() {
      if (!this.registry) return [];
      return this.registry.records.filter(function(record) { return record.action === "remove"; }).map((record) => ({
        status: "removed", removedKey: record.removedKey, reasonCode: record.reasonCode,
        decisionId: record.decisionId, revision: record.revision, authority: record.authority,
        policyId: record.policyId, subjectKind: record.subjectKind,
        policyVersion: this.registry.checkpoint.sequence
      }));
    }

    message(decision) {
      if (decision && decision.status === "removed") {
        var reason = Registry.REASONS[decision.reasonCode] || "Policy violation";
        return "This Xite was removed and cannot be added or opened here. Reason: " + reason + ".";
      }
      if (decision && decision.error === "unresolved_address") return "Use a canonical Xite address or wait for verified name resolution.";
      return "Removal policy could not be verified. Retry after it has loaded.";
    }
  }
  return RemovalPolicyClient;
});
