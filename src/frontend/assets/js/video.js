// Video behaviour shared across pages: click-to-load YouTube facades, and a
// reduced-motion guard for decorative background clips.

// --- Click-to-load YouTube facades -----------------------------------------
//
// A YouTube embed costs roughly a megabyte of player script plus a long slice
// of main-thread time, all of it spent before the visitor has asked to watch
// anything. Each facade renders a local poster instead and swaps in the real
// iframe on the first click, so that cost is only paid by people who want it.
(() => {
  const facades = document.querySelectorAll("[data-video-facade]");
  if (!facades.length) return;

  const PLAYER_PARAMS = "autoplay=1&rel=0&modestbranding=1&playsinline=1";

  function activate(facade) {
    const id = facade.dataset.videoFacade;
    if (!id) return;

    const iframe = document.createElement("iframe");
    // autoplay is user-initiated here, so browsers honour it without muting.
    iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${PLAYER_PARAMS}`;
    iframe.title = facade.dataset.videoTitle || "Video player";
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    // The facade already occupies the frame at the right aspect ratio; the
    // iframe inherits that box so the swap does not shift any layout.
    iframe.setAttribute("frameborder", "0");

    facade.replaceWith(iframe);
    // Focus was on the button that just disappeared — move it into the player
    // so keyboard users are not dropped back to the top of the document.
    iframe.focus({ preventScroll: true });
  }

  facades.forEach((facade) => {
    facade.addEventListener("click", () => activate(facade), { once: true });
  });
})();

// --- Reduced-motion guard for decorative video ------------------------------
//
// The looping clips on these pages are decoration, and they replaced GIFs that
// animated unconditionally with no way to stop them. Honour the visitor's
// motion preference now that the format makes it possible: hold the poster
// frame instead of playing, and react if the preference changes mid-visit.
(() => {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  // Captured once: clearing the autoplay attribute would make a
  // `video[autoplay]` selector stop matching, so the clips could never be
  // restarted if the visitor turned the preference back off.
  const clips = [...document.querySelectorAll("video[autoplay]")];
  if (!clips.length) return;

  function apply() {
    for (const video of clips) {
      if (query.matches) {
        video.removeAttribute("autoplay");
        video.pause();
        video.currentTime = 0;
      } else {
        video.setAttribute("autoplay", "");
        // play() rejects when the browser declines autoplay; the poster stays
        // up in that case, which is the same outcome we want anyway.
        if (video.paused) video.play().catch(() => {});
      }
    }
  }

  apply();
  query.addEventListener("change", apply);
})();
