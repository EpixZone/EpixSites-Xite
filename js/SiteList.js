(function() {

  class SiteList {
    constructor(row) {
      this.row = row;
      this.item_list = new ItemList(Site, "site_id");
      this.sites = this.item_list.items;
      this.item_list.sync(this.row.sites);
      this.limit = 10;
      this.nolimit = false;
      this.handleMoreClick = this.handleMoreClick.bind(this);
    }

    isHidden() {
      if (Page.site_lists.filter_category == null) {
        return false;
      } else {
        return Page.site_lists.filter_category !== this.row.id;
      }
    }

    handleMoreClick() {
      this.limit += 20;
      this.nolimit = true;
      return false;
    }

    render(i) {
      if (this.row.title === "Other" && Page.site_lists.filter_category !== this.row.id && Page.site_lists.cols === 3) {
        return this.renderWide(i);
      }
      var limit;
      if (Page.site_lists.filter_category === this.row.id) {
        limit = 100;
      } else {
        limit = this.limit;
      }
      var clear;
      if (this.sites.length === 0) {
        clear = false;
      } else {
        clear = (i % Page.site_lists.cols === 1);
      }
      return h("div.sitelist", {key: this.row.id, classes: {empty: this.sites.length === 0, hidden: this.isHidden(), selected: Page.site_lists.filter_category === this.row.id, nolimit: this.nolimit, clear: clear}}, [
        h("a.categoryname", {href: "?Category:" + this.row.id + ":" + Text.toUrl(this.row.title), onclick: Page.handleLinkClick}, this.row.title),
        h("div.sites", [
          this.sites.slice(0, limit).map(function(item) {
            return item.render();
          }),
          this.sites.length > limit
            ? h("a.more", {href: "?Category:" + this.row.id + ":" + Text.toUrl(this.row.title), onclick: this.handleMoreClick, enterAnimation: Animation.slideDown, exitAnimation: Animation.slideUp}, "Show more...")
            : null
        ])
      ]);
    }

    renderWide(i) {
      var cols = [0, 1, 2];
      var clear = false;
      var limit = this.limit;
      if (this.sites.length < limit * 3) {
        limit = Math.ceil(this.sites.length / 3);
      }
      return h("div.sitelist-wide", [
        cols.map((col) => {
          return h("div.sitelist.col-" + col, {key: this.row.id, classes: {empty: this.sites.length === 0, hidden: this.isHidden(), selected: Page.site_lists.filter_category === this.row.id, clear: clear}}, [
            h("a.categoryname", {href: "?Category:" + this.row.id + ":" + Text.toUrl(this.row.title), onclick: Page.handleLinkClick}, this.row.title),
            h("div.sites", [
              this.sites.slice(col * limit, col * limit + limit).map(function(item) {
                return item.render();
              })
            ])
          ]);
        }),
        this.sites.length > limit * cols.length
          ? h("a.more", {href: "?Category:" + this.row.id + ":" + Text.toUrl(this.row.title), onclick: this.handleMoreClick, enterAnimation: Animation.slideDown}, "Show more...")
          : null
      ]);
    }
  }

  Object.assign(SiteList.prototype, LogMixin);
  window.SiteList = SiteList;

})();
