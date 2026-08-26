(function() {

  var RATING_LABELS = [["g", "G"], ["m", "M"], ["a", "A"]];

  class Site {
    constructor(row) {
      this.row = row;
      this.form_edit = null;
      this.menu_actions = new Menu();
      this.show_evidence = false;
      this.getUri = this.getUri.bind(this);
      this.isNew = this.isNew.bind(this);
      this.handleStarClick = this.handleStarClick.bind(this);
      this.handleOpenClick = this.handleOpenClick.bind(this);
      this.handleRateClick = this.handleRateClick.bind(this);
      this.handleActionsClick = this.handleActionsClick.bind(this);
      this.handleEvidenceClick = this.handleEvidenceClick.bind(this);
      this.handleEditClick = this.handleEditClick.bind(this);
      this.saveRow = this.saveRow.bind(this);
      this.deleteRow = this.deleteRow.bind(this);
      this.render = this.render.bind(this);
    }

    getUri() {
      return this.row.directory + "_" + this.row.site_id;
    }

    // Trust info computed by the shared deterministic pass. Always present once
    // SiteLists has loaded; the fallback keeps a render between updates safe.
    getInfo() {
      return Page.site_lists.trust[this.getUri()] || null;
    }

    isNew() {
      var now = Time.timestamp();
      // Clamp client-set timestamps so a future date cannot pin "New" forever.
      var added = Math.min(this.row.date_added, now + 120);
      return now - added < 60 * 60 * 24;
    }

    isMine() {
      return this.row.directory === Page.user.getUserDirectory();
    }

    requireCert(retry) {
      if (Page.site_info.cert_user_id) return true;
      Page.user.certSelect(() => {
        retry();
      });
      return false;
    }

    handleStarClick() {
      if (!this.requireCert(this.handleStarClick)) return false;

      var uri = this.getUri();
      var starring = !Page.user.starred[uri];

      // Optimistic toggle.
      Page.user.starred[uri] = starring;
      Page.projector.scheduleRender();

      // A star is a live signed record keyed by the starred site uri; an unstar
      // is a signed tombstone of the same key. Union-merged into stars.json, so
      // it can never clobber another star and needs no sync guard.
      Page.user.editRecord("stars", uri, {"site_uri": uri, "value": 1}, !starring, (res) => {
        if (res !== "ok") {
          Page.user.starred[uri] = !starring;
        }
        Page.projector.scheduleRender();
        Page.site_lists.update();
      });
      return false;
    }

    handleRateClick(e) {
      var label = e.currentTarget.attributes["data-label"].value;
      if (!this.requireCert(() => { this.handleRateClick(e); })) return false;
      var uri = this.getUri();
      if (this.isMine()) {
        Page.cmd("wrapperNotification", ["info", "Your submission's declared rating is already your vote. Edit the listing to change it."]);
        return false;
      }
      var next = Page.user.my_ratings[uri] === label ? null : label;
      Page.user.my_ratings[uri] = next;  // optimistic
      if (next == null) delete Page.user.my_ratings[uri];
      Page.projector.scheduleRender();
      Page.user.rate(this.row.directory, this.row.site_id, next, () => {
        Page.site_lists.update();
      });
      return false;
    }

    // Warned, delisted, and sandboxed listings open through an interstitial.
    handleOpenClick(e) {
      var info = this.getInfo();
      var needs_confirm = info && (info.state === "warned" || info.state === "delisted" || info.sandbox);
      if (!needs_confirm) return true;  // normal navigation

      var reasons = [];
      if (info.evidence.reports.length) {
        var counts = {};
        info.evidence.reports.forEach(function(r) {
          counts[r.reason] = (counts[r.reason] || 0) + 1;
        });
        for (var reason in counts) {
          reasons.push(Trust.reasonName(reason) + " (" + counts[reason] + ")");
        }
      }
      var what;
      if (info.state === "delisted") {
        what = "This xite is delisted by community reports: " + reasons.join(", ") + ".";
      } else if (info.state === "warned") {
        what = "This xite has open reports: " + reasons.join(", ") + ".";
      } else {
        what = "This xite was submitted by an unverified identity and has not been checked by the community yet.";
      }
      var address = this.row.address;
      Page.cmd("wrapperConfirm", [what + " Open it anyway?", "Open"], function() {
        var link = document.createElement("a");
        link.href = "/" + address;
        link.target = "_top";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      });
      return false;
    }

    handleActionsClick() {
      var uri = this.getUri();
      var my_report = Page.user.my_reports[uri];
      var my_vouch = Page.user.my_vouches[uri];
      this.menu_actions.items = [];

      if (!this.isMine()) {
        var reasons = Trust.reasons();
        Object.keys(reasons).forEach((reason) => {
          var title = (my_report === reason ? "✓ " : "") + "Report: " + reasons[reason];
          this.menu_actions.addItem(title, () => {
            this.submitReport(reason);
          });
        });
        this.menu_actions.addItem("---", null);
        if (my_report) {
          this.menu_actions.addItem("Withdraw my report", () => {
            this.withCert(() => {
              Page.user.report(this.row.directory, this.row.site_id, null, null, () => Page.site_lists.update());
            });
          });
        }
        if (my_vouch) {
          this.menu_actions.addItem("Withdraw my vouch", () => {
            this.withCert(() => {
              Page.user.vouch(this.row.directory, this.row.site_id, false, () => Page.site_lists.update());
            });
          });
        } else {
          this.menu_actions.addItem("Vouch: I checked, it's fine", () => {
            this.withCert(() => {
              Page.user.vouch(this.row.directory, this.row.site_id, true, () => Page.site_lists.update());
            });
          });
        }
      }
      if (Page.user.isEditor() && !this.isMine()) {
        this.menu_actions.addItem("---", null);
        this.menu_actions.addItem("Editor: remove listing", () => {
          Page.cmd("wrapperConfirm", ["Remove this listing with a signed moderation tombstone? This is for illegal content; ordinary bad listings are handled by reports.", "Remove"], () => {
            Page.user.moderateDelete(this.row.directory, this.row.site_id, () => Page.site_lists.update());
          });
        });
      }
      if (this.isMine()) {
        this.menu_actions.addItem("Edit my listing", () => {
          this.handleEditClick();
        });
      }
      this.menu_actions.toggle();
      return false;
    }

    withCert(fn) {
      if (Page.site_info.cert_user_id) {
        fn();
      } else {
        Page.user.certSelect(fn);
      }
    }

    submitReport(reason) {
      this.withCert(() => {
        Page.cmd("wrapperPrompt", ["Add a short note to your " + Trust.reasonName(reason).toLowerCase() + " report (optional):"], (note) => {
          if (note === false) return;  // cancelled
          if (note && note.length > 200) note = note.substring(0, 200);
          Page.user.report(this.row.directory, this.row.site_id, reason, note || "", (res) => {
            if (res === "ok") {
              Page.cmd("wrapperNotification", ["done", "Report filed. It is a public, signed record tied to your xId."]);
            }
            Page.site_lists.update();
          });
        });
      });
    }

    handleEvidenceClick() {
      this.show_evidence = !this.show_evidence;
      Page.projector.scheduleRender();
      return false;
    }

    saveRow(cb) {
      // An edit is a new signed version of the same site record (same key ->
      // same post_id -> supersedes); it can never touch another submission.
      Page.user.editRecord("sites", "site_" + this.row.site_id, {
        "site_id": this.row.site_id,
        "date_added": this.row.date_added,
        "category": parseInt(this.row.category),
        "subcat": this.row.subcat,
        "language": this.row.language,
        "title": this.row.title,
        "description": this.row.description,
        "address": this.row.address,
        "tags": this.row.tags,
        "rating": this.row.rating
      }, false, (res) => {
        Page.site_lists.update();
        if (typeof cb === "function") cb(res);
      });
    }

    deleteRow(cb) {
      // A delete is a signed tombstone of this site record, NOT a splice:
      // absence is not deletion on the network.
      Page.user.editRecord("sites", "site_" + this.row.site_id, {}, true, (res) => {
        Page.site_lists.update();
        if (typeof cb === "function") cb(res);
      });
    }

    handleEditClick() {
      if (!this.isMine()) return false;
      if (!this.form_edit) {
        this.form_edit = new Form();
        this.form_edit.addField("text", "address", "Address", {placeholder: "e.g. epix1abc123...", required: true, validate: this.form_edit.shouldBeZite});
        this.form_edit.addField("text", "title", "Title", {placeholder: "e.g. Epix Blog", required: true});
        this.form_edit.addField("text", "description", "Description", {placeholder: "What is this xite about?", required: true});
        this.form_edit.addField("radio", "category", "Category", {required: true, values: Page.categories});
        this.form_edit.addField("radio", "language", "Language", {required: true, values: Page.languages, classes: {"radiogroup-lang": true}});
        this.form_edit.addField("radio", "rating", "Content rating", {required: true, values: [["g", "General"], ["m", "Mature"], ["a", "Adult"]]});
        this.form_edit.addField("text", "tags", "Tags", {placeholder: "up to 5, comma separated", required: false});
      }
      if (!this.row.rating) this.row.rating = "g";
      this.form_edit.setData(this.row);
      this.form_edit.saveRow = this.saveRow;
      this.form_edit.deleteRow = this.deleteRow;
      Page.setFormEdit(this.form_edit);
      return false;
    }

    renderChips(info) {
      var chips = [];
      if (info) {
        if (info.severity !== "g") {
          chips.push(h("span.chip.chip-rating.chip-" + info.severity, {key: "sev", title: Trust.labelName(info.severity) + " content"}, Trust.labelName(info.severity)));
        }
        if (info.state === "delisted") {
          chips.push(h("span.chip.chip-state.chip-delisted", {key: "state"}, "Delisted"));
        } else if (info.state === "warned") {
          chips.push(h("span.chip.chip-state.chip-warned", {key: "state"}, "Reported"));
        } else if (info.state === "mislabeled") {
          chips.push(h("span.chip.chip-state.chip-mislabeled", {key: "state", title: "The community rates this stricter than its submitter declared"}, "Mislabeled"));
        } else if (info.state === "verified") {
          chips.push(h("span.chip.chip-state.chip-verified", {key: "state", title: "Community-confirmed rating"}, "✓"));
        }
        if (info.caution) {
          chips.push(h("span.chip.chip-caution", {key: "caution", title: "This xite has an open report"}, "!"));
        }
      }
      if (this.isNew()) {
        chips.push(h("span.chip.chip-new", {key: "new"}, "New"));
      }
      return chips;
    }

    renderEvidence(info) {
      if (!this.show_evidence || !info) return null;
      var votes = info.votes;
      var vote_rows = [["g", votes.g], ["m", votes.m], ["a", votes.a]];
      var max_w = Math.max(votes.g, votes.m, votes.a, 1);
      return h("div.evidence", {key: "evidence", enterAnimation: Animation.slideDown, exitAnimation: Animation.slideUp}, [
        h("div.evidence-section", [
          h("div.evidence-title", "Community rating (weighted)"),
          vote_rows.map(function(vr) {
            return h("div.evidence-vote", {key: vr[0]}, [
              h("span.evidence-vote-label", Trust.labelName(vr[0])),
              h("span.evidence-vote-bar", h("span.evidence-vote-fill.fill-" + vr[0], {styles: {width: Math.round(vr[1] / max_w * 100) + "%"}})),
              h("span.evidence-vote-num", "" + Math.round(vr[1] * 10) / 10)
            ]);
          }),
          info.settled ? null : h("div.evidence-note", "Not settled yet: needs more votes from established users.")
        ]),
        info.evidence.reports.length ? h("div.evidence-section", [
          h("div.evidence-title", "Reports"),
          info.evidence.reports.map(function(r, i) {
            return h("div.evidence-report", {key: "r" + i}, [
              h("span.evidence-reason", Trust.reasonName(r.reason)),
              h("span.evidence-author", " by " + Text.formatUsername(r.author)),
              r.note ? h("div.evidence-note", "“" + r.note + "”") : null
            ]);
          })
        ]) : null,
        info.evidence.vouches.length ? h("div.evidence-section", [
          h("div.evidence-title", "Vouches"),
          info.evidence.vouches.map(function(v, i) {
            return h("span.evidence-vouch", {key: "v" + i}, Text.formatUsername(v.author));
          })
        ]) : null
      ]);
    }

    render() {
      var info = this.getInfo();
      var uri = this.getUri();
      var my_rating = Page.user.my_ratings[uri];
      var starred = Page.user.starred[uri];
      var untrusted_submitter = info ? info.submitter_w <= 0 : false;
      var state = info ? info.state : "unverified";
      var blur = Page.site_lists.safe_mode && state === "warned";

      var star_count = info ? info.star_count : (this.row.star || 0);

      return h("div.site-card", {key: uri, enterAnimation: Animation.slideDown, exitAnimation: Animation.slideUp,
        classes: {mine: this.isMine(), starred: starred, blur: blur, "state-warned": state === "warned", "state-delisted": state === "delisted", "state-mislabeled": state === "mislabeled"}}, [
        h("div.site-head", [
          h("a.site-title", {href: "/" + this.row.address, onclick: this.handleOpenClick, title: this.row.address}, this.row.title),
          h("div.site-chips", {onclick: this.handleEvidenceClick}, this.renderChips(info))
        ]),
        h("div.site-description", this.row.description),
        (state === "warned" || state === "delisted") ? h("div.site-banner", [
          h("span.site-banner-text", state === "delisted" ? "Delisted by community reports" : "Reported by the community"),
          h("a.site-banner-why", {href: "#Evidence", onclick: this.handleEvidenceClick}, this.show_evidence ? "hide" : "why?")
        ]) : null,
        h("div.site-foot", [
          h("span.site-by", {classes: {untrusted: untrusted_submitter}, title: this.row.cert_user_id || this.row.directory},
            Text.formatUsername(this.row.directory)),
          h("span.site-foot-right", [
            this.row.peers ? h("span.site-peers", {title: this.row.peers + " peers seeding"}, [h("span.dot-live"), " " + this.row.peers]) : null,
            h("span.rate-group", {title: "Rate the content: General / Mature / Adult"}, RATING_LABELS.map((rl) => {
              return h("a.rate", {key: rl[0], href: "#Rate", "data-label": rl[0], onclick: this.handleRateClick,
                classes: {active: my_rating === rl[0], mine_declared: this.isMine() && this.row.rating === rl[0]}}, rl[1]);
            })),
            h("a.star", {href: "#Star", onclick: this.handleStarClick, classes: {active: starred}}, [
              h("span.icon-star"),
              star_count ? h("span.num", " " + star_count) : null
            ]),
            h("span.actions-wrap", [
              h("a.actions", {href: "#Actions", onmousedown: this.handleActionsClick, onclick: Page.returnFalse, title: "Report, vouch, or edit"}, "⋯"),
              this.menu_actions.render(".actions-menu")
            ])
          ])
        ]),
        this.renderEvidence(info)
      ]);
    }
  }

  Object.assign(Site.prototype, LogMixin);
  window.Site = Site;

})();
