(function() {

  function ratingValues() {
    return [
      ["g", _("General – fine for everyone")],
      ["m", _("Mature – strong language, violence, gambling")],
      ["a", _("Adult – explicit content, 18+")]
    ];
  }

  class SiteAdd {
    constructor() {
      this.form = new Form();
      this.site_db = {};
      this.submitting = false;
      this.handleRadioClick = this.handleRadioClick.bind(this);
      this.handleSubmit = this.handleSubmit.bind(this);
      this.updateDb = this.updateDb.bind(this);
      this.shouldBeUniqueSite = this.shouldBeUniqueSite.bind(this);
      this.shouldBeTags = this.shouldBeTags.bind(this);
      this.close = this.close.bind(this);
      this.render = this.render.bind(this);
    }

    handleRadioClick(e) {
      var name = e.currentTarget.attributes["data-name"].value;
      this.form.data[name] = e.currentTarget.attributes["data-value"].value;
      this.form.invalid[name] = false;
      Page.projector.scheduleRender();
      return false;
    }

    parseAddress(value) {
      var match = (value || "").match(/(epix1[a-z0-9]{38,}|[A-Za-z0-9\.-]{2,99}\.[a-z]+)(.*)/);
      if (!match) return null;
      return match[1];  // the address group only, never the trailing rest
    }

    normalizeTags(value) {
      if (!value) return "";
      return value.split(",").map(function(t) {
        return t.trim().toLowerCase().replace(/[^a-z0-9 _-]/g, "");
      }).filter(function(t) { return t.length; }).slice(0, 5).join(",");
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

      this.form.data["address"] = this.parseAddress(this.form.data["address"]);

      this.submitting = true;
      Page.projector.scheduleRender();

      // A new site is a fresh signed record keyed by its site id, so a later
      // edit or delete supersedes it. The node union-merges it into sites.json
      // (never overwriting other submissions) and publishes. The declared
      // rating is a REQUIRED, public claim: if the community later settles a
      // stricter label, the listing shows as Mislabeled.
      var date_added = Time.timestamp();
      // Millisecond id: two same-second submissions must not share a key
      // (same key = same keyed post_id = silent supersede).
      var site_id = Date.now();
      var fields = {
        "site_id": site_id,
        "date_added": date_added,
        "category": parseInt(this.form.data["category"]),
        "language": this.form.data["language"],
        "title": this.form.data["title"],
        "description": this.form.data["description"],
        "address": this.form.data["address"],
        "rating": this.form.data["rating"],
        "tags": this.normalizeTags(this.form.data["tags"])
      };
      Page.user.editRecord("sites", "site_" + site_id, fields, false, (res) => {
        if (res === "ok") {
          this.close();
          Page.head.active = "new";
          Page.setUrl("?Category:" + fields.category);
          setTimeout(() => {
            this.submitting = false;
            this.form.reset();
            Page.site_lists.update();
          }, 1000);
        } else {
          this.submitting = false;
          Page.projector.scheduleRender();
        }
      });
      return false;
    }

    updateDb() {
      this.site_db = {};
      Page.cmd("dbQuery", "SELECT site.*, json.directory AS directory FROM site LEFT JOIN json USING (json_id)", (res) => {
        for (var i = 0; i < res.length; i++) {
          var row = res[i];
          var address = this.parseAddress(row.address);
          if (address) {
            this.site_db[address.toLowerCase()] = row;
          }
        }
      });
    }

    shouldBeUniqueSite(value) {
      var address = this.parseAddress(value);
      if (!address) return null;
      // The owner proved control of this xite's key and withdrew it. Say so,
      // rather than accepting a submission that would be hidden on arrival.
      var claim = Page.site_lists.claims[address.toLowerCase()];
      if (claim && (claim.hidden === 1 || claim.hidden === true)) {
        return _("This xite's owner has withdrawn it from the directory.");
      }
      var row = this.site_db[address.toLowerCase()];
      if (!row) return null;
      var info = Page.site_lists.trust[row.directory + "_" + row.site_id];
      if (info && info.state === "delisted") {
        var reasons = {};
        info.evidence.reports.forEach(function(r) { reasons[Trust.reasonName(r.reason)] = true; });
        return _("This address was delisted for: {reasons}. It cannot be resubmitted.", {reasons: Object.keys(reasons).join(", ")});
      }
      return _("This site is already listed as “{title}”", {title: row.title});
    }

    shouldBeTags(value) {
      if (!value) return null;
      if (value.split(",").length > 5) {
        return _("Up to 5 tags, separated by commas");
      }
      return null;
    }

    close() {
      Page.site_lists.state = null;
      Page.projector.scheduleRender();
    }

    renderRadio(name, values, extra_class) {
      return this.form.h("div.radiogroup" + (extra_class || ""), {name: name, value: this.form.data[name], required: true}, [
        values.map((kv) => {
          var key = "" + kv[0];
          var label = kv[1];
          return [h("a.radio", {key: key, href: "#" + key, onclick: this.handleRadioClick, "data-name": name, "data-value": key, value: key,
            classes: {active: "" + this.form.data[name] === key}}, label), " "];
        })
      ]);
    }

    render() {
      return h("div.form.form-siteadd", {updateAnimation: Animation.height, classes: {hidden: Page.site_lists.state !== "siteadd"}}, [
        h("div.form-siteadd-title", _("Submit a xite")),
        h("div.form-siteadd-note", _("Listings are public, signed records tied to your xId. You stand behind what you submit.")),
        h("div.formfield",
          this.form.h("label.title", {for: "address"}, _("Address")),
          this.form.h("input.text", {type: "text", name: "address", placeholder: _("e.g. epix1abc123... or name.epix"), required: true, validate: [this.form.shouldBeZite, this.shouldBeUniqueSite]})
        ),
        h("div.formfield",
          this.form.h("label.title", {for: "title"}, _("Title")),
          this.form.h("input.text", {type: "text", name: "title", placeholder: _("e.g. Epix Blog"), required: true})
        ),
        h("div.formfield",
          this.form.h("label.title", {for: "description"}, _("Description")),
          this.form.h("input.text", {type: "text", name: "description", placeholder: _("What is this xite about?"), required: true})
        ),
        h("div.formfield",
          this.form.h("label.title", {for: "category"}, _("Category")),
          this.renderRadio("category", Page.translatedCategories())
        ),
        h("div.formfield",
          this.form.h("label.title", {for: "rating"}, _("Content rating")),
          this.renderRadio("rating", ratingValues(), ".radiogroup-rating"),
          h("div.field-note", _("Declare it honestly: the community votes on the real rating, and a mislabeled listing is marked and downranked."))
        ),
        h("div.formfield",
          this.form.h("label.title", {for: "language"}, _("Language")),
          this.renderRadio("language", Page.languages.map(function(l) { return [l, l]; }), ".radiogroup-lang")
        ),
        h("div.formfield",
          this.form.h("label.title", {for: "tags"}, _("Tags")),
          this.form.h("input.text", {type: "text", name: "tags", placeholder: _("optional, up to 5, comma separated"), required: false, validate: this.shouldBeTags})
        ),
        h("div.form-siteadd-actions", [
          h("a.cancel.link", {href: "#Cancel", onclick: this.close}, _("Cancel")),
          h("a.button.button-submit", {href: "#Submit", onclick: this.handleSubmit, classes: {loading: this.submitting}}, _("Submit listing"))
        ])
      ]);
    }
  }

  Object.assign(SiteAdd.prototype, LogMixin);
  window.SiteAdd = SiteAdd;

})();
