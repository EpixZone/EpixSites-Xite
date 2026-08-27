(function() {

  var CATEGORY_NONE = "";

  // The claim takeover: shows the challenge to sign, takes the signature back,
  // verifies it before writing anything, and then lets the owner keep the
  // listing's description accurate.
  class ClaimForm {
    constructor(site) {
      this.site = site;
      this.row = site.row;
      this.address = ("" + this.row.address).toLowerCase();
      this.hidden = false;
      this.checking = false;
      this.error = null;
      this.copied = null;
      this.data = {
        signature: "",
        title: this.row.title || "",
        description: this.row.description || "",
        category: "" + (this.row.category || CATEGORY_NONE),
        language: this.row.language || "en",
        tags: this.row.tags || "",
        rating: this.row.rating || "g",
        hidden: this.row.owner_hidden ? "1" : "0"
      };
      this.handleHideClick = this.handleHideClick.bind(this);
      this.handleInput = this.handleInput.bind(this);
      this.handleRadioClick = this.handleRadioClick.bind(this);
      this.handleCopy = this.handleCopy.bind(this);
      this.handleSubmit = this.handleSubmit.bind(this);
      this.handleRelease = this.handleRelease.bind(this);
      this.handleCancel = this.handleCancel.bind(this);
      this.render = this.render.bind(this);
    }

    isMine() {
      return !!Page.user.my_claims[this.address];
    }

    handleInput(e) {
      this.data[e.target.name] = e.target.value;
      this.error = null;
      return false;
    }

    handleRadioClick(e) {
      var name = e.currentTarget.attributes["data-name"].value;
      this.data[name] = e.currentTarget.attributes["data-value"].value;
      Page.projector.scheduleRender();
      return false;
    }

    handleCopy(e) {
      var what = e.currentTarget.attributes["data-copy"].value;
      var text = what === "challenge"
        ? Claim.challenge(this.address, Page.user.getUserDirectory())
        : Claim.signCommand(this.address, Page.user.getUserDirectory());
      var field = document.createElement("textarea");
      field.value = text;
      document.body.appendChild(field);
      field.select();
      try {
        document.execCommand("copy");
        this.copied = what;
      } catch (err) {
        this.copied = null;
      }
      field.remove();
      Page.projector.scheduleRender();
      return false;
    }

    handleCancel() {
      this.hidden = true;
      Page.projector.scheduleRender();
      return false;
    }

    // Reports are what a withdrawal must never shed, so a listing carrying
    // them cannot be hidden. It stays in the Flagged view either way; this
    // just refuses the request plainly instead of half honouring it.
    reportsStanding() {
      var info = Page.site_lists.trust[this.row.uri];
      return !!info && (info.state === "warned" || info.state === "delisted");
    }

    handleHideClick() {
      if (this.data.hidden === "0" && this.reportsStanding()) {
        this.error = _("This listing has open reports against it. You can correct its description, but withdrawing it would hide those reports, so it stays listed until they are resolved.");
        Page.projector.scheduleRender();
        return false;
      }
      this.data.hidden = this.data.hidden === "1" ? "0" : "1";
      this.error = null;
      Page.projector.scheduleRender();
      return false;
    }

    fields() {
      return {
        "title": this.data.title,
        "description": this.data.description,
        "category": this.data.category === "" ? undefined : parseInt(this.data.category),
        "language": this.data.language,
        "tags": this.data.tags,
        "rating": this.data.rating,
        "hidden": this.data.hidden === "1" ? 1 : 0
      };
    }

    handleSubmit() {
      if (this.checking) return false;
      if (!Page.site_info.cert_user_id) {
        Page.user.certSelect(() => { this.handleSubmit(); });
        return false;
      }
      // Already the verified owner: this is a plain edit, no new signature.
      if (this.isMine() && !this.data.signature) {
        this.write(this.existingSignature());
        return false;
      }
      var signature = (this.data.signature || "").trim();
      if (!signature) {
        this.error = _("Paste the signature produced by the command above.");
        Page.projector.scheduleRender();
        return false;
      }
      this.checking = true;
      this.error = null;
      Page.projector.scheduleRender();

      // Verify BEFORE writing: a rejected signature never becomes a record.
      var challenge = Claim.challenge(this.address, Page.user.getUserDirectory());
      Page.cmd("ecdsaVerify", [challenge, this.address, signature], (ok) => {
        this.checking = false;
        if (ok !== true) {
          this.error = _("That signature does not match this xite's address. Check that you signed the exact challenge with the xite's own private key.");
          Page.projector.scheduleRender();
          return;
        }
        this.write(signature);
      });
      return false;
    }

    existingSignature() {
      var claim = Page.site_lists.claims[this.address];
      return claim ? claim.owner_sign : "";
    }

    write(signature) {
      this.checking = true;
      Page.projector.scheduleRender();
      Page.user.claim(this.address, signature, this.fields(), (res) => {
        this.checking = false;
        if (res === "ok") {
          this.hidden = true;
          Page.cmd("wrapperNotification", ["done", _("Ownership verified. This listing is now yours to manage.")]);
          Page.site_lists.update();
        } else {
          this.error = _("Could not save the claim. Your data may still be syncing, try again in a moment.");
        }
        Page.projector.scheduleRender();
      });
    }

    handleRelease() {
      Page.cmd("wrapperConfirm", [_("Release your claim on this xite? The listing stays, but goes back to the submitter's description."), _("Release")], () => {
        Page.user.releaseClaim(this.address, (res) => {
          if (res === "ok") {
            this.hidden = true;
            Page.site_lists.update();
          }
          Page.projector.scheduleRender();
        });
      });
      return false;
    }

    renderRadio(name, values, extra_class) {
      return h("div.radiogroup" + (extra_class || ""), values.map((kv) => {
        var key = "" + kv[0];
        return [h("a.radio", {key: key, href: "#" + key, onclick: this.handleRadioClick,
          "data-name": name, "data-value": key,
          classes: {active: "" + this.data[name] === key}}, kv[1]), " "];
      }));
    }

    renderProof() {
      var dir = Page.user.getUserDirectory();
      if (!dir) {
        return h("div.claim-proof", h("div.field-note", _("Connect your xId first: the challenge is bound to the identity that will manage this listing.")));
      }
      return h("div.claim-proof", [
        h("div.claim-step", [
          h("span.claim-step-num", "1"),
          h("div.claim-step-body", [
            h("div.claim-step-title", _("Sign this challenge with the xite's private key")),
            h("div.claim-code", [
              h("code", Claim.challenge(this.address, dir)),
              h("a.claim-copy", {href: "#Copy", "data-copy": "challenge", onclick: this.handleCopy},
                this.copied === "challenge" ? _("copied") : _("copy"))
            ]),
            h("div.field-note", _("Run this on the node that holds the key. It signs with the stored key, or asks you to paste one; either way the key never becomes a command argument, so it stays out of your shell history and out of this page:")),
            h("div.claim-code.claim-code-cmd", [
              h("code", Claim.signCommand(this.address, dir)),
              h("a.claim-copy", {href: "#CopyCmd", "data-copy": "command", onclick: this.handleCopy},
                this.copied === "command" ? _("copied") : _("copy"))
            ])
          ])
        ]),
        h("div.claim-step", [
          h("span.claim-step-num", "2"),
          h("div.claim-step-body", [
            h("div.claim-step-title", _("Paste the signature it prints")),
            h("input.text", {type: "text", name: "signature", value: this.data.signature,
              placeholder: "e.g. HFzACm+9aUwOxCofwBGyBEC6...", oninput: this.handleInput,
              spellcheck: "false", autocomplete: "off"})
          ])
        ])
      ]);
    }

    render() {
      var mine = this.isMine();
      return h("div.form-takeover-container", {key: this, afterCreate: Animation.show, classes: {hidden: this.hidden}}, [
        h("div.form.form-takeover.form-claim", {afterCreate: Animation.slideDown, exitAnimation: Animation.slideUp}, [
          h("div.claim-head", [
            h("div.claim-title", mine ? _("Manage your listing") : _("Claim this xite")),
            h("div.claim-sub", mine
              ? _("You proved control of this xite's key. Keep its description accurate here.")
              : _("Prove you control this xite's key and its listing becomes yours to manage."))
          ]),
          h("div.claim-target", [h("span.claim-target-label", _("Xite")), h("code", this.address)]),
          mine ? null : this.renderProof(),
          this.error ? h("div.claim-error", this.error) : null,
          h("div.claim-fields", [
            h("div.formfield", [
              h("label.title", _("Title")),
              h("input.text", {type: "text", name: "title", value: this.data.title, oninput: this.handleInput})
            ]),
            h("div.formfield", [
              h("label.title", _("Description")),
              h("input.text", {type: "text", name: "description", value: this.data.description, oninput: this.handleInput})
            ]),
            h("div.formfield", [
              h("label.title", _("Category")),
              this.renderRadio("category", Page.translatedCategories())
            ]),
            h("div.formfield", [
              h("label.title", _("Language")),
              this.renderRadio("language", Page.languages.map(function(l) { return [l, l]; }), ".radiogroup-lang")
            ]),
            h("div.formfield", [
              h("label.title", _("Tags")),
              h("input.text", {type: "text", name: "tags", value: this.data.tags,
                placeholder: _("up to 5, comma separated"), oninput: this.handleInput})
            ]),
            h("div.formfield", [
              h("label.title", _("Content rating")),
              this.renderRadio("rating", [["g", _("General")], ["m", _("Mature")], ["a", _("Adult")]], ".radiogroup-rating"),
              h("div.field-note", _("You can make this listing stricter than it was submitted, never softer: the community's settled rating still governs what is hidden."))
            ]),
            h("div.formfield", [
              h("label.title", _("Listing in the directory")),
              h("a.hide-toggle", {href: "#Hide", onclick: this.handleHideClick,
                classes: {on: this.data.hidden === "1", disabled: this.reportsStanding()}}, [
                h("span.hide-box", this.data.hidden === "1" ? "✓" : ""),
                h("span.hide-label", this.data.hidden === "1"
                  ? _("Withdrawn: this xite is hidden from browse and search")
                  : _("Withdraw this xite from the directory"))
              ]),
              h("div.field-note", this.reportsStanding()
                ? _("This listing has open reports, so it cannot be withdrawn until they are resolved. Hiding it would hide them too.")
                : _("Withdrawal covers this xite's address, so a listing anyone submits later is hidden as well. Nothing is deleted, and you can undo this at any time."))
            ])
          ]),
          h("div.claim-actions", [
            h("a.cancel.link", {href: "#Cancel", onclick: this.handleCancel}, _("Cancel")),
            mine ? h("a.button.button-submit.button-outline", {href: "#Release", onclick: this.handleRelease}, _("Release claim")) : null,
            h("a.button.button-submit", {href: "#Claim", onclick: this.handleSubmit, classes: {loading: this.checking}},
              mine ? _("Save") : _("Verify and claim"))
          ])
        ])
      ]);
    }
  }

  Object.assign(ClaimForm.prototype, LogMixin);
  window.ClaimForm = ClaimForm;

})();
