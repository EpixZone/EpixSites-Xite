(function() {

  // The deterministic trust pass. Pure function of the four query result sets
  // plus the owner-signed constants in content.json settings.trust, so every
  // client computes identical states from identical replicated data.
  //
  // Phase 1 weights (no witness snapshot yet): editors carry editor_weight,
  // any paid name.epix directory carries member_weight, and everything else
  // carries ZERO. The zero for non-.epix directories is a security rule, not
  // a style choice: raw-address directories cost nothing to mint, so they get
  // no standing in any tally, quorum, or reporter count.

  var DEFAULTS = {
    editor_weight: 3,
    member_weight: 1,
    warn_net: 2,
    delist_net: 5,
    delist_min_reporters: 2,
    settle_weight: 3,
    adult_abs: 1.5,
    adult_frac: 0.35,
    mature_abs: 1,
    mature_frac: 0.5,
    sev: {"malware": 1, "illegal": 1, "scam": 1, "dead": 0, "spam": 0}
  };

  var SEV_RANK = {"g": 0, "m": 1, "a": 2};
  var LABELS = {"g": "General", "m": "Mature", "a": "Adult"};
  var REASONS = {
    "malware": "Malware",
    "illegal": "Illegal content",
    "scam": "Scam or phishing",
    "dead": "Dead or broken",
    "spam": "Spam or duplicate"
  };

  class Trust {
    config() {
      var settings = Page.site_info && Page.site_info.content && Page.site_info.content.settings;
      var trust = (settings && settings.trust) || {};
      var conf = {};
      for (var key in DEFAULTS) {
        conf[key] = trust[key] !== undefined ? trust[key] : DEFAULTS[key];
      }
      if (!conf.sev) conf.sev = DEFAULTS.sev;
      return conf;
    }

    editors() {
      var settings = Page.site_info && Page.site_info.content && Page.site_info.content.settings;
      return (settings && settings.editors) || [];
    }

    isEditor(directory) {
      return this.editors().indexOf(directory) !== -1;
    }

    weightOf(directory) {
      if (!directory) return 0;
      if (this.isEditor(directory)) return this.config().editor_weight;
      if (/\.epix$/.test(directory)) return this.config().member_weight;
      return 0;
    }

    sevRank(label) {
      return SEV_RANK[label] !== undefined ? SEV_RANK[label] : 0;
    }

    labelName(label) {
      return LABELS[label] || LABELS["g"];
    }

    reasonName(reason) {
      return REASONS[reason] || reason;
    }

    reasons() {
      return REASONS;
    }

    // rows:    site JOIN json JOIN site_stat rows (directory, cert_user_id, peers)
    // ratings: site_rating JOIN json rows (target_dir, target_site_id, label, voter)
    // reports: site_report JOIN json rows (kind, target_dir, target_site_id, reason, note, date_added, author)
    // stars:   site_star JOIN json rows (site_uri, starrer)
    // Returns {byUri: {uri: info}} with every state, score, and evidence list.
    compute(rows, ratings, reports, stars) {
      var conf = this.config();
      var byUri = {};
      var i, row, uri;

      var weights = {};
      var weightOf = (dir) => {
        if (weights[dir] === undefined) weights[dir] = this.weightOf(dir);
        return weights[dir];
      };

      for (i = 0; i < rows.length; i++) {
        row = rows[i];
        uri = row.directory + "_" + row.site_id;
        var declared = SEV_RANK[row.rating] !== undefined ? row.rating : "g";
        byUri[uri] = {
          uri: uri,
          row: row,
          declared: declared,
          votes: {g: 0, m: 0, a: 0, count: 0},
          star_count: 0,
          star_w: 0,
          net: 0,
          dead_w: 0,
          spam_w: 0,
          harmful_reporters: {},
          vouch_w: 0,
          submitter_w: weightOf(row.directory),
          evidence: {ratings: [], reports: [], vouches: []}
        };
        // The submitter's declared rating is their own classification vote.
        byUri[uri].votes[declared] += byUri[uri].submitter_w;
      }

      for (i = 0; i < ratings.length; i++) {
        var vote = ratings[i];
        uri = vote.target_dir + "_" + vote.target_site_id;
        var vinfo = byUri[uri];
        if (!vinfo) continue;
        if (SEV_RANK[vote.label] === undefined) continue;
        if (vote.voter === vinfo.row.directory) continue;  // self-votes count nothing
        var vw = weightOf(vote.voter);
        vinfo.votes[vote.label] += vw;
        vinfo.votes.count++;
        vinfo.evidence.ratings.push({voter: vote.voter, label: vote.label, weight: vw});
      }

      for (i = 0; i < reports.length; i++) {
        var rep = reports[i];
        uri = rep.target_dir + "_" + rep.target_site_id;
        var rinfo = byUri[uri];
        if (!rinfo) continue;
        if (rep.author === rinfo.row.directory) continue;  // self-reports and self-vouches count nothing
        var rw = weightOf(rep.author);
        if (rep.kind === "vouch") {
          rinfo.vouch_w += rw;
          rinfo.evidence.vouches.push({author: rep.author, weight: rw, date_added: rep.date_added});
        } else if (rep.kind === "report" && REASONS[rep.reason]) {
          var sev = conf.sev[rep.reason] !== undefined ? conf.sev[rep.reason] : 0;
          if (sev > 0) {
            rinfo.net += rw * sev;
            if (rw > 0) rinfo.harmful_reporters[rep.author] = true;
          } else if (rep.reason === "dead") {
            rinfo.dead_w += rw;
          } else {
            rinfo.spam_w += rw;
          }
          rinfo.evidence.reports.push({author: rep.author, reason: rep.reason, note: rep.note, weight: rw, date_added: rep.date_added});
        }
      }

      for (i = 0; i < stars.length; i++) {
        var star = stars[i];
        var sinfo = byUri[star.site_uri];
        if (!sinfo) continue;
        if (star.starrer === sinfo.row.directory) continue;
        sinfo.star_count++;
        sinfo.star_w += weightOf(star.starrer);
      }

      for (uri in byUri) {
        var info = byUri[uri];
        info.net -= info.vouch_w;

        // Community label: safety-biased weighted thresholds over external
        // votes plus the submitter's declared vote.
        var w_a = info.votes.a;
        var w_ma = info.votes.m + info.votes.a;
        var wt = info.votes.g + info.votes.m + info.votes.a;
        var external_w = wt - info.submitter_w;
        if (w_a >= conf.adult_abs && w_a >= conf.adult_frac * wt) {
          info.effective = "a";
        } else if (w_ma >= conf.mature_abs && w_ma >= conf.mature_frac * wt) {
          info.effective = "m";
        } else {
          info.effective = "g";
        }
        info.settled = external_w >= conf.settle_weight;

        var reporter_count = 0;
        for (var author in info.harmful_reporters) reporter_count++;

        if (info.net >= conf.delist_net && reporter_count >= conf.delist_min_reporters) {
          info.state = "delisted";
        } else if (info.net >= conf.warn_net) {
          info.state = "warned";
        } else if (info.settled && SEV_RANK[info.effective] > SEV_RANK[info.declared]) {
          info.state = "mislabeled";
        } else if (info.settled && info.effective === info.declared) {
          info.state = "verified";
        } else {
          info.state = "unverified";
        }
        info.reporter_count = reporter_count;
        info.caution = info.net > 0 && info.state !== "warned" && info.state !== "delisted";
        info.sandbox = info.submitter_w <= 0;

        // Display severity is always the worse of declared and settled labels.
        if (info.settled && SEV_RANK[info.effective] > SEV_RANK[info.declared]) {
          info.severity = info.effective;
        } else {
          info.severity = info.declared;
        }

        if (info.state === "delisted") {
          info.rank_mult = 0;
        } else if (info.state === "warned" || info.state === "mislabeled") {
          info.rank_mult = 0.25;
        } else if (info.state === "unverified") {
          info.rank_mult = info.sandbox ? 0.5 : 0.75;
        } else {
          info.rank_mult = 1;
        }

        var peers = Math.min(200, info.row.peers || 0);
        var star_term = 20 * Math.min(15, info.star_w);
        info.score = (peers + star_term) * info.rank_mult - 0.2 * info.dead_w - 0.1 * info.spam_w;
      }

      return byUri;
    }
  }

  window.Trust = new Trust();

})();
