(function() {

  class User {
    constructor(auth_address, directory) {
      this.starred = {};
      this.my_ratings = {};   // uri -> label
      this.my_reports = {};   // uri -> reason
      this.my_vouches = {};   // uri -> true
      this.my_claims = {};    // target_address -> true
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
        this.updateMine();
      }
    }

    // Load everything this user has standing on: stars, classification votes,
    // reports, and vouches, so the UI can render own-state instantly.
    updateMine(cb) {
      this.starred = {};
      this.my_ratings = {};
      this.my_reports = {};
      this.my_vouches = {};
      this.my_claims = {};
      var user_dir = "" + this.getUserDirectory();
      var pending = 4;
      var done = () => {
        pending--;
        if (pending === 0) {
          if (typeof cb === "function") cb();
          Page.projector.scheduleRender();
        }
      };
      Page.cmd("dbQuery", ["SELECT site_star.* FROM json LEFT JOIN site_star USING (json_id) WHERE ?", {directory: user_dir}], (res) => {
        for (var i = 0; i < res.length; i++) {
          if (res[i]["site_uri"]) this.starred[res[i]["site_uri"]] = true;
        }
        done();
      });
      Page.cmd("dbQuery", ["SELECT site_rating.* FROM json LEFT JOIN site_rating USING (json_id) WHERE ?", {directory: user_dir}], (res) => {
        for (var i = 0; i < res.length; i++) {
          var row = res[i];
          if (row["target_dir"]) this.my_ratings[row["target_dir"] + "_" + row["target_site_id"]] = row["label"];
        }
        done();
      });
      Page.cmd("dbQuery", ["SELECT site_claim.* FROM json LEFT JOIN site_claim USING (json_id) WHERE ?", {directory: user_dir}], (res) => {
        for (var i = 0; i < res.length; i++) {
          if (res[i]["target_address"]) this.my_claims[res[i]["target_address"]] = true;
        }
        done();
      });
      Page.cmd("dbQuery", ["SELECT site_report.* FROM json LEFT JOIN site_report USING (json_id) WHERE ?", {directory: user_dir}], (res) => {
        for (var i = 0; i < res.length; i++) {
          var row = res[i];
          if (!row["target_dir"]) continue;
          var uri = row["target_dir"] + "_" + row["target_site_id"];
          if (row["kind"] === "vouch") {
            this.my_vouches[uri] = true;
          } else {
            this.my_reports[uri] = row["reason"];
          }
        }
        done();
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

    isEditor() {
      return Trust.isEditor(this.getUserDirectory());
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

    // ---- Signed-CRDT merge files ------------------------------------------
    //
    // Each collection lives in its OWN merge file under the user's directory:
    //   sites.json    - submitted site rows        -> site table
    //   stars.json    - star toggles               -> site_star table
    //   ratings.json  - classification votes       -> site_rating table
    //   reports.json  - reports and vouches        -> site_report table
    // A record is signed by the node (recordSign fills author + post_id + sign)
    // and UNION-merged into the on-disk set, so a write can never overwrite
    // another record. Deletes are signed tombstones, edits/re-toggles are new
    // versions of the same (author, key). The node folds every version to its
    // live winners for the DB, so reads stay unchanged.

    mergeCollections() {
      return ["sites", "stars", "ratings", "reports", "claims"];
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
    // content.json files_merged map only while it is still absent, so a merge
    // file first seen in a later publish would never get declared - it would be
    // signed as a hashed last-writer-wins file instead. Creating all of them up
    // front makes the first declaration cover every collection.
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
    // records) and signs+bumps content.json, which propagates to peers.
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
    // this device has seen. The node derives a STABLE per-(author, key) post_id,
    // so an edit or re-toggle SUPERSEDES the prior record instead of adding one.
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

    // ---- One standing judgment per (user, listing) ------------------------

    // Set or clear this user's classification vote. label null clears.
    rate(target_dir, target_site_id, label, cb) {
      var uri = target_dir + "_" + target_site_id;
      var fields = {"target_dir": target_dir, "target_site_id": target_site_id, "label": label};
      this.editRecord("ratings", "r_" + uri, fields, label == null, (res) => {
        if (res === "ok") {
          if (label == null) {
            delete this.my_ratings[uri];
          } else {
            this.my_ratings[uri] = label;
          }
        }
        if (typeof cb === "function") cb(res);
      });
    }

    // File or update this user's report. reason null withdraws it.
    report(target_dir, target_site_id, reason, note, cb) {
      var uri = target_dir + "_" + target_site_id;
      var fields = {"kind": "report", "target_dir": target_dir, "target_site_id": target_site_id, "reason": reason, "note": note || ""};
      this.editRecord("reports", "report_" + uri, fields, reason == null, (res) => {
        if (res === "ok") {
          if (reason == null) {
            delete this.my_reports[uri];
          } else {
            this.my_reports[uri] = reason;
          }
        }
        if (typeof cb === "function") cb(res);
      });
    }

    // Claim a xite by proving control of its key: `owner_sign` is the xite's
    // own signature over Claim.challenge(). One standing claim per (user,
    // address), so re-claiming supersedes and releasing tombstones.
    claim(target_address, owner_sign, fields, cb) {
      // No claimant_dir in the record: the challenge names the directory, and
      // readers take that directory from json.directory (where the record
      // actually lives). Copying someone else's valid claim into your own dir
      // therefore fails to verify, which is what keeps the unsigned
      // descriptive fields honest.
      var address = ("" + target_address).toLowerCase();
      var record = {
        "target_address": address,
        "owner_sign": owner_sign
      };
      for (var k in fields) {
        if (fields[k] !== undefined) record[k] = fields[k];
      }
      this.editRecord("claims", "claim_" + address, record, false, (res) => {
        if (res === "ok") this.my_claims[address] = true;
        if (typeof cb === "function") cb(res);
      });
    }

    releaseClaim(target_address, cb) {
      var address = ("" + target_address).toLowerCase();
      this.editRecord("claims", "claim_" + address, {}, true, (res) => {
        if (res === "ok") delete this.my_claims[address];
        if (typeof cb === "function") cb(res);
      });
    }

    // Vouch: the counter-report. vouching false withdraws it.
    vouch(target_dir, target_site_id, vouching, cb) {
      var uri = target_dir + "_" + target_site_id;
      var fields = {"kind": "vouch", "target_dir": target_dir, "target_site_id": target_site_id, "reason": "", "note": ""};
      this.editRecord("reports", "vouch_" + uri, fields, !vouching, (res) => {
        if (res === "ok") {
          if (vouching) {
            this.my_vouches[uri] = true;
          } else {
            delete this.my_vouches[uri];
          }
        }
        if (typeof cb === "function") cb(res);
      });
    }

    // ---- Editor moderation ------------------------------------------------
    //
    // An editor listed in the users include's permission_rules "signers" is an
    // authorized signer of EVERY user directory, so the node accepts a signed
    // moderation tombstone written into the target user's own merge file and a
    // publish of the target's content.json (the EpixTalk production pattern).
    // Used only to hard-remove illegal content; ordinary bad listings are
    // handled by the report thresholds.
    moderateDelete(target_dir, site_id, cb) {
      var target = new User(null, target_dir);
      target.getRecords("sites", (container) => {
        var maxClock = 0, orig = null;
        container.post.forEach((r) => {
          if (r.key === "site_" + site_id) {
            if (r.clock > maxClock) maxClock = r.clock;
            if (!orig || (r.clock || 0) >= (orig.clock || 0)) orig = r;
          }
        });
        if (!orig) {
          if (typeof cb === "function") cb({"error": "Record not found"});
          return;
        }
        if (orig.post_id == null) {
          // Without the original post_id the node would derive a keyed id from
          // the MODERATOR's author: a silent no-op tombstone.
          if (typeof cb === "function") cb({"error": "Record has no post_id yet, try again after it syncs"});
          return;
        }
        var record = {
          "post_id": orig.post_id,
          "key": orig.key,
          "nonce": orig.nonce,
          "clock": Math.max(maxClock + 1, Date.now()),
          "supersedes": maxClock,
          "deleted": true,
          "moderated": true,
          "date_added": orig.date_added
        };
        Page.cmd("recordSign", [record], (signed) => {
          if (!signed || signed.error) {
            if (typeof cb === "function") cb(signed);
            return;
          }
          var container_out = {"record_format": "epix-orset-1", "post": [signed]};
          Page.cmd("fileWrite", [target.getPath() + "/sites.json", Text.fileEncode(container_out)], () => {
            Page.cmd("sitePublish", {"inner_path": target.getPath() + "/content.json"}, (res_pub) => {
              this.log("moderateDelete", target_dir, site_id, res_pub);
              if (typeof cb === "function") cb("ok");
            });
          });
        });
      });
    }
  }

  Object.assign(User.prototype, LogMixin);
  window.User = User;

})();
