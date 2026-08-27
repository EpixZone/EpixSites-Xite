(function() {

  // Long-press tooltips for touch.
  //
  // The styled tooltip is CSS hover, which touch devices never fire, so an
  // icon-only control would be unexplained on a phone: exactly where the
  // wording matters most, because there is no pointer to rest anywhere. A
  // press held on any [data-tip] element opens it, and the tap that ends the
  // press is swallowed so explaining a control never also operates it.
  //
  // Delegated from the document, so it covers controls maquette re-renders
  // and any tipped control added later.

  var LONG_PRESS_MS = 450;
  var AUTO_HIDE_MS = 4000;

  var timer = null;
  var auto_hide = null;
  var open_el = null;
  var swallow_click = false;

  function hide() {
    if (open_el) open_el.classList.remove("tip-open");
    open_el = null;
    clearTimeout(auto_hide);
  }

  function show(el) {
    hide();
    el.classList.add("tip-open");
    open_el = el;
    auto_hide = setTimeout(hide, AUTO_HIDE_MS);
  }

  function tipTarget(node) {
    return node && node.closest ? node.closest("[data-tip]") : null;
  }

  document.addEventListener("touchstart", function(e) {
    var el = tipTarget(e.target);
    hide();
    clearTimeout(timer);
    if (!el) return;
    timer = setTimeout(function() {
      show(el);
      // The touchend after this becomes a click; the press was a question,
      // not an instruction.
      swallow_click = true;
    }, LONG_PRESS_MS);
  }, {passive: true});

  document.addEventListener("touchmove", function() {
    clearTimeout(timer);
  }, {passive: true});

  document.addEventListener("touchend", function() {
    clearTimeout(timer);
  }, {passive: true});

  document.addEventListener("touchcancel", function() {
    clearTimeout(timer);
    swallow_click = false;
  }, {passive: true});

  // Capture phase: the control's own handler must not see this click.
  document.addEventListener("click", function(e) {
    if (!swallow_click) return;
    swallow_click = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  window.addEventListener("scroll", hide, {passive: true, capture: true});

})();
