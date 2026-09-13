// AI Stack page: mobile accordion and desktop diagram interactions.
/* Mobile accordion */
(function () {
  document.querySelectorAll(".stack-acc-trigger").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var item = btn.closest(".stack-acc-item");
      var open = item.classList.contains("is-open");
      document.querySelectorAll(".stack-acc-item.is-open").forEach(function (el) {
        el.classList.remove("is-open");
        el.querySelector(".stack-acc-trigger").setAttribute("aria-expanded", "false");
      });
      if (!open) {
        item.classList.add("is-open");
        btn.setAttribute("aria-expanded", "true");
      }
    });
  });
})();

/* Desktop diagram */
(function () {
  var hubs = document.querySelectorAll(".hub-btn");
  var current = null;
  function setActive(group) {
    document.querySelectorAll(".leaf-card, .leaf-line").forEach(function (el) {
      el.classList.toggle("is-visible", el.dataset.group === group);
    });
    hubs.forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.group === group);
    });
  }
  hubs.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var group = btn.dataset.group;
      current = current === group ? null : group;
      setActive(current);
    });
  });
})();
    
