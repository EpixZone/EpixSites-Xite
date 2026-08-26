(function() {

  // Ownership claims.
  //
  // A xite address IS a public key, so the person holding that key can prove
  // they own the listed xite: they sign a challenge with it, and every client
  // checks the signature locally through the node's ecdsaVerify. No approval,
  // no bot, no trust in the claimant.
  //
  // The challenge binds the directory, the claimed address, and the claiming
  // identity, so a signature cannot be replayed for another claimant, another
  // xite, or another directory.

  var CHALLENGE_VERSION = "v1";

  class Claim {
    // The exact string an owner signs with their xite's private key.
    challenge(target_address, claimant_dir) {
      var directory = Page.site_info ? Page.site_info.address : "";
      return [
        "epixsites-claim",
        CHALLENGE_VERSION,
        directory,
        ("" + target_address).toLowerCase(),
        claimant_dir
      ].join(":");
    }

    // What the owner runs on their own machine. The key never touches this
    // page: only the signature comes back.
    signCommand(target_address, claimant_dir) {
      var challenge = this.challenge(target_address, claimant_dir);
      return "epix-server siteCmd " + target_address + " ecdsaSign '[\"" + challenge + "\", \"<your xite private key>\"]'";
    }

    // ecdsaVerify is a websocket round trip, so results are cached by
    // signature for the session: a claim's validity cannot change, and the
    // listing refresh re-runs this on every file_done event.
    constructor() {
      this.verified = {};   // owner_sign -> true/false
      this.pending = {};
    }

    isVerified(row) {
      return this.verified[row.owner_sign] === true;
    }

    // Verify every claim we have not seen before, then call back. Rows that
    // fail verification are simply never applied.
    verifyAll(rows, cb) {
      var todo = [];
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (!row.owner_sign || !row.target_address || !row.claimant_dir) continue;
        if (this.verified[row.owner_sign] !== undefined) continue;
        if (this.pending[row.owner_sign]) continue;
        this.pending[row.owner_sign] = true;
        todo.push(row);
      }
      if (!todo.length) {
        if (typeof cb === "function") cb();
        return;
      }
      var left = todo.length;
      var done = () => {
        left--;
        if (left === 0 && typeof cb === "function") cb();
      };
      todo.forEach((row) => {
        var challenge = this.challenge(row.target_address, row.claimant_dir);
        Page.cmd("ecdsaVerify", [challenge, row.target_address, row.owner_sign], (ok) => {
          this.verified[row.owner_sign] = ok === true;
          delete this.pending[row.owner_sign];
          done();
        });
      });
    }

    // The winning claim per address: verified only, latest clock wins, which
    // is what lets an owner move the claim to a new identity or hand the xite
    // over to a new key holder.
    resolve(rows) {
      var by_address = {};
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (!this.isVerified(row)) continue;
        var address = ("" + row.target_address).toLowerCase();
        var current = by_address[address];
        if (!current || (row.date_added || 0) > (current.date_added || 0)) {
          by_address[address] = row;
        }
      }
      return by_address;
    }

    // Apply the owner's authoritative description to a listing row.
    //
    // Descriptive fields only. The safety rating is deliberately NOT the
    // owner's to lower: a claim can make a listing STRICTER than its
    // submitter declared, never softer, so claiming a xite can never be used
    // to shed a Mature or Adult label.
    apply(row, claim) {
      row.claimed_by = claim.claimant_dir;
      row.claim_date = claim.date_added;
      if (claim.title) row.title = claim.title;
      if (claim.description) row.description = claim.description;
      if (claim.category !== undefined && claim.category !== null && claim.category !== "") {
        row.category = parseInt(claim.category);
      }
      if (claim.subcat) row.subcat = claim.subcat;
      if (claim.language) row.language = claim.language;
      if (claim.tags !== undefined && claim.tags !== null) row.tags = claim.tags;
      if (Trust.sevRank(claim.rating) > Trust.sevRank(row.rating)) {
        row.rating = claim.rating;
      }
      return row;
    }
  }

  window.Claim = new Claim();

})();
