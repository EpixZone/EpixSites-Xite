(function() {

  class User {
    constructor(auth_address, directory) {
      this.starred = {};
      this.directory_override = directory || null;
      this.certSelect = this.certSelect.bind(this);
      this.resolveXid = this.resolveXid.bind(this);
      this.onSiteInfo = this.onSiteInfo.bind(this);
      if (auth_address) {
        this.setAuthAddress(auth_address);
      }
    }

    setAuthAddress(auth_address) {
      this.auth_address = auth_address;
      if (Page.site_info.auth_address === auth_address) {
        this.updateStarred();
      }
    }

    updateStarred(cb) {
      this.starred = {};
      var user_dir = this.getUserDirectory();
      Page.cmd("dbQuery", ["SELECT site_star.* FROM json LEFT JOIN site_star USING (json_id) WHERE ?", {directory: "" + user_dir}], (res) => {
        for (var i = 0; i < res.length; i++) {
          this.starred[res[i]["site_uri"]] = true;
        }
        if (typeof cb === "function") cb();
        Page.projector.scheduleRender();
      });
    }

    getUserDirectory() {
      if (this.directory_override) {
        return this.directory_override;
      }
      if (Page.site_info && Page.site_info.xid_directory) {
        return Page.site_info.xid_directory;
      }
      return this.auth_address;
    }

    getPath() {
      return "data/users/" + this.getUserDirectory();
    }

    getDefaultData() {
      return {
        "site": [],
        "site_star": {},
        "site_comment": []
      };
    }

    getData(cb) {
      Page.cmd("fileGet", [this.getPath() + "/data.json", false], (data) => {
        data = JSON.parse(data);
        if (data == null) data = this.getDefaultData();
        cb(data);
      });
    }

    certSelect(cb) {
      Page.cmd("certXid", {}, (res) => {
        this.log("certXid result", res);
        if (res === "ok") {
          setTimeout(() => {
            Page.reloadSiteInfo();
            if (typeof cb === "function") cb(res);
          }, 500);
        } else {
          if (typeof cb === "function") cb(res);
        }
      });
    }

    resolveXid(address, cb) {
      Page.cmd("xidResolve", {"address": address}, (res) => {
        if (typeof cb === "function") cb(res);
      });
    }

    onSiteInfo(site_info) {
      if (site_info.event && site_info.event[0] === "cert_changed") {
        this.setAuthAddress(site_info.auth_address);
        Page.projector.scheduleRender();
      }
    }

    save(data, cb, privatekey) {
      var inner_path_content = this.getPath() + "/content.json";
      var sign_params = {"inner_path": inner_path_content};
      var publish_params = {"inner_path": inner_path_content, sign: false};
      if (privatekey) {
        sign_params.privatekey = privatekey;
        publish_params.privatekey = privatekey;
      }
      Page.cmd("fileWrite", [this.getPath() + "/data.json", Text.fileEncode(data)], (res_write) => {
        Page.cmd("siteSign", sign_params, (res_sign) => {
          if (typeof cb === "function") cb(res_sign);
          Page.cmd("sitePublish", publish_params, (res_publish) => {
            this.log("Save result", res_write, res_sign, res_publish);
          });
        });
      });
    }
  }

  Object.assign(User.prototype, LogMixin);
  window.User = User;

})();
