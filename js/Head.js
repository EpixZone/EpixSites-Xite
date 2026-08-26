(function() {

  class Head {
    constructor() {
      this.active = "popular";
      this.search_text = "";
      this.handleMenuClick = this.handleMenuClick.bind(this);
      this.handleSearchInput = this.handleSearchInput.bind(this);
      this.handleSearchKeydown = this.handleSearchKeydown.bind(this);
      this.handleSearchClear = this.handleSearchClear.bind(this);
      this.handleSafeClick = this.handleSafeClick.bind(this);
      this.render = this.render.bind(this);
    }

    handleMenuClick(e) {
      this.active = e.currentTarget.attributes.name.value;
      if (Page.site_lists.loaded) {
        Page.site_lists.distribute();
      }
      Page.projector.scheduleRender();
      return false;
    }

    setSearch(text, mode) {
      this.search_text = text;
      Page.site_lists.setSearch(text);
      if (text) {
        Page.setUrl("?Search:" + encodeURIComponent(text), mode || "replace");
      } else if (Page.params.url && Page.params.url.indexOf("Search:") === 0) {
        Page.setUrl("?", "replace");
      }
    }

    handleSearchInput(e) {
      var text = e.target.value;
      this.search_text = text;
      RateLimit(250, () => {
        this.setSearch(this.search_text, "replace");
      });
    }

    handleSearchKeydown(e) {
      if (e.keyCode === 13) {  // Enter: a persistent history entry
        this.setSearch(e.target.value, "push");
        e.target.blur();
        return false;
      }
      if (e.keyCode === 27) {  // Escape
        this.handleSearchClear();
        return false;
      }
      return true;
    }

    handleSearchClear() {
      this.search_text = "";
      this.setSearch("", "replace");
      Page.projector.scheduleRender();
      return false;
    }

    handleSafeClick() {
      Page.site_lists.setSafeMode(!Page.site_lists.safe_mode);
      return false;
    }

    renderSyncbar() {
      return h("div.syncbar", {classes: {visible: !!Page.sync_visible}},
        h("div.syncbar-fill")
      );
    }

    render() {
      var flagged_count = Page.site_lists ? Page.site_lists.flagged_count : 0;
      var safe_on = Page.site_lists ? Page.site_lists.safe_mode : true;
      return h("div#Head", [
        this.renderSyncbar(),
        h("div.head-inner", [
          h("a.logo", {href: "?Home", onclick: Page.handleLinkClick}, [
            h("img", {"src": "img/logo.png", "width": 29, "height": 32, alt: "Epix"}),
            h("h1", "Epix Sites")
          ]),
          h("div.searchbox", {classes: {filled: !!this.search_text}}, [
            h("span.searchbox-icon"),
            h("input.searchbox-input", {
              type: "search", placeholder: "Search xites…", value: this.search_text,
              oninput: this.handleSearchInput, onkeydown: this.handleSearchKeydown,
              "aria-label": "Search xites", spellcheck: "false", autocomplete: "off"
            }),
            this.search_text ? h("a.searchbox-clear", {href: "#Clear", onclick: this.handleSearchClear}, "×") : null
          ]),
          h("a.safe-toggle", {href: "#Safe", onclick: this.handleSafeClick, classes: {on: safe_on},
            title: safe_on ? "Safe mode is on: adult-rated xites are hidden" : "Safe mode is off: adult-rated xites are shown"}, [
            h("span.safe-dot"),
            h("span.safe-label", safe_on ? "Safe" : "All")
          ])
        ]),
        h("div.head-tabs", [
          h("a.tab", {href: "#", name: "popular", classes: {active: this.active === "popular"}, onclick: this.handleMenuClick}, "Popular"),
          h("a.tab", {href: "#", name: "new", classes: {active: this.active === "new"}, onclick: this.handleMenuClick}, "New"),
          h("a.tab.tab-flagged", {href: "#", name: "flagged", classes: {active: this.active === "flagged"}, onclick: this.handleMenuClick}, [
            "Flagged",
            flagged_count ? h("span.tab-badge", "" + flagged_count) : null
          ]),
          Page.sync_visible ? h("span.syncnote", "syncing…") : null
        ])
      ]);
    }
  }

  Object.assign(Head.prototype, LogMixin);
  window.Head = Head;

})();
