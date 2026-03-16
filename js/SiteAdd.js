(function() {

  class SiteAdd {
    constructor() {
      this.form = new Form();
      this.db = {};
      this.submitting = false;
      this.handleRadioLangClick = this.handleRadioLangClick.bind(this);
      this.handleRadioCategoryClick = this.handleRadioCategoryClick.bind(this);
      this.handleSubmit = this.handleSubmit.bind(this);
      this.updateDb = this.updateDb.bind(this);
      this.shouldBeUniqueSite = this.shouldBeUniqueSite.bind(this);
      this.close = this.close.bind(this);
    }

    handleRadioLangClick(e) {
      this.form.data["language"] = e.currentTarget.value;
      this.form.invalid["language"] = false;
      Page.projector.scheduleRender();
      return false;
    }

    handleRadioCategoryClick(e) {
      this.form.data["category"] = e.currentTarget.value;
      this.form.invalid["category"] = false;
      Page.projector.scheduleRender();
      return false;
    }

    handleSubmit() {
      if (this.submitting) return false;
      if (!Page.site_info.cert_user_id) {
        Page.user.certSelect(() => {
          this.handleSubmit();
        });
        return false;
      }

      if (!this.form.validate()) {
        return false;
      }

      // Only keep site address
      this.form.data["address"] = this.form.data["address"].match(/(epix1[a-z0-9]{38,}|[A-Za-z0-9\.-]{2,99}\.[a-z]+)(.*)/)[0];

      this.submitting = true;
      Page.projector.scheduleRender();

      Page.user.getData((data) => {
        var row_site = this.form.data;
        row_site.date_added = Time.timestamp();
        row_site.site_id = row_site.date_added;
        data.site.push(row_site);
        Page.user.save(data, (res) => {
          if (res === "ok") {
            this.close();
            Page.head.active = "new";
            Page.setUrl("?Category:" + row_site.category);
            setTimeout(() => {
              this.submitting = false;
              this.form.reset();
              Page.site_lists.update();
            }, 1000);
          } else {
            this.submitting = false;
          }
        });
      });
      return false;
    }

    updateDb() {
      this.site_db = {};
      Page.cmd("dbQuery", "SELECT * FROM site", (res) => {
        for (var i = 0; i < res.length; i++) {
          var row = res[i];
          var match = row.address.match(/(epix1[a-z0-9]{38,}|[A-Za-z0-9\.-]{2,99}\.[a-z]+)(.*)/);
          var address = match ? match[0] : "";
          address = address.replace(/\/.*/, "");
          this.site_db[address.toLowerCase()] = row;
        }
      });
    }

    shouldBeUniqueSite(value) {
      var address = value.match(/(epix1[a-z0-9]{38,}|[A-Za-z0-9\.-]{2,99}\.[a-z]+)(.*)/)[0];
      address = address.replace(/\/.*/, "");
      var site = this.site_db[address.toLowerCase()];
      this.log(address, this.site_db);
      if (site) {
        return "This site is already submitted as " + site.title + "!";
      } else {
        return null;
      }
    }

    close() {
      Page.site_lists.state = null;
      Page.projector.scheduleRender();
    }

    render() {
      return h("div.form.form-siteadd", {updateAnimation: Animation.height, classes: {hidden: Page.site_lists.state !== "siteadd"}}, [
        h("div.formfield",
          this.form.h("label.title", {for: "address"}, "Address"),
          this.form.h("input.text", {type: "text", name: "address", placeholder: "e.g. epix1abc123...", required: true, validate: [this.form.shouldBeZite, this.shouldBeUniqueSite]})
        ),
        h("div.formfield",
          this.form.h("label.title", {for: "title"}, "Title"),
          this.form.h("input.text", {type: "text", name: "title", placeholder: "e.g. Epix Blog", required: true})
        ),
        h("div.formfield",
          this.form.h("label.title", {for: "language"}, "Language"),
          this.form.h("div.radiogroup.radiogroup-lang", {name: "language", value: this.form.data.language, required: true}, [
            Page.languages.map((lang) => {
              return [h("a.radio", {key: lang, href: "#" + lang, onclick: this.handleRadioLangClick, value: lang, classes: {active: this.form.data.language === lang}}, lang), " "];
            })
          ])
        ),
        h("div.formfield",
          this.form.h("label.title", {for: "category"}, "Category"),
          this.form.h("div.radiogroup", {name: "category", value: this.form.data.category, required: true}, Page.categories.map((cat) => {
            var id = cat[0];
            var category = cat[1];
            return [h("a.radio", {key: id, href: "#" + id, onclick: this.handleRadioCategoryClick, value: id, classes: {active: this.form.data.category === id}}, category), " "];
          }))
        ),
        h("div.formfield",
          this.form.h("label.title", {for: "description"}, "Description"),
          this.form.h("input.text", {type: "text", name: "description", placeholder: "e.g. EpixNet changelog and related information", required: true})
        ),
        h("a.button.button-submit", {href: "#Submit", onclick: this.handleSubmit, classes: {loading: this.submitting}}, "Submit")
      ]);
    }
  }

  Object.assign(SiteAdd.prototype, LogMixin);
  window.SiteAdd = SiteAdd;

})();
