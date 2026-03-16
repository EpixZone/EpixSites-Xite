(function() {

  class SiteLists {
    constructor() {
      this.menu_filters = new Menu();
      this.state = null;
      this.filter_lang = {};
      this.site_add = new SiteAdd();
      this.site_lists = [];
      this.site_lists_db = {};
      this.need_update = false;
      this.loaded = false;
      this.num_total = null;
      this.filter_category = null;
      this.cols = 3;

      this.handleFilterLanguageClick = this.handleFilterLanguageClick.bind(this);
      this.renderFilterLanguage = this.renderFilterLanguage.bind(this);
      this.handleFiltersClick = this.handleFiltersClick.bind(this);
      this.handleSiteAddClick = this.handleSiteAddClick.bind(this);
      this.formatFilterTitle = this.formatFilterTitle.bind(this);
      this.setFilterCategory = this.setFilterCategory.bind(this);
      this.getVisibleSiteLists = this.getVisibleSiteLists.bind(this);
      this.render = this.render.bind(this);

      Page.on_site_info.then(() => {
        Page.on_local_storage.then(() => {
          this.filter_lang = Page.local_storage.filter_lang;
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
        this.log("Cols: " + this.cols);
        Page.projector.scheduleRender();
      };
      window.onresize();
    }

    update() {
      var order;
      if (Page.head.active === "new") {
        order = "date_added DESC";
      } else {
        order = "MIN(200, peers) + star * 20 DESC, title";
      }

      var filters = [];
      if (!isEmpty(this.filter_lang)) {
        var langs = [];
        for (var lang in this.filter_lang) {
          langs.push(lang);
        }
        filters.push("language IN " + Text.sqlIn(langs));
      }

      var where = filters.length ? "WHERE " + filters.join(" AND ") : "";
      var query = "SELECT site.*, json.*, COUNT(site_star.site_uri) AS star, site_stat.* " +
        "FROM site " +
        "LEFT JOIN json USING (json_id) " +
        "LEFT JOIN site_star ON (site_star.site_uri = json.directory || \"_\" || site.site_id) " +
        "LEFT JOIN site_stat ON (site_stat.site_uri = json.directory || \"_\" || site.site_id) " +
        where + " " +
        "GROUP BY site.json_id, site_id " +
        "ORDER BY " + order;

      this.logStart("Sites");
      Page.cmd("dbQuery", query, (rows) => {
        var sites_db = {};
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          if (!sites_db[row["category"]]) sites_db[row["category"]] = [];
          sites_db[row["category"]].push(row);
        }

        for (var category in this.site_lists_db) {
          this.site_lists_db[category].item_list.sync(sites_db[category] || []);
        }

        this.loaded = true;
        this.num_total = rows.length;
        this.logEnd("Sites", "found: " + this.num_total);
        Page.on_loaded.resolve();

        Page.projector.scheduleRender();
      });
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
      Page.projector.scheduleRender();
      this.update();
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
        return "None";
      } else {
        var langs = [];
        for (var lang in this.filter_lang) {
          langs.push(lang);
        }
        return langs.join(", ");
      }
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

    render() {
      if (this.need_update) {
        this.need_update = false;
        this.update();
      }
      var i = 0;

      var num_found = 0;
      for (var si = 0; si < this.site_lists.length; si++) {
        if (!this.site_lists[si].isHidden()) {
          num_found += this.site_lists[si].sites.length;
        }
      }

      var filter_lang_list = [];
      for (var lang in this.filter_lang) {
        filter_lang_list.push(lang);
      }

      return h("div#SiteLists", {classes: {"state-siteadd": this.state === "siteadd"}},
        this.loaded ? h("div.sitelists-right", [
          Page.site_info && Page.site_info.cert_user_id
            ? h("a.certselect.right-link", {href: "#Select", onclick: Page.user.certSelect}, [
                h("span.symbol", "\u2394"),
                h("span.title", "User: " + Page.site_info.cert_user_id)
              ])
            : null,
          h("a.filter.right-link", {href: "#Filters", onmousedown: this.handleFiltersClick, onclick: Page.returnFalse}, [
            h("span.symbol", "\u25C7"),
            h("span.title", "Filter: " + this.formatFilterTitle())
          ]),
          this.menu_filters.render(".filter"),
          h("a.siteadd.right-link", {href: "#", onclick: this.handleSiteAddClick}, [
            h("span.symbol", "+"),
            h("span.title", "Submit new site")
          ])
        ]) : null,
        this.site_add.render(),
        num_found === 0 && !isEmpty(this.filter_lang)
          ? h("h1.empty", {enterAnimation: Animation.slideDown, exitAnimation: Animation.slideUp}, "No sites found for languages: " + filter_lang_list.join(', '))
          : null,
        this.loaded ? h("div.sitelists", this.site_lists.map(function(site_list) {
          if (site_list.sites.length) {
            i++;
            num_found += site_list.sites.length;
          }
          return site_list.render(i);
        })) : null,
        h("div.clear", " ")
      );
    }

    onSiteInfo(site_info) {
      if (site_info.event) {
        var action = site_info.event[0];
        var inner_path = site_info.event[1];
        if (action === "file_done" && inner_path.endsWith("json")) {
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
