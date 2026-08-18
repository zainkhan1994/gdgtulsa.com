// Workspace page: product carousel controls.
(function () {
  var track = document.getElementById("wsCarousel");
  if (!track) return;
  var prevBtn = document.querySelector(".ws-car-nav.prev");
  var nextBtn = document.querySelector(".ws-car-nav.next");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function cardStep() {
    var card = track.querySelector(".ws-car-card");
    if (!card) return 340;
    var style = window.getComputedStyle(track);
    return card.getBoundingClientRect().width + parseFloat(style.gap || 22);
  }

  function scrollByCards(n) {
    track.scrollBy({ left: cardStep() * n, behavior: "smooth" });
  }

  nextBtn && nextBtn.addEventListener("click", function () { scrollByCards(1); });
  prevBtn && prevBtn.addEventListener("click", function () { scrollByCards(-1); });

  if (!reduceMotion) {
    var paused = false;
    ["mouseenter", "touchstart", "focusin"].forEach(function (evt) {
      track.addEventListener(evt, function () { paused = true; });
    });
    ["mouseleave", "touchend", "focusout"].forEach(function (evt) {
      track.addEventListener(evt, function () { paused = false; });
    });

    setInterval(function () {
      if (paused) return;
      var atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
      if (atEnd) {
        track.scrollTo({ left: 0, behavior: "smooth" });
      } else {
        scrollByCards(1);
      }
    }, 3200);
  }
})();
    
