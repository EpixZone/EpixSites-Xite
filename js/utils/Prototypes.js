(function() {

  String.prototype.startsWith = String.prototype.startsWith || function(s) { return this.slice(0, s.length) === s; };
  String.prototype.endsWith = String.prototype.endsWith || function(s) { return s === '' || this.slice(-s.length) === s; };
  String.prototype.repeat = String.prototype.repeat || function(count) { return new Array(count + 1).join(this); };

  window.isEmpty = function(obj) {
    for (var key in obj) {
      return false;
    }
    return true;
  };

})();
