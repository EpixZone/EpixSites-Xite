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
          // Revert the optimistic toggle if the write did not go through.
          Page.user.starred[uri] = !starring;
        }
        Page.projector.scheduleRender();
        Page.site_lists.update();
      });
      return false;
    }

    getClasses() {
      return {
        my: this.isMine() || this.isSiteOwner(),
        starred: Page.user.starred[this.getUri()]
      };
    }

    isMine() {
      return this.row.cert_user_id === Page.site_info.cert_user_id;
    }

    isSiteOwner() {
      return !!Page.site_info.settings.own;
    }

    rowUser() {
      return new User(null, this.row.directory);
    }

    saveRow(cb, privatekey) {
      if (this.isMine()) {
        // An edit is a new signed version of the same site record (same key ->
        // same post_id -> supersedes); it can never touch another submission.
        Page.user.editRecord("sites", "site_" + this.row.site_id, {
          "site_id": this.row.site_id,
          "date_added": this.row.date_added,
          "category": this.row.category,
          "language": this.row.language,
          "title": this.row.title,
          "description": this.row.description,
          "address": this.row.address,
          "tags": this.row.tags
        }, false, (res) => {
          Page.site_lists.update();
          if (typeof cb === "function") cb(res);
        });
        return;
      }

      // Owner override of ANOTHER user's entry still writes their legacy
      // data.json (last-writer-wins). Cross-author moderation is not part of the
      // signed-CRDT migration yet: it needs a moderation tombstone signed as the
      // original author, which recordSign (which signs as the current user)
      // cannot produce.
      var user = this.rowUser();
      user.getDataForWrite((data) => {
        if (data == null) {
          // Guard aborted the write (data.json still syncing). Report so the
          // form does not treat it as saved.
          if (typeof cb === "function") cb({"error": "Your data is still syncing, please try again in a moment"});
          return;
        }
        var data_row;
        for (var i = 0; i < data.site.length; i++) {
          if (data.site[i].site_id === this.row.site_id) {
            data_row = data.site[i];
            break;
          }
        }
        if (!data_row) {
          if (typeof cb === "function") cb({"error": "Row not found in user data"});
          return;
        }
        for (var key in this.row) {
          if (data_row[key]) {
            data_row[key] = this.row[key];
          }
        }
        user.save(data, (res) => {
          Page.site_lists.update();
          if (typeof cb === "function") cb(res);
        }, privatekey);
      });
    }

    deleteRow(cb, privatekey) {
      if (this.isMine()) {
        // A delete is a signed tombstone of this site record, NOT a splice:
        // absence is not deletion on the network.
        Page.user.editRecord("sites", "site_" + this.row.site_id, {}, true, (res) => {
          Page.site_lists.update();
          if (typeof cb === "function") cb(res);
        });
        return;
      }

      // Owner override of another user's entry: legacy data.json path (see
      // saveRow for why moderation is not migrated yet).
      var user = this.rowUser();
      user.getDataForWrite((data) => {
        if (data == null) {
          // Guard aborted the write (data.json still syncing). Report so the
          // form does not treat it as deleted.
          if (typeof cb === "function") cb({"error": "Your data is still syncing, please try again in a moment"});
          return;
        }
        var data_row_i = -1;
        for (var i = 0; i < data.site.length; i++) {
          if (data.site[i].site_id === this.row.site_id) {
            data_row_i = i;
            break;
          }
        }
        if (data_row_i === -1) {
          if (typeof cb === "function") cb({"error": "Row not found in user data"});
          return;
        }
        data.site.splice(data_row_i, 1);
        user.save(data, (res) => {
          Page.site_lists.update();
          if (typeof cb === "function") cb(res);
        }, privatekey);
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
      this.form_edit.is_mine = this.isMine();
      this.form_edit.is_site_owner = this.isSiteOwner();
      this.form_edit.row_cert_user_id = this.row.cert_user_id;
      Page.setFormEdit(this.form_edit);
      return false;
    }

    render() {
      var my = this.isMine() || this.isSiteOwner();

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
