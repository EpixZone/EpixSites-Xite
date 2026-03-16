(function() {

  var limits = {};
  var call_after_interval = {};

  window.RateLimit = function(interval, fn) {
    if (!limits[fn]) {
      call_after_interval[fn] = false;
      fn(); // First call is not delayed
      limits[fn] = setTimeout(function() {
        if (call_after_interval[fn]) {
          fn();
        }
        delete limits[fn];
        delete call_after_interval[fn];
      }, interval);
    } else {
      // Called within interval, delay the call
      call_after_interval[fn] = true;
    }
  };

})();
