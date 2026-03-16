(function() {

  class Text {
    toColor(text, saturation, lightness) {
      if (saturation === undefined) saturation = 30;
      if (lightness === undefined) lightness = 50;
      var hash = 0;
      for (var i = 0; i < text.length; i++) {
        hash += text.charCodeAt(i) * i;
        hash = hash % 1777;
      }
      return "hsl(" + (hash % 360) + "," + saturation + "%," + lightness + "%)";
    }

    renderMarked(text, options) {
      if (!options) options = {};
      options["gfm"] = true;
      options["breaks"] = true;
      options["renderer"] = marked_renderer;
      text = this.fixReply(text);
      text = marked(text, options);
      return this.fixHtmlLinks(text);
    }

    fixHtmlLinks(text) {
      return text;
    }

    fixLink(link) {
      return link;
    }

    toUrl(text) {
      return text.replace(/[^A-Za-z0-9]/g, "+").replace(/[+]+/g, "+").replace(/[+]+$/, "");
    }

    getSiteUrl(address) {
      return "/" + address;
    }

    fixReply(text) {
      return text.replace(/(>.*\n)([^\n>])/gm, "$1\n$2");
    }

    toEpixAddress(text) {
      return text.replace(/[^A-Za-z0-9.]/g, "");
    }

    toBitcoinAddress(text) {
      return text.replace(/[^A-Za-z0-9]/g, "");
    }

    jsonEncode(obj) {
      return unescape(encodeURIComponent(JSON.stringify(obj)));
    }

    jsonDecode(obj) {
      return JSON.parse(decodeURIComponent(escape(obj)));
    }

    fileEncode(obj) {
      if (typeof obj === "string") {
        return btoa(unescape(encodeURIComponent(obj)));
      } else {
        return btoa(unescape(encodeURIComponent(JSON.stringify(obj, undefined, '\t'))));
      }
    }

    utf8Encode(s) {
      return unescape(encodeURIComponent(s));
    }

    utf8Decode(s) {
      return decodeURIComponent(escape(s));
    }

    formatUsername(username) {
      if (!username) {
        return "Anonymous";
      }
      if (username.match(/^epix1[a-z0-9]{38,}$/)) {
        return username.substring(0, 16) + "...";
      }
      return username;
    }

    distance(s1, s2) {
      s1 = s1.toLocaleLowerCase();
      s2 = s2.toLocaleLowerCase();
      var next_find_i = 0;
      var next_find = s2[0];
      var match = true;
      var extra_parts = {};
      for (var ci = 0; ci < s1.length; ci++) {
        var char = s1[ci];
        if (char !== next_find) {
          if (extra_parts[next_find_i]) {
            extra_parts[next_find_i] += char;
          } else {
            extra_parts[next_find_i] = char;
          }
        } else {
          next_find_i++;
          next_find = s2[next_find_i];
        }
      }
      if (extra_parts[next_find_i]) {
        extra_parts[next_find_i] = "";
      }
      var extra_vals = [];
      for (var key in extra_parts) {
        extra_vals.push(extra_parts[key]);
      }
      if (next_find_i >= s2.length) {
        return extra_vals.length + extra_vals.join("").length;
      } else {
        return false;
      }
    }

    parseQuery(query) {
      var params = {};
      var parts = query.split('&');
      for (var i = 0; i < parts.length; i++) {
        var kv = parts[i].split("=");
        var key = kv[0];
        var val = kv[1];
        if (val) {
          params[decodeURIComponent(key)] = decodeURIComponent(val);
        } else {
          params["url"] = decodeURIComponent(key);
        }
      }
      return params;
    }

    queryEncode(params) {
      var back = [];
      if (params.url) {
        back.push(params.url);
      }
      for (var key in params) {
        var val = params[key];
        if (!val || key === "url") {
          continue;
        }
        back.push(encodeURIComponent(key) + "=" + encodeURIComponent(val));
      }
      return back.join("&");
    }

    encodeQuery(params) {
      return this.queryEncode(params);
    }

    sqlIn(values) {
      return "(" + values.map(function(value) { return "'" + value + "'"; }).join(',') + ")";
    }
  }

  window.is_proxy = false;
  window.Text = new Text();

})();
