(function() {

  class Menu {
    constructor() {
      this.visible = false;
      this.items = [];
      this.node = null;
      this.show = this.show.bind(this);
      this.hide = this.hide.bind(this);
      this.toggle = this.toggle.bind(this);
      this.storeNode = this.storeNode.bind(this);
      this.handleClick = this.handleClick.bind(this);
      this.renderItem = this.renderItem.bind(this);
      this.render = this.render.bind(this);
    }

    show() {
      if (window.visible_menu) window.visible_menu.hide();
      this.visible = true;
      window.visible_menu = this;
    }

    hide() {
      this.visible = false;
    }

    toggle() {
      if (this.visible) {
        this.hide();
      } else {
        this.show();
      }
      Page.projector.scheduleRender();
    }

    addItem(title, cb, selected) {
      if (selected === undefined) selected = false;
      this.items.push([title, cb, selected]);
    }

    storeNode(node) {
      this.node = node;
      if (this.visible) {
        node.className = node.className.replace("visible", "");
        setTimeout(function() {
          node.className += " visible";
        }, 20);
      }
    }

    handleClick(e) {
      var keep_menu = true;
      for (var i = 0; i < this.items.length; i++) {
        var item = this.items[i];
        var title = item[0];
        var cb = item[1];
        if (title === e.target.textContent || e.target["data-title"] === title) {
          keep_menu = cb(item);
          break;
        }
      }
      if (keep_menu !== true) {
        this.hide();
      }
      return false;
    }

    renderItem(item) {
      var title = item[0];
      var cb = item[1];
      var selected = item[2];
      if (typeof selected === "function") {
        selected = selected();
      }
      if (title === "---") {
        return h("div.menu-item-separator");
      } else {
        var href, onclick, key;
        if (typeof cb === "string") {
          href = cb;
          onclick = true;
        } else {
          href = "#" + title;
          onclick = this.handleClick;
        }
        if (typeof title === "function") {
          title = title();
          key = "#";
        } else {
          key = title;
        }
        return h("a.menu-item", {href: href, onclick: onclick, "data-title": title, key: key, classes: {"selected": selected, "noaction": (cb === null)}}, title);
      }
    }

    render(class_name) {
      if (class_name === undefined) class_name = "";
      if (this.visible || this.node) {
        return h("div.menu" + class_name, {classes: {"visible": this.visible}, afterCreate: this.storeNode}, this.items.map(this.renderItem));
      }
    }
  }

  Object.assign(Menu.prototype, LogMixin);
  window.Menu = Menu;

  // Hide menu on outside click
  document.body.addEventListener("mouseup", function(e) {
    if (!window.visible_menu || !window.visible_menu.node) {
      return false;
    }
    var isChildOf = function(child, parent) {
      var node = child.parentNode;
      while (node != null) {
        if (node === parent) {
          return true;
        } else {
          node = node.parentNode;
        }
      }
      return false;
    };
    if (!isChildOf(e.target, window.visible_menu.node.parentNode) && !isChildOf(e.target, window.visible_menu.node)) {
      window.visible_menu.hide();
      Page.projector.scheduleRender();
    }
  });

})();
