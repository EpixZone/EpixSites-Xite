(function() {

  class Animation {
    slideDown(elem, props) {
      var h = elem.offsetHeight;
      var cstyle = window.getComputedStyle(elem);
      var margin_top = cstyle.marginTop;
      var margin_bottom = cstyle.marginBottom;
      var padding_top = cstyle.paddingTop;
      var padding_bottom = cstyle.paddingBottom;
      var transition = cstyle.transition;

      if (elem.getBoundingClientRect().top > 1600) {
        return;
      }

      elem.style.boxSizing = "border-box";
      elem.style.overflow = "hidden";
      elem.style.transform = "scale(0.6)";
      elem.style.opacity = "0";
      elem.style.height = "0px";
      elem.style.marginTop = "0px";
      elem.style.marginBottom = "0px";
      elem.style.paddingTop = "0px";
      elem.style.paddingBottom = "0px";
      elem.style.transition = "none";

      setTimeout(function() {
        elem.className += " animate-inout";
        elem.style.height = h + "px";
        elem.style.transform = "scale(1)";
        elem.style.opacity = "1";
        elem.style.marginTop = margin_top;
        elem.style.marginBottom = margin_bottom;
        elem.style.paddingTop = padding_top;
        elem.style.paddingBottom = padding_bottom;
      }, 50);

      elem.addEventListener("transitionend", function handler() {
        if (elem.style.pointerEvents === "none") {
          return;
        }
        elem.classList.remove("animate-inout");
        elem.style.transition = elem.style.transform = elem.style.opacity = elem.style.height = null;
        elem.style.boxSizing = elem.style.marginTop = elem.style.marginBottom = null;
        elem.style.paddingTop = elem.style.paddingBottom = elem.style.overflow = null;
        elem.removeEventListener("transitionend", handler, false);
      });
    }

    slideUp(elem, remove_func, props) {
      if (elem.getBoundingClientRect().top > 1600) {
        remove_func();
        return;
      }

      elem.className += " animate-back";
      elem.style.boxSizing = "border-box";
      elem.style.height = elem.offsetHeight + "px";
      elem.style.overflow = "hidden";
      elem.style.transform = "scale(1)";
      elem.style.opacity = "1";
      elem.style.pointerEvents = "none";
      setTimeout(function() {
        elem.style.height = "0px";
        elem.style.marginTop = "0px";
        elem.style.marginBottom = "0px";
        elem.style.paddingTop = "0px";
        elem.style.paddingBottom = "0px";
        elem.style.transform = "scale(0.8)";
        elem.style.borderTopWidth = "0px";
        elem.style.borderBottomWidth = "0px";
        elem.style.opacity = "0";
      }, 1);
      elem.addEventListener("transitionend", function handler(e) {
        if (e.propertyName === "opacity" || e.elapsedTime >= 0.6) {
          elem.removeEventListener("transitionend", handler, false);
          setTimeout(function() {
            if (typeof remove_func === "function") remove_func();
          }, 2000);
        }
      });
    }

    showRight(elem, props) {
      elem.className += " animate";
      elem.style.opacity = 0;
      elem.style.transform = "TranslateX(-20px) Scale(1.01)";
      setTimeout(function() {
        elem.style.opacity = 1;
        elem.style.transform = "TranslateX(0px) Scale(1)";
      }, 1);
      elem.addEventListener("transitionend", function handler() {
        elem.classList.remove("animate");
        elem.style.transform = elem.style.opacity = null;
        elem.removeEventListener("transitionend", handler, false);
      });
    }

    show(elem, props) {
      var delay = 1;
      var args = arguments;
      if (args.length >= 2 && args[args.length - 2] && args[args.length - 2].delay) {
        delay = args[args.length - 2].delay * 1000;
      }
      elem.style.transition = "none";
      elem.style.opacity = 0;
      setTimeout(function() {
        elem.className += " animate";
        elem.style.opacity = 1;
      }, 50);
      elem.addEventListener("transitionend", function handler(e) {
        if (e.propertyName === "opacity" || e.elapsedTime >= 0.3) {
          elem.classList.remove("animate");
          elem.style.opacity = null;
          elem.style.transition = null;
          elem.removeEventListener("transitionend", handler, false);
        }
      });
    }

    hide(elem, remove_func, props) {
      var delay = 1;
      var args = arguments;
      if (args.length >= 2 && args[args.length - 2] && args[args.length - 2].delay) {
        delay = args[args.length - 2].delay * 1000;
      }
      elem.className += " animate";
      setTimeout(function() {
        elem.style.opacity = 0;
      }, delay);
      elem.addEventListener("transitionend", function handler(e) {
        if (e.propertyName === "opacity") {
          remove_func();
          elem.removeEventListener("transitionend", handler, false);
        }
      });
    }

    addVisibleClass(elem, props) {
      setTimeout(function() {
        elem.classList.add("visible");
      });
    }

    shake(elem) {
      elem.classList.remove("shake");
      setTimeout(function() {
        elem.classList.add("shake");
      }, 50);
    }

    height(elem, props_old, props_new) {
      if (props_old.classes.hidden === props_new.classes.hidden) {
        return;
      }

      if (elem.className.indexOf("hidden") === -1) {
        elem.style.height = "auto";
        elem.style.transition = "none";
        elem.style.paddingTop = elem.style.paddingBottom = null;
        var h = elem.offsetHeight;
        elem.style.paddingTop = elem.style.paddingBottom = "0px";
        elem.style.height = "0px";
        setTimeout(function() {
          elem.style.transition = null;
        }, 1);
        setTimeout(function() {
          elem.style.height = h + "px";
          elem.style.paddingTop = elem.style.paddingBottom = null;
          elem.addEventListener("transitionend", function handler(e) {
            if (e.propertyName === "height" || e.elapsedTime >= 0.6) {
              elem.removeEventListener("transitionend", handler, false);
            }
            if (elem.style.height === h + "px") {
              elem.style.height = "auto";
            }
          });
        }, 10);
      } else {
        elem.style.height = elem.offsetHeight + "px";
        setTimeout(function() {
          elem.style.height = "0px";
          elem.style.paddingTop = elem.style.paddingBottom = "0px";
        });
      }
    }
  }

  window.Animation = new Animation();

})();
