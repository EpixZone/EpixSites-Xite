(function() {

  class Site {
    constructor(row) {
      this.row = row;
      this.form_edit = null;
      this.getUri = this.getUri.bind(this);
      this.isNew = this.isNew.bind(this);
      this.handleStarClick = this.handleStarClick.bind(this);
      this.getClasses = this.getClasses.bind(this);
      this.saveRow = this.saveRow.bind(this);
      this.deleteRow = this.deleteRow.bind(this);
      this.handleEditClick = this.handleEditClick.bind(this);
      this.render = this.render.bind(this);
    }

    getUri() {
      return this.row.directory + "_" + this.row.site_id;
    }

    isNew() {
      return Time.timestamp() - this.row.date_added < 60 * 60 * 24;
    }

    handleStarClick() {
      if (!Page.site_info.cert_user_id) {
        Page.user.certSelect(() => {
          this.handleStarClick();
        });
        return false;
      }

      var action;
      if (Page.user.starred[this.getUri()]) {
        action = "removing";
      } else {
        action = "adding";
      }

      Page.user.starred[this.getUri()] = !Page.user.starred[this.getUri()];
      Page.projector.scheduleRender();

      Page.user.getData((data) => {
        if (action === "adding") {
          data.site_star[this.getUri()] = 1;
        } else {
          delete data.site_star[this.getUri()];
        }
        Page.user.save(data, (res) => {
          Page.site_lists.update();
        });
      });
      return false;
    }

    getClasses() {
      return {
        my: this.row.cert_user_id === Page.site_info.cert_user_id || Page.site_info.settings.own,
        starred: Page.user.starred[this.getUri()]
      };
    }

    saveRow(cb) {
      var user = new User(this.row.directory);
      user.getData((data) => {
        var data_row;
        for (var i = 0; i < data.site.length; i++) {
          if (data.site[i].site_id === this.row.site_id) {
            data_row = data.site[i];
            break;
          }
        }
        for (var key in this.row) {
          if (data_row[key]) {
            data_row[key] = this.row[key];
          }
        }
        user.save(data, (res) => {
          Page.site_lists.update();
          if (typeof cb === "function") cb(res);
        });
      });
    }

    deleteRow(cb) {
      Page.user.getData((data) => {
        var data_row_i;
        for (var i = 0; i < data.site.length; i++) {
          if (data.site[i].site_id === this.row.site_id) {
            data_row_i = i;
            break;
          }
        }
        data.site.splice(data_row_i, 1);
        Page.user.save(data, (res) => {
          Page.site_lists.update();
          if (typeof cb === "function") cb(res);
        });
      });
    }

    handleEditClick() {
      if (!this.form_edit) {
        this.form_edit = new Form();
        this.form_edit.addField("text", "address", "Address", {placeholder: "e.g. epix1abc123...", required: true, validate: this.form_edit.shouldBeZite});
        this.form_edit.addField("text", "title", "Title", {placeholder: "e.g. Epix Blog", required: true});
        this.form_edit.addField("radio", "language", "Language", {required: true, values: Page.languages, classes: {"radiogroup-lang": true}});
        this.form_edit.addField("radio", "category", "Category", {required: true, values: Page.categories});
        this.form_edit.addField("text", "description", "Description", {placeholder: "e.g. EpixNet changelog and related information", required: true});
      }
      this.form_edit.setData(this.row);
      this.form_edit.saveRow = this.saveRow;
      this.form_edit.deleteRow = this.deleteRow;
      Page.setFormEdit(this.form_edit);
      return false;
    }

    render() {
      var my = this.row.cert_user_id === Page.site_info.cert_user_id || Page.site_info.settings.own;

      return h("a.site.nocomment", {href: "/" + this.row.address, key: this.row.site_id, enterAnimation: Animation.slideDown, exitAnimation: Animation.slideUp, classes: this.getClasses()}, [
        h("div.right", [
          h("a.star", {href: "#Star", onclick: this.handleStarClick},
            h("span.num", this.row.star || ""),
            h("span.icon.icon-star", "")
          ),
          h("a.comments", {href: "#"},
            h("span.num", "soon"),
            h("span.icon.icon-comment", "")
          ),
          this.row.peers ? h("div.peers",
            h("span.num", this.row.peers),
            h("span.icon.icon-profile", "")
          ) : null
        ]),
        h("div.title", this.row.title),
        this.isNew() ? h("div.tag.tag-new", "New") : null,
        this.row.tags && this.row.tags.indexOf("popular") >= 0 ? h("div.tag.tag-popular", "Popular") : null,
        my ? h("a.tag.tag-my", {href: "#Edit:" + this.row.site_uri, onclick: this.handleEditClick}, "Edit") : null,
        h("div.description", this.row.description)
      ]);
    }
  }

  Object.assign(Site.prototype, LogMixin);
  window.Site = Site;

})();
