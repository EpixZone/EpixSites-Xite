(function() {

  class Head {
    constructor() {
      this.active = "popular";
      this.search_text = "";
      this.handleMenuClick = this.handleMenuClick.bind(this);
      this.handleSearchInput = this.handleSearchInput.bind(this);
      this.handleSearchKeydown = this.handleSearchKeydown.bind(this);
      this.handleSearchClear = this.handleSearchClear.bind(this);
      this.handleAdultClick = this.handleAdultClick.bind(this);
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

    handleAdultClick() {
      Page.site_lists.setHideAdult(!Page.site_lists.hide_adult);
      return false;
    }

    // An eye, open or struck through: the filter's state without a word for
    // it. Inline so it takes currentColor and stays crisp in both themes.
    renderEyeIcon(hidden) {
      var parts = [
        h("path", {
          key: "eye",
          "d": "M1.6 9s3-5.4 7.4-5.4S16.4 9 16.4 9s-3 5.4-7.4 5.4S1.6 9 1.6 9z",
          "fill": "none", "stroke": "currentColor", "stroke-width": "1.4",
          "stroke-linecap": "round", "stroke-linejoin": "round"
        }),
        h("circle", {key: "pupil", "cx": "9", "cy": "9", "r": "2.2", "fill": "none",
          "stroke": "currentColor", "stroke-width": "1.4"})
      ];
      if (hidden) {
        parts.push(h("path", {key: "slash", "d": "M3 15L15 3", "stroke": "currentColor",
          "stroke-width": "1.4", "stroke-linecap": "round"}));
      }
      return h("svg.adult-icon", {"viewBox": "0 0 18 18", "width": "18", "height": "18",
        "aria-hidden": "true", "focusable": "false"}, parts);
    }

    renderSyncbar() {
      return h("div.syncbar", {classes: {visible: !!Page.sync_visible}},
        h("div.syncbar-fill")
      );
    }

    render() {
      var hiding_adult = Page.site_lists ? Page.site_lists.hide_adult : true;
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
              type: "search", placeholder: _("Search xites…"), value: this.search_text,
              oninput: this.handleSearchInput, onkeydown: this.handleSearchKeydown,
              "aria-label": _("Search xites"), spellcheck: "false", autocomplete: "off"
            }),
            this.search_text ? h("a.searchbox-clear", {href: "#Clear", onclick: this.handleSearchClear}, "×") : null
          ]),
          h("a.adult-filter.tip", {href: "#Adult", onclick: this.handleAdultClick, classes: {showing: !hiding_adult},
            "data-tip": hiding_adult
              ? _("Adult-rated xites are hidden. Click to show them.")
              : _("Adult-rated xites are shown. Click to hide them."),
            "aria-label": hiding_adult ? _("Adult-rated xites are hidden") : _("Adult-rated xites are shown")},
            this.renderEyeIcon(hiding_adult))
        ]),
        h("div.head-tabs", [
          h("a.tab", {href: "#", name: "popular", classes: {active: this.active === "popular"}, onclick: this.handleMenuClick}, _("Popular")),
          h("a.tab", {href: "#", name: "new", classes: {active: this.active === "new"}, onclick: this.handleMenuClick}, _("New")),
          h("a.tab.tab-audit", {href: "#", name: "flagged", classes: {active: this.active === "flagged"},
            onclick: this.handleMenuClick, title: _("Listings the community has reported or delisted, kept auditable")}, _("Flagged")),
          Page.sync_visible ? h("span.syncnote", _("syncing…")) : null
        ])
      ]);
    }
  }

  Object.assign(Head.prototype, LogMixin);
  window.Head = Head;

})();
