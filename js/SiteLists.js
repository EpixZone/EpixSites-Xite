(function() {

  class SiteLists {
    constructor() {
      this.menu_filters = new Menu();
      this.state = null;
      this.filter_lang = {};
      this.safe_mode = true;
      this.site_add = new SiteAdd();
      this.site_lists = [];
      this.site_lists_db = {};
      this.search_list = new ItemList(Site, "uri");
      this.flagged_list = new ItemList(Site, "uri");
      this.rows = [];
      this.trust = {};
      this.claims = {};
      this.flagged_count = 0;
      this.need_update = false;
      this.loaded = false;
      this.num_total = null;
      this.filter_category = null;
      this.search_text = "";
      this.cols = 3;

      this.handleFilterLanguageClick = this.handleFilterLanguageClick.bind(this);
      this.renderFilterLanguage = this.renderFilterLanguage.bind(this);
      this.handleFiltersClick = this.handleFiltersClick.bind(this);
      this.handleSiteAddClick = this.handleSiteAddClick.bind(this);
      this.formatFilterTitle = this.formatFilterTitle.bind(this);
      this.setFilterCategory = this.setFilterCategory.bind(this);
      this.getVisibleSiteLists = this.getVisibleSiteLists.bind(this);
      this.update = this.update.bind(this);
      this.render = this.render.bind(this);

      Page.on_site_info.then(() => {
        Page.on_local_storage.then(() => {
          this.filter_lang = Page.local_storage.filter_lang;
          if (Page.local_storage.safe_mode !== undefined) {
            this.safe_mode = Page.local_storage.safe_mode;
          }
          var categories = Page.site_info.content.settings.categories;
          for (var i = 0; i < categories.length; i++) {
            var id = categories[i][0];
            var title = categories[i][1];
            var site_list = new SiteList({id: id, title: title, sites: []});
            this.site_lists_db[id] = site_list;
            this.site_lists.push(site_list);
          }
          this.update();
        });
      });

      window.onresize = () => {
        if (window.innerWidth < 720) {
          this.cols = 1;
        } else if (window.innerWidth < 1200) {
          this.cols = 2;
        } else {
          this.cols = 3;
        }
        Page.projector.scheduleRender();
      };
      window.onresize();
    }

    // Load the four result sets and run the shared deterministic trust pass.
    // All ordering, filtering, and state logic happens client-side over these
    // rows, so search and browse stay consistent with the trust states.
    update() {
      var results = {};
      var pending = 5;
      var done = () => {
        pending--;
        if (pending > 0) return;
        // Ownership claims carry a signature by the claimed xite's own key.
        // Verifying is a websocket round trip, so it happens once per
        // signature here, before the deterministic pass consumes the result.
        Claim.verifyAll(results.claims || [], () => {
          this.applyResults(results);
        });
      };

      this.logStart("Sites");
      Page.cmd("dbQuery", "SELECT site.*, json.directory AS directory, json.cert_user_id AS cert_user_id, site_stat.peers AS peers " +
        "FROM site LEFT JOIN json USING (json_id) " +
        "LEFT JOIN site_stat ON (site_stat.site_uri = json.directory || '_' || site.site_id)", (res) => {
        results.sites = res;
        done();
      });
      Page.cmd("dbQuery", "SELECT site_rating.target_dir, site_rating.target_site_id, site_rating.label, json.directory AS voter " +
        "FROM site_rating LEFT JOIN json USING (json_id)", (res) => {
        results.ratings = res;
        done();
      });
      Page.cmd("dbQuery", "SELECT site_report.kind, site_report.target_dir, site_report.target_site_id, site_report.reason, site_report.note, site_report.date_added, json.directory AS author " +
        "FROM site_report LEFT JOIN json USING (json_id)", (res) => {
        results.reports = res;
        done();
      });
      Page.cmd("dbQuery", "SELECT site_star.site_uri, json.directory AS starrer " +
        "FROM site_star LEFT JOIN json USING (json_id)", (res) => {
        results.stars = res;
        done();
      });
      // claimant_dir comes from the directory the record LIVES in, never from
      // a field inside it: that is what binds an owner's signature to one
      // identity and stops a valid claim being copied and edited elsewhere.
      Page.cmd("dbQuery", "SELECT site_claim.*, json.directory AS claimant_dir " +
        "FROM site_claim LEFT JOIN json USING (json_id)", (res) => {
        results.claims = res;
        done();
      });
    }

    applyResults(results) {
      // Dedup by uri: identity everywhere is directory_site_id, and a crafted
      // sites.json can fold two live rows onto one uri.
      var rows = [];
      var seen_uri = {};
      var raw = results.sites || [];
      var now = Time.timestamp();
      // Verified ownership claims, by claimed address.
      this.claims = Claim.resolve(results.claims || []);
      for (var i = 0; i < raw.length; i++) {
        var row = raw[i];
        row.uri = row.directory + "_" + row.site_id;
        if (seen_uri[row.uri]) continue;
        seen_uri[row.uri] = true;
        // The owner's description wins over the submitter's, but the listing
        // keeps its original identity so its votes, reports and stars carry
        // over: claiming a xite must never reset what the community said.
        var claim = this.claims[("" + row.address).toLowerCase()];
        if (claim) Claim.apply(row, claim);
        // A date beyond plausible clock skew is untrusted: clamping it forward
        // would keep it at the top of New forever, so sort it to the bottom.
        row.date_sort = row.date_added > now + 120 ? 0 : row.date_added;
        rows.push(row);
      }
      this.trust = Trust.compute(rows, results.ratings || [], results.reports || [], results.stars || []);
      this.rows = rows;
      this.distribute();

      this.loaded = true;
      this.num_total = rows.length;
      this.logEnd("Sites", "found: " + this.num_total);
      Page.on_loaded.resolve();
      Page.projector.scheduleRender();
    }

    // A listing is browsable when it is not delisted, not withdrawn by its
    // owner, and passes safe mode.
    isBrowsable(row) {
      var info = this.trust[row.uri];
      if (info && info.state === "delisted") return false;
      if (row.owner_hidden) return false;
      if (this.safe_mode) {
        if (info && info.severity === "a") return false;
        if (row.category === 13) return false;
      }
      return true;
    }

    passesLangFilter(row) {
      if (isEmpty(this.filter_lang)) return true;
      return !!this.filter_lang[row.language];
    }

    orderRows(rows) {
      var order_new = Page.head.active === "new";
      var trust = this.trust;
      return rows.slice().sort(function(a, b) {
        if (order_new) {
          return b.date_sort - a.date_sort;
        }
        var sa = trust[a.uri] ? trust[a.uri].score : 0;
        var sb = trust[b.uri] ? trust[b.uri].score : 0;
        if (sb !== sa) return sb - sa;
        return ("" + a.title).localeCompare("" + b.title);
      });
    }

    distribute() {
      var i, row;

      // Category browse lists
      var by_category = {};
      for (i = 0; i < this.rows.length; i++) {
        row = this.rows[i];
        if (!this.isBrowsable(row) || !this.passesLangFilter(row)) continue;
        if (!by_category[row.category]) by_category[row.category] = [];
        by_category[row.category].push(row);
      }
      for (var category in this.site_lists_db) {
        this.site_lists_db[category].item_list.sync(this.orderRows(by_category[category] || []));
      }

      // Search results
      if (this.search_text) {
        this.search_list.sync(this.searchRows(this.search_text));
      } else {
        this.search_list.sync([]);
      }

      // Flagged audit view: warned + delisted, nothing hidden, evidence shown.
      var flagged = [];
      var delisted_count = 0;
      for (i = 0; i < this.rows.length; i++) {
        row = this.rows[i];
        var info = this.trust[row.uri];
        // Owner withdrawal removes a listing from browse and search, but a
        // reported one stays auditable here: hiding a xite must never be a
        // way to shed the reports against it.
        if (info && (info.state === "warned" || info.state === "delisted")) {
          flagged.push(row);
          if (info.state === "delisted") delisted_count++;
        }
      }
      this.flagged_count = flagged.length;
      this.delisted_count = delisted_count;
      this.flagged_list.sync(this.orderRows(flagged));
    }

    // Term-AND search over title, description, tags, address, subcat, and the
    // category name, ranked by field weight times the trust-adjusted score.
    searchRows(text) {
      var terms = text.toLowerCase().split(/\s+/).filter(function(t) { return t.length; }).slice(0, 6);
      if (!terms.length) return [];
      var cat_names = {};
      for (var ci = 0; ci < Page.categories.length; ci++) {
        cat_names[Page.categories[ci][0]] = ("" + Page.categories[ci][1]).toLowerCase();
      }
      var trust = this.trust;
      var scored = [];
      for (var i = 0; i < this.rows.length; i++) {
        var row = this.rows[i];
        if (!this.isBrowsable(row) || !this.passesLangFilter(row)) continue;
        var title = ("" + (row.title || "")).toLowerCase();
        var description = ("" + (row.description || "")).toLowerCase();
        var tags = ("" + (row.tags || "")).toLowerCase();
        var address = ("" + (row.address || "")).toLowerCase();
        var subcat = ("" + (row.subcat || "")).toLowerCase();
        var cat_name = cat_names[row.category] || "";
        var match_score = 0;
        var matched_all = true;
        for (var ti = 0; ti < terms.length; ti++) {
          var term = terms[ti];
          var field_score = 0;
          if (title === term) field_score = 100;
          else if (title.indexOf(term) === 0) field_score = 60;
          else if (title.indexOf(term) !== -1) field_score = 40;
          else if (tags.indexOf(term) !== -1) field_score = 30;
          else if (address.indexOf(term) !== -1) field_score = 20;
          else if (subcat.indexOf(term) !== -1 || cat_name.indexOf(term) !== -1) field_score = 15;
          else if (description.indexOf(term) !== -1) field_score = 10;
          if (!field_score) {
            matched_all = false;
            break;
          }
          match_score += field_score;
        }
        if (!matched_all) continue;
        var info = trust[row.uri];
        row.search_score = match_score + (info ? info.score / 10 : 0);
        scored.push(row);
      }
      return scored.sort(function(a, b) {
        if (b.search_score !== a.search_score) return b.search_score - a.search_score;
        return ("" + a.title).localeCompare("" + b.title);
      }).slice(0, 50);
    }

    setSearch(text) {
      this.search_text = text || "";
      if (this.loaded) {
        this.distribute();
      }
      Page.projector.scheduleRender();
    }

    setSafeMode(on) {
      this.safe_mode = !!on;
      Page.local_storage.safe_mode = this.safe_mode;
      Page.saveLocalStorage();
      if (this.loaded) this.distribute();
      Page.projector.scheduleRender();
    }

    handleFilterLanguageClick(e) {
      var value = e.currentTarget.value;
      if (value === "all") {
        for (var key in this.filter_lang) {
          delete this.filter_lang[key];
        }
      } else if (this.filter_lang[value]) {
        delete this.filter_lang[value];
      } else {
        this.filter_lang[value] = true;
      }
      Page.saveLocalStorage();
      if (this.loaded) this.distribute();
      Page.projector.scheduleRender();
      return false;
    }

    renderFilterLanguage() {
      var items = [];
      for (var i = 0; i < Page.languages.length; i++) {
        var lang = Page.languages[i];
        items.push(h("a", {href: "#" + lang, onclick: this.handleFilterLanguageClick, value: lang, classes: {selected: this.filter_lang[lang], long: lang.length > 2}}, lang));
        items.push(" ");
      }
      return h("div.menu-radio",
        h("div", "Site languages: "),
        h("a.all", {href: "#all", onclick: this.handleFilterLanguageClick, value: "all", classes: {selected: isEmpty(this.filter_lang)}}, "Show all"),
        items
      );
    }

    handleFiltersClick() {
      this.menu_filters.items = [];
      this.menu_filters.items.push([this.renderFilterLanguage, null]);
      if (this.menu_filters.visible) {
        this.menu_filters.hide();
      } else {
        this.menu_filters.show();
      }
      return false;
    }

    handleSiteAddClick() {
      if (this.state === "siteadd") {
        this.state = null;
      } else {
        this.state = "siteadd";
      }
      this.site_add.updateDb();
      return false;
    }

    formatFilterTitle() {
      if (isEmpty(this.filter_lang)) {
        return "All languages";
      }
      var langs = [];
      for (var lang in this.filter_lang) {
        langs.push(lang);
      }
      return langs.join(", ");
    }

    setFilterCategory(filter_category) {
      this.filter_category = filter_category;
      if (this.loaded) {
        setTimeout(() => {
          Page.on_loaded.resolve();
        }, 600);
      }
    }

    getVisibleSiteLists() {
      if (this.filter_category) {
        return [this.site_lists_db[this.filter_category]];
      } else {
        return this.site_lists;
      }
    }

    renderToolbar() {
      return h("div.toolbar", [
        h("a.toolbar-submit.button.button-small", {href: "#Submit", onclick: this.handleSiteAddClick, classes: {active: this.state === "siteadd"}}, "+ Submit a xite"),
        h("span.toolbar-right", [
          h("a.toolbar-filter", {href: "#Filters", onmousedown: this.handleFiltersClick, onclick: Page.returnFalse}, this.formatFilterTitle()),
          this.menu_filters.render(".filter"),
          Page.site_info && Page.site_info.cert_user_id
            ? h("a.toolbar-user", {href: "#Select", onclick: Page.user.certSelect, title: "Switch identity"}, Page.site_info.cert_user_id.replace("@xid.epix", ""))
            : h("a.toolbar-user.anon", {href: "#Select", onclick: Page.user.certSelect}, "Connect xId")
        ])
      ]);
    }

    renderSkeleton() {
      var cards = [];
      for (var i = 0; i < 6; i++) {
        cards.push(h("div.site-card.skeleton", {key: "skel" + i}, [
          h("div.skeleton-line.w60"),
          h("div.skeleton-line.w90"),
          h("div.skeleton-line.w40")
        ]));
      }
      return h("div.sitelist", h("div.sites", cards));
    }

    renderFlagged() {
      return h("div.flagged-view", [
        h("div.flagged-note", "Nothing is silently removed: every warned or delisted listing stays auditable here, with its evidence."),
        this.flagged_list.items.length
          ? h("div.sites.sites-flat", this.flagged_list.items.map(function(item) { return item.render(); }))
          : h("h2.empty", "No flagged listings. Good.")
      ]);
    }

    renderSearch() {
      return h("div.search-view", [
        h("div.search-summary", this.search_list.items.length + " result" + (this.search_list.items.length === 1 ? "" : "s") + " for “" + this.search_text + "”"),
        this.search_list.items.length
          ? h("div.sites.sites-flat", this.search_list.items.map(function(item) { return item.render(); }))
          : h("h2.empty", "Nothing found. Try fewer or shorter words.")
      ]);
    }

    render() {
      if (this.need_update) {
        this.need_update = false;
        this.update();
      }

      var mode;
      if (Page.head.active === "flagged") {
        mode = "flagged";
      } else if (this.search_text) {
        mode = "search";
      } else {
        mode = "browse";
      }

      var i = 0;
      var body;
      if (!this.loaded) {
        body = this.renderSkeleton();
      } else if (mode === "flagged") {
        body = this.renderFlagged();
      } else if (mode === "search") {
        body = this.renderSearch();
      } else {
        var any = false;
        for (var si = 0; si < this.site_lists.length; si++) {
          if (this.site_lists[si].sites.length) {
            any = true;
            break;
          }
        }
        if (!any) {
          body = h("div.empty-state", [
            h("div.empty-state-title", this.num_total === 0 ? "The directory is empty" : "Nothing matches your filters"),
            h("div.empty-state-text", this.num_total === 0
              ? "Be the first: submit a xite and stand behind it with your xId."
              : "Loosen the language filter, or switch safe mode off to see more.")
          ]);
        } else {
          body = h("div.sitelists", this.site_lists.map(function(site_list) {
            if (site_list.sites.length) {
              i++;
            }
            return site_list.render(i);
          }));
        }
      }

      return h("div#SiteLists", {classes: {"state-siteadd": this.state === "siteadd"}},
        this.loaded ? this.renderToolbar() : null,
        this.site_add.render(),
        body,
        h("div.clear", " ")
      );
    }

    onSiteInfo(site_info) {
      if (site_info.event) {
        var action = site_info.event[0];
        var inner_path = site_info.event[1];
        if (action === "file_done" && ("" + inner_path).endsWith("json")) {
          RateLimit(1000, () => {
            this.need_update = true;
            Page.projector.scheduleRender();
          });
        }
      }
    }
  }

  Object.assign(SiteLists.prototype, LogMixin);
  window.SiteLists = SiteLists;

})();
