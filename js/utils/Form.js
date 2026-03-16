(function() {

  class Form {
    constructor() {
      this.hidden = false;
      this.attached = false;
      this.reset = this.reset.bind(this);
      this.setData = this.setData.bind(this);
      this.handleInput = this.handleInput.bind(this);
      this.storeNode = this.storeNode.bind(this);
      this.addField = this.addField.bind(this);
      this.h = this.h.bind(this);
      this.shouldBeZite = this.shouldBeZite.bind(this);
      this.validate = this.validate.bind(this);
      this.handleCancelClick = this.handleCancelClick.bind(this);
      this.handleSubmitClick = this.handleSubmitClick.bind(this);
      this.handleDeleteClick = this.handleDeleteClick.bind(this);
      this.handleRadioClick = this.handleRadioClick.bind(this);
      this.renderField = this.renderField.bind(this);
      this.render = this.render.bind(this);
      this.reset();
    }

    reset() {
      this.data = {};
      this.data_original = {};
      this.inputs = {};
      this.invalid = {};
      this.nodes = {};
      this.fields = [];
    }

    setData(data) {
      this.data = data;
      this.data_original = JSON.parse(JSON.stringify(data));
    }

    handleInput(e) {
      this.data[e.target.name] = e.target.value;
      this.invalid[e.target.name] = false;
      return false;
    }

    storeNode(node) {
      if (node.attributes.for && node.attributes.for.value) {
        this.nodes[node.attributes.for.value + "-label"] = node;
      } else {
        this.nodes[node.attributes.name.value] = node;
      }
    }

    addField(type, id, title, props) {
      if (props.values && Array.isArray(props.values)) {
        if (props.values.length && !Array.isArray(props.values[0])) {
          props.values = props.values.map(function(key) { return [key, key]; });
        }
      }
      if (props.values && !Array.isArray(props.values) && typeof props.values === "object") {
        var arr = [];
        for (var key in props.values) {
          arr.push([key, props.values[key]]);
        }
        props.values = arr;
      }
      this.fields.push({type: type, id: id, title: title, props: props});
    }

    h(tag, props, childs) {
      this.inputs[props.name] = [tag, props, childs];
      if (props.value == null) props.value = this.data[props.name];
      if (props.id == null) props.id = props.name;
      if (props.oninput == null) props.oninput = this.handleInput;
      props.afterCreate = this.storeNode;
      if (!props.classes) props.classes = {};
      if (this.invalid[props.name] || this.invalid[props.for]) {
        props.classes.invalid = true;
      } else {
        props.classes.invalid = false;
      }
      if (this.invalid[props.name]) {
        return [
          h(tag, props, childs),
          h("div.invalid-reason", {key: "reason-" + props.name, enterAnimation: Animation.slideDown, exitAnimation: Animation.slideUp}, this.invalid[props.name])
        ];
      } else {
        return h(tag, props, childs);
      }
    }

    shouldBeZite(value) {
      if (!value.match(/(epix1[a-z0-9]{38,}|[A-Za-z0-9\.-]{2,99}\.[a-z]+)/)) {
        return "Invalid site address: only EpixNet addresses supported";
      }
    }

    validate() {
      var valid = true;
      this.invalid = {};
      for (var name in this.inputs) {
        var entry = this.inputs[name];
        var tag = entry[0];
        var props = entry[1];
        var childs = entry[2];
        if (props.required && !props.value) {
          this.invalid[name] = "This field is required";
          Animation.shake(this.nodes[props.name]);
          valid = false;
        } else if (props.validate) {
          var field_error;
          if (Array.isArray(props.validate)) {
            for (var i = 0; i < props.validate.length; i++) {
              field_error = props.validate[i](props.value);
              if (field_error) break;
            }
          } else {
            field_error = props.validate(props.value);
          }
          if (field_error) {
            valid = false;
            this.invalid[name] = field_error;
          }
        } else {
          this.invalid[name] = false;
        }
      }
      Page.projector.scheduleRender();
      return valid;
    }

    handleCancelClick() {
      this.hidden = true;
      for (var key in this.data_original) {
        this.data[key] = this.data_original[key];
      }
      Page.projector.scheduleRender();
      return false;
    }

    handleSubmitClick() {
      if (!this.validate()) {
        return false;
      }
      this.saveRow((res) => {
        if (res === "ok") {
          this.hidden = true;
          Page.projector.scheduleRender();
        }
      });
      return false;
    }

    handleDeleteClick() {
      Page.cmd("wrapperConfirm", ["Are you sure you want to delete this item?", "Delete"], () => {
        this.deleteRow((res) => {
          if (res === "ok") {
            this.hidden = true;
            Page.projector.scheduleRender();
          }
        });
      });
      return false;
    }

    handleRadioClick(e) {
      var id = e.currentTarget.attributes.for.value;
      this.data[id] = e.currentTarget.value;
      this.invalid[id] = false;
      Page.projector.scheduleRender();
      return false;
    }

    renderField(field) {
      var props = field.props;
      props.value = this.data[field.id];
      props.name = field.id;
      var values = props.values;
      if (field.type === "radio") {
        return h("div.formfield",
          this.h("label.title", {for: field.id}, field.title),
          this.h("div.radiogroup", props, [
            values.map((kv) => {
              var key = kv[0];
              var value = kv[1];
              return [h("a.radio", {for: props.id, key: key, href: "#" + key, onclick: this.handleRadioClick, value: key, classes: {active: this.data[field.id] === key}}, value), " "];
            })
          ])
        );
      } else {
        return h("div.formfield",
          this.h("label.title", {for: field.id}, field.title),
          this.h("input.text", props)
        );
      }
    }

    render(classname) {
      if (classname === undefined) classname = "";
      return h("div.form-takeover-container#FormEdit", {afterCreate: Animation.show, classes: {hidden: this.hidden}}, [
        h("div.form.form-takeover" + classname, {afterCreate: Animation.slideDown, exitAnimation: Animation.slideUp},
          this.fields.map(this.renderField),
          h("a.cancel.link", {href: "#Cancel", onclick: this.handleCancelClick}, "Cancel"),
          this.deleteRow ? h("a.button.button-submit.button-outline", {href: "#Delete", onclick: this.handleDeleteClick}, "Delete") : null,
          h("a.button.button-submit", {href: "#Modify", onclick: this.handleSubmitClick}, "Modify")
        )
      ]);
    }
  }

  Object.assign(Form.prototype, LogMixin);
  window.Form = Form;

})();
