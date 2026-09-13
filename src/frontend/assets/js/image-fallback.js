// Declarative image fallbacks.
//
// These were inline onerror="" handlers. Inline event handlers cannot be
// covered by a CSP hash, so keeping them would have forced
// script-src 'unsafe-inline' site-wide. Same behaviour, driven by data
// attributes instead.
//
//   data-fallback-src="path"   swap to this source if the image fails
//   data-fallback-reveal="id"  hide the image and show this element instead
(() => {
  // error events do not bubble, so listen during the capture phase.
  document.addEventListener("error", (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;

    const alt = img.dataset.fallbackSrc;
    if (alt && !img.dataset.fallbackApplied) {
      img.dataset.fallbackApplied = "1";
      img.src = alt;
      return;
    }

    const revealId = img.dataset.fallbackReveal;
    if (revealId) {
      img.style.display = "none";
      const target = document.getElementById(revealId);
      if (target) target.style.display = "inline-flex";
    }
  }, true);
})();
