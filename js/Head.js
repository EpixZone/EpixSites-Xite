(function() {

  class Head {
    constructor() {
      this.active = "popular";
      this.handleMenuClick = this.handleMenuClick.bind(this);
      this.render = this.render.bind(this);
    }

    handleMenuClick(e) {
      this.active = e.currentTarget.attributes.name.value;
      Page.site_lists.update();
      return false;
    }

    render() {
      return h("div#Head", [
        h("a.logo", {href: "?Home", onclick: Page.handleLinkClick}, [
          h("img", {"src": "img/logo.png", "width": 58, "height": 64}),
          h("h1", "Epix Sites")
        ]),
        h("div.order", [
          h("a.order-item.popular", {href: "#", name: "popular", classes: {active: this.active === "popular"}, onclick: this.handleMenuClick}, "Popular"),
          h("a.order-item.new", {href: "#", name: "new", classes: {active: this.active === "new"}, onclick: this.handleMenuClick}, "New")
        ])
      ]);
    }
  }

  Object.assign(Head.prototype, LogMixin);
  window.Head = Head;

})();
