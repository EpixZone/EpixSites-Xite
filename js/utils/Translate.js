(function() {

  var translations = {};
  var current = "en";

  // Languages written right to left. Persian is the one shipped today; the
  // list is what decides the document direction below.
  var RTL = {"fa": true, "ar": true, "he": true, "ur": true};

  window.loadLanguage = function(lang, cb) {
    current = lang || "en";
    applyDirection(current);
    if (!lang || lang === "en") {
      translations = {};
      if (cb) cb();
      return;
    }
    return Page.cmd("fileGet", {
      "inner_path": "languages/" + lang + ".json",
      "required": false
    }, function(data) {
      if (data) {
        try {
          translations = JSON.parse(data);
        } catch (e) {
          translations = {};
        }
      } else {
        translations = {};
      }
      if (cb) cb();
    });
  };

  function applyDirection(lang) {
    var dir = RTL[("" + lang).split("-")[0]] ? "rtl" : "ltr";
    document.documentElement.setAttribute("dir", dir);
    document.documentElement.setAttribute("lang", lang || "en");
  }

  // _(text) looks the source English up; an untranslated string falls through
  // unchanged, so a missing entry degrades to English rather than to a key.
  //
  // _(text, params) fills {name} placeholders AFTER the lookup, so a
  // translation can move them into whatever order its grammar needs, which a
  // concatenated sentence could never allow.
  window._ = function(text, params) {
    var out = (translations && translations[text]) || text;
    if (!params) return out;
    return out.replace(/\{(\w+)\}/g, function(whole, name) {
      return Object.prototype.hasOwnProperty.call(params, name) ? params[name] : whole;
    });
  };

  // Plural rules differ per language (Chinese has one form, Persian's differ
  // from English), so the caller passes both English forms and the
  // translation file may key on either. Only the chosen form is looked up.
  window._n = function(count, one, many, params) {
    var text = count === 1 ? one : many;
    var merged = {n: count};
    for (var key in params) merged[key] = params[key];
    return window._(text, merged);
  };

  window.currentLanguage = function() {
    return current;
  };

  window.isRtl = function() {
    return !!RTL[("" + current).split("-")[0]];
  };

  window.translateDOM = function() {};

})();
