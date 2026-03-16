(function() {

  var EpixFrame = window.EpixFrame;
  window.h = maquette.h;

  class EpixSites extends EpixFrame {
    init() {
      this.params = {};
      this.site_info = null;
      this.server_info = null;
      this.history_state = {};

      this.on_site_info = new Deferred();
      this.on_local_storage = new Deferred();
      this.on_loaded = new Deferred();

      this.user = new User();
      this.on_site_info.then(() => {
        this.user.setAuthAddress(this.site_info.auth_address);
      });

      this.local_storage = null;
      this.languages = [];
      this.categories = [];
      this.on_site_info.then(() => {
        this.languages = this.site_info.content.settings.languages;
        this.categories = this.site_info.content.settings.categories;
      });

      this.handleLinkClick = this.handleLinkClick.bind(this);
    }

    createProjector() {
      this.projector = maquette.createProjector();
      this.head = new Head();
      this.site_lists = new SiteLists();

      if (base.href.indexOf("?") === -1) {
        this.route("");
      } else {
        var url = base.href.replace(/.*?\?/, "");
        this.route(url);
        this.history_state["url"] = url;
      }

      // Remove fake long body
      this.on_loaded.then(() => {
        this.log("onloaded");
        window.requestAnimationFrame(function() {
          document.body.className = "loaded";
        });
      });

      this.projector.replace($("#Head"), this.head.render);
      this.projector.replace($("#SiteLists"), this.site_lists.render);
      this.loadLocalStorage();

      // Update every minute to keep time since fields up-to date
      setInterval(function() {
        Page.projector.scheduleRender();
      }, 60 * 1000);
    }

    setFormEdit(form_edit) {
      form_edit.hidden = false;
      this.projector.replace($("#FormEdit"), form_edit.render);
    }

    route(query) {
      this.params = Text.parseQuery(query);
      var parts = this.params.url.split(":");
      var page = parts[0];
      var param = parts[1];
      this.content = this.site_lists;
      if (page === "Category") {
        this.site_lists.setFilterCategory(parseInt(param));
      } else {
        this.site_lists.setFilterCategory(null);
      }
      Page.projector.scheduleRender();
      this.log("Route", page, param);
    }

    setUrl(url, mode) {
      if (mode === undefined) mode = "push";
      url = url.replace(/.*?\?/, "");
      this.log("setUrl", this.history_state["url"], "->", url);
      if (this.history_state["url"] === url) {
        this.content.update();
        return false;
      }
      this.history_state["url"] = url;
      if (mode === "replace") {
        this.cmd("wrapperReplaceState", [this.history_state, "", url]);
      } else {
        this.cmd("wrapperPushState", [this.history_state, "", url]);
      }
      this.route(url);
      return false;
    }

    handleLinkClick(e) {
      if (e.which === 2) {
        return true;
      } else {
        this.log("save scrollTop", window.pageYOffset);
        this.history_state["scrollTop"] = window.pageYOffset;
        this.cmd("wrapperReplaceState", [this.history_state, null]);

        if (document.body.scrollTop > 100) {
          anime({targets: document.body, scrollTop: 0, easing: "easeOutCubic", duration: 300});
        }

        this.history_state["scrollTop"] = 0;

        this.on_loaded.resolved = false;
        document.body.className = "";

        this.setUrl(e.currentTarget.search);
        return false;
      }
    }

    createUrl(key, val) {
      var params = JSON.parse(JSON.stringify(this.params));
      if (typeof key === "Object") {
        var vals = key;
        for (var k in vals) {
          params[k] = vals[k];
        }
      } else {
        params[key] = val;
      }
      return "?" + Text.queryEncode(params);
    }

    loadLocalStorage() {
      this.on_site_info.then(() => {
        this.log("Loading localstorage");
        this.cmd("wrapperGetLocalStorage", [], (local_storage) => {
          this.local_storage = local_storage;
          this.log("Loaded localstorage");
          if (this.local_storage == null) this.local_storage = {};
          if (this.local_storage.filter_lang == null) this.local_storage.filter_lang = {};
          this.on_local_storage.resolve();
        });
      });
    }

    saveLocalStorage(cb) {
      if (this.local_storage) {
        this.cmd("wrapperSetLocalStorage", this.local_storage, function(res) {
          if (cb) cb(res);
        });
      }
    }

    onOpenWebsocket(e) {
      this.cmd("serverInfo", {}, (server_info) => {
        this.setServerInfo(server_info);
        var lang = server_info && server_info.user_settings ? server_info.user_settings.language : null;
        loadLanguage(lang, () => {
          this.cmd("siteInfo", {}, (site_info) => {
            this.setSiteInfo(site_info);
          });
        });
      });
    }

    reloadSiteInfo() {
      this.cmd("siteInfo", {}, (site_info) => {
        this.setSiteInfo(site_info);
      });
    }

    reloadServerInfo() {
      this.cmd("serverInfo", {}, (server_info) => {
        this.setServerInfo(server_info);
      });
    }

    // Parse incoming requests from UiWebsocket server
    onRequest(cmd, message) {
      var params = message.params;
      if (cmd === "setSiteInfo") {
        this.setSiteInfo(params);
      } else if (cmd === "wrapperPopState") {
        this.log("wrapperPopState", params);
        if (params.state) {
          if (!params.state.url) {
            params.state.url = params.href.replace(/.*\?/, "");
          }
          this.on_loaded.resolved = false;
          document.body.className = "";
          window.scroll(window.pageXOffset, params.state.scrollTop || 0);
          this.route(params.state.url || "");
        }
      } else {
        this.log("Unknown command", cmd, params);
      }
    }

    setSiteInfo(site_info) {
      this.site_info = site_info;
      this.on_site_info.resolve();
      this.site_lists.onSiteInfo(site_info);
      this.user.onSiteInfo(site_info);
      this.projector.scheduleRender();
    }

    setServerInfo(server_info) {
      this.server_info = server_info;
      this.projector.scheduleRender();
    }

    returnFalse() {
      return false;
    }
  }

  window.Page = new EpixSites();
  window.Page.createProjector();

})();
