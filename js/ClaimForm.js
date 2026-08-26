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
        rating: this.row.rating || "g"
      };
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

    fields() {
      return {
        "title": this.data.title,
        "description": this.data.description,
        "category": this.data.category === "" ? undefined : parseInt(this.data.category),
        "language": this.data.language,
        "tags": this.data.tags,
        "rating": this.data.rating
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
        this.error = "Paste the signature produced by the command above.";
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
          this.error = "That signature does not match this xite's address. Check that you signed the exact challenge with the xite's own private key.";
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
          Page.cmd("wrapperNotification", ["done", "Ownership verified. This listing is now yours to manage."]);
          Page.site_lists.update();
        } else {
          this.error = "Could not save the claim. Your data may still be syncing, try again in a moment.";
        }
        Page.projector.scheduleRender();
      });
    }

    handleRelease() {
      Page.cmd("wrapperConfirm", ["Release your claim on this xite? The listing stays, but goes back to the submitter's description.", "Release"], () => {
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
        return h("div.claim-proof", h("div.field-note", "Connect your xId first: the challenge is bound to the identity that will manage this listing."));
      }
      return h("div.claim-proof", [
        h("div.claim-step", [
          h("span.claim-step-num", "1"),
          h("div.claim-step-body", [
            h("div.claim-step-title", "Sign this challenge with the xite's private key"),
            h("div.claim-code", [
              h("code", Claim.challenge(this.address, dir)),
              h("a.claim-copy", {href: "#Copy", "data-copy": "challenge", onclick: this.handleCopy},
                this.copied === "challenge" ? "copied" : "copy")
            ]),
            h("div.field-note", "On the machine that holds the key. Your key never touches this page:"),
            h("div.claim-code.claim-code-cmd", [
              h("code", Claim.signCommand(this.address, dir)),
              h("a.claim-copy", {href: "#CopyCmd", "data-copy": "command", onclick: this.handleCopy},
                this.copied === "command" ? "copied" : "copy")
            ])
          ])
        ]),
        h("div.claim-step", [
          h("span.claim-step-num", "2"),
          h("div.claim-step-body", [
            h("div.claim-step-title", "Paste the signature it prints"),
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
            h("div.claim-title", mine ? "Manage your listing" : "Claim this xite"),
            h("div.claim-sub", mine
              ? "You proved control of this xite's key. Keep its description accurate here."
              : "Prove you control this xite's key and its listing becomes yours to manage.")
          ]),
          h("div.claim-target", [h("span.claim-target-label", "Xite"), h("code", this.address)]),
          mine ? null : this.renderProof(),
          this.error ? h("div.claim-error", this.error) : null,
          h("div.claim-fields", [
            h("div.formfield", [
              h("label.title", "Title"),
              h("input.text", {type: "text", name: "title", value: this.data.title, oninput: this.handleInput})
            ]),
            h("div.formfield", [
              h("label.title", "Description"),
              h("input.text", {type: "text", name: "description", value: this.data.description, oninput: this.handleInput})
            ]),
            h("div.formfield", [
              h("label.title", "Category"),
              this.renderRadio("category", Page.categories)
            ]),
            h("div.formfield", [
              h("label.title", "Language"),
              this.renderRadio("language", Page.languages.map(function(l) { return [l, l]; }), ".radiogroup-lang")
            ]),
            h("div.formfield", [
              h("label.title", "Tags"),
              h("input.text", {type: "text", name: "tags", value: this.data.tags,
                placeholder: "up to 5, comma separated", oninput: this.handleInput})
            ]),
            h("div.formfield", [
              h("label.title", "Content rating"),
              this.renderRadio("rating", [["g", "General"], ["m", "Mature"], ["a", "Adult"]], ".radiogroup-rating"),
              h("div.field-note", "You can make this listing stricter than it was submitted, never softer: the community's settled rating still governs what safe mode hides.")
            ])
          ]),
          h("div.claim-actions", [
            h("a.cancel.link", {href: "#Cancel", onclick: this.handleCancel}, "Cancel"),
            mine ? h("a.button.button-submit.button-outline", {href: "#Release", onclick: this.handleRelease}, "Release claim") : null,
            h("a.button.button-submit", {href: "#Claim", onclick: this.handleSubmit, classes: {loading: this.checking}},
              mine ? "Save" : "Verify and claim")
          ])
        ])
      ]);
    }
  }

  Object.assign(ClaimForm.prototype, LogMixin);
  window.ClaimForm = ClaimForm;

})();
