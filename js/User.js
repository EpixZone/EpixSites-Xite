(function() {

  class User {
    constructor(auth_address, directory) {
      this.starred = {};
      this.directory_override = directory || null;
      this.certSelect = this.certSelect.bind(this);
      this.resolveXid = this.resolveXid.bind(this);
      this.onSiteInfo = this.onSiteInfo.bind(this);
      if (auth_address) {
        this.setAuthAddress(auth_address);
      }
    }

    setAuthAddress(auth_address) {
      this.auth_address = auth_address;
      if (Page.site_info.auth_address === auth_address) {
        this.updateStarred();
        // Additive, idempotent migration of any legacy data.json site[] /
        // site_star{} into the signed-CRDT merge files. Needs a cert to sign +
        // publish; runs in the background and never strips the data.json arrays.
        if (Page.site_info.cert_user_id) {
          this.migrate();
        }
      }
    }

    updateStarred(cb) {
      this.starred = {};
      var user_dir = this.getUserDirectory();
      Page.cmd("dbQuery", ["SELECT site_star.* FROM json LEFT JOIN site_star USING (json_id) WHERE ?", {directory: "" + user_dir}], (res) => {
        for (var i = 0; i < res.length; i++) {
          this.starred[res[i]["site_uri"]] = true;
        }
        if (typeof cb === "function") cb();
        Page.projector.scheduleRender();
      });
    }

    getUserDirectory() {
      if (this.directory_override) {
        return this.directory_override;
      }
      if (Page.site_info && Page.site_info.xid_directory) {
        return Page.site_info.xid_directory;
      }
      return this.auth_address;
    }

    getPath() {
      return "data/users/" + this.getUserDirectory();
    }

    getDefaultData() {
      // data.json only keeps the legacy site[] + site_star{} that the additive
      // migration reads; the live source of truth is the signed-CRDT merge
      // files sites.json / stars.json. site_comment was never mapped - dropped.
      return {
        "site": [],
        "site_star": {}
      };
    }

    getData(cb) {
      Page.cmd("fileGet", [this.getPath() + "/data.json", false], (data) => {
        data = JSON.parse(data);
        if (data == null) data = this.getDefaultData();
        cb(data);
      });
    }

    // Guarded read for the write/publish path.
    //
    // getData() reads data.json with required:false, which is a LOCAL-only
    // read. On a device that has not synced this user's data.json yet, that
    // read MISSES and getData() falls back to a blank default. If a content
    // write (add/star/edit/delete) then saves and publishes that default, it
    // signs a blank over the network (last-writer-wins) and wipes the user's
    // real data everywhere.
    //
    // So for content writes go through here instead of getData(): if the local
    // read misses, trigger a sync and re-read. If the file is now present, use
    // the REAL data (no clobber). If it is STILL absent after the sync attempt,
    // ABORT by calling cb(null) so the caller does NOT write/publish, and tell
    // the user to retry. Only a genuinely new user (never published) reaches
    // the still-absent state here; a full merge-based fix comes later.
    getDataForWrite(cb) {
      var path = this.getPath() + "/data.json";
      Page.cmd("fileGet", [path, false], (data) => {
        if (data != null) {
          // File is present locally: safe to use the real data.
          cb(JSON.parse(data));
          return;
        }
        // Local miss: pull the latest from peers before deciding.
        var address = Page.site_info ? Page.site_info.address : null;
        Page.cmd("siteUpdate", {"address": address}, () => {
          Page.cmd("fileGet", [path, false], (data2) => {
            if (data2 != null) {
              // Recovered after sync: use the real data, do not clobber.
              cb(JSON.parse(data2));
            } else {
              // Still absent after a sync attempt. Refuse to overwrite an
              // unsynced file with a blank/default; ask the user to retry.
              Page.cmd("wrapperNotification", ["info", "Your data is still syncing, please try again in a moment."]);
              cb(null);
            }
          });
        });
      });
    }

    certSelect(cb) {
      Page.cmd("certXid", {}, (res) => {
        this.log("certXid result", res);
        if (res === "ok") {
          setTimeout(() => {
            Page.reloadSiteInfo();
            if (typeof cb === "function") cb(res);
          }, 500);
        } else {
          if (typeof cb === "function") cb(res);
        }
      });
    }

    resolveXid(address, cb) {
      Page.cmd("xidResolve", {"address": address}, (res) => {
        if (typeof cb === "function") cb(res);
      });
    }

    onSiteInfo(site_info) {
      if (site_info.event && site_info.event[0] === "cert_changed") {
        this.setAuthAddress(site_info.auth_address);
        Page.projector.scheduleRender();
      }
    }

    save(data, cb, privatekey) {
      var inner_path_content = this.getPath() + "/content.json";
      var sign_params = {"inner_path": inner_path_content};
      var publish_params = {"inner_path": inner_path_content, sign: false};
      if (privatekey) {
        sign_params.privatekey = privatekey;
        publish_params.privatekey = privatekey;
      }
      Page.cmd("fileWrite", [this.getPath() + "/data.json", Text.fileEncode(data)], (res_write) => {
        Page.cmd("siteSign", sign_params, (res_sign) => {
          if (typeof cb === "function") cb(res_sign);
          Page.cmd("sitePublish", publish_params, (res_publish) => {
            this.log("Save result", res_write, res_sign, res_publish);
          });
        });
      });
    }

    // ---- Signed-CRDT merge files ------------------------------------------
    //
    // Each collection lives in its OWN merge file under the user's directory:
    //   sites.json  - submitted site rows  -> site table
    //   stars.json  - star toggles         -> site_star table
    // A record is signed by the node (recordSign fills author + post_id + sign)
    // and UNION-merged into the on-disk set, so a write can never overwrite
    // another record. Deletes are signed tombstones, edits/re-toggles are new
    // versions of the same (author, key). The node folds every version to its
    // live winners for the DB, so reads/feeds stay unchanged.

    // The collections declared as merge files for this user directory.
    mergeCollections() {
      return ["sites", "stars"];
    }

    // A 128-bit random nonce (hex): part of every record's signed payload.
    randNonce() {
      var a = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(a);
      return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
    }

    // Read a collection's merge file (all signed record versions).
    getRecords(collection, cb) {
      Page.cmd("fileGet", [this.getPath() + "/" + collection + ".json", false], (data) => {
        var container = data ? JSON.parse(data) : null;
        if (!container || !container.post) {
          container = {"record_format": "epix-orset-1", "post": []};
        }
        cb(container);
      });
    }

    // Make sure EVERY declared merge file exists on disk (empty if new) BEFORE a
    // publish declares them. The node's sign-time auto-declare fills the
    // content.json files_merged map only while it is still absent, so a second
    // merge file first seen in a later publish would never get declared - it
    // would be signed as a hashed last-writer-wins file instead. Creating both
    // up front makes the first declaration cover both, and it sticks after.
    ensureCollections(cb) {
      var pending = this.mergeCollections().slice();
      var next = () => {
        if (!pending.length) {
          if (typeof cb === "function") cb();
          return;
        }
        var path = this.getPath() + "/" + pending.shift() + ".json";
        Page.cmd("fileGet", [path, false], (data) => {
          if (data != null) {
            next();
          } else {
            var empty = {"record_format": "epix-orset-1", "post": []};
            Page.cmd("fileWrite", [path, Text.fileEncode(empty)], () => next());
          }
        });
      };
      next();
    }

    // Write ONE signed record to <collection>.json and publish. The node
    // union-merges the record into the on-disk set (never overwriting other
    // records) and signs+bumps content.json (auto-declaring the merge files),
    // which propagates the merge to peers.
    saveRecord(collection, record, cb) {
      var container = {"record_format": "epix-orset-1", "post": [record]};
      Page.cmd("fileWrite", [this.getPath() + "/" + collection + ".json", Text.fileEncode(container)], (res_write) => {
        this.ensureCollections(() => {
          Page.cmd("sitePublish", {"inner_path": this.getPath() + "/content.json"}, (res_pub) => {
            this.log("saveRecord", collection, res_write, res_pub);
            if (typeof cb === "function") cb(res_write);
          });
        });
      });
    }

    // Build + sign a version of a keyed record and save it. Handles create,
    // edit, and delete uniformly: it reads the collection, carries the immutable
    // origin (nonce/date_added) of any prior version of this `key` forward, and
    // derives clock/supersedes so the merge orders this version after everything
    // this device has seen. `fields` are the app columns (skipped on a
    // tombstone). The node derives a STABLE per-(author, key) post_id, so an
    // edit or re-toggle SUPERSEDES the prior record instead of adding an item.
    editRecord(collection, key, fields, deleted, cb) {
      if (cb == null) cb = null;
      this.getRecords(collection, (container) => {
        var maxClock = 0, orig = null;
        container.post.forEach((r) => {
          if (r.key === key) {
            if (r.clock > maxClock) maxClock = r.clock;
            if (!orig || (r.clock || 0) >= (orig.clock || 0)) orig = r;
          }
        });
        var record = {
          "key": key,
          "nonce": orig && orig.nonce ? orig.nonce : this.randNonce(),
          "clock": Math.max(maxClock + 1, Date.now()),
          "supersedes": maxClock,
          "deleted": deleted === true,
          "date_added": orig ? orig.date_added : Time.timestamp()
        };
        if (deleted !== true) {
          for (var k in fields) {
            if (fields[k] !== undefined) record[k] = fields[k];
          }
        }
        Page.cmd("recordSign", [record], (signed) => {
          if (!signed || signed.error) {
            if (cb) cb(signed);
            return;
          }
          this.saveRecord(collection, signed, (res) => {
            if (cb) cb(res);
          });
        });
      });
    }

    // Sign a batch of legacy records into <collection>.json (union-merge) and
    // publish once. ADDITIVE + per-item idempotent: only signs items whose `key`
    // is not already present. `records` are UNSIGNED record objects.
    migrateCollection(collection, records, cb) {
      var done = () => { if (typeof cb === "function") cb(); };
      if (!records || !records.length) return done();
      this.getRecords(collection, (container) => {
        var have = {};
        container.post.forEach((r) => { if (r.key != null) have[r.key] = true; });
        var todo = records.filter((r) => r && r.key != null && !have[r.key]);
        if (!todo.length) return done();
        var signed = [];
        var i = 0;
        var signNext = () => {
          if (i >= todo.length) {
            if (!signed.length) return done();
            var merged = {"record_format": "epix-orset-1", "post": signed};
            return Page.cmd("fileWrite", [this.getPath() + "/" + collection + ".json", Text.fileEncode(merged)], () => {
              this.ensureCollections(() => {
                Page.cmd("sitePublish", {"inner_path": this.getPath() + "/content.json"}, () => done());
              });
            });
          }
          var rec = todo[i++];
          Page.cmd("recordSign", [rec], (s) => {
            if (s && !s.error) signed.push(s);
            signNext();
          });
        };
        signNext();
      });
    }

    // One-time-ish migration of legacy data.json site[] + site_star{} into the
    // signed-CRDT merge files. ADDITIVE and per-item idempotent (keyed by the
    // site id / starred uri so future edits/toggles supersede), runs in the
    // background, and NEVER strips the legacy data.json arrays.
    migrate(cb) {
      if (cb == null) cb = null;
      if (this.migrating) { if (cb) cb(); return; }
      this.migrating = true;
      var finish = () => { this.migrating = false; if (cb) cb(); };
      this.getData((data) => {
        var legacy_sites = (data && data.site) || [];
        var site_records = legacy_sites.map((s) => {
          var site_id = s.site_id != null ? s.site_id : s.date_added;
          var rec = {
            "key": "site_" + site_id,
            "nonce": this.randNonce(),
            "clock": 1,
            "supersedes": 0,
            "deleted": false,
            "site_id": site_id,
            "date_added": s.date_added,
            "category": s.category,
            "language": s.language,
            "title": s.title,
            "description": s.description,
            "address": s.address
          };
          if (s.tags !== undefined) rec["tags"] = s.tags;
          return rec;
        });
        var legacy_stars = (data && data.site_star) || {};
        var star_records = [];
        for (var uri in legacy_stars) {
          star_records.push({
            "key": uri,
            "nonce": this.randNonce(),
            "clock": 1,
            "supersedes": 0,
            "deleted": false,
            "site_uri": uri,
            "value": 1,
            "date_added": Time.timestamp()
          });
        }
        this.migrateCollection("sites", site_records, () => {
          this.migrateCollection("stars", star_records, () => {
            finish();
          });
        });
      });
    }
  }

  Object.assign(User.prototype, LogMixin);
  window.User = User;

})();
