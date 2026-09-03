(() => {
  const CONSENT_KEY = "gdg_analytics_consent";
  const LANDING_KEY = "gdg_landing_attribution";

  // Pre-consent landing attribution.
  //
  // Analytics only starts after consent is granted, so by the time a visitor
  // accepts they have usually navigated internally and the original external
  // referrer and campaign parameters are gone. The first tracked page_view
  // then looks like it came from gdgtulsa.com, which is why Acquisition
  // Attribution is dominated by "internal".
  //
  // This snapshot preserves the real entry source. It is written to
  // sessionStorage and nothing else: no network request is made, no analytics
  // identifier is created, and the collector is never contacted. tracker.js
  // reads it exactly once, and only after consent has been granted.
  //
  // Only the fields acquisition reporting needs are stored. The query string
  // is never kept — just the three UTM parameters, read individually.
  function safeUrl(value) {
    if (!value) return "";

    try {
      const url = new URL(value, window.location.origin);
      return `${url.origin}${url.pathname}`;
    } catch {
      return "";
    }
  }

  function captureLandingAttribution() {
    try {
      // First landing of the browsing session wins. Later internal
      // navigation must never overwrite an external entry source.
      if (sessionStorage.getItem(LANDING_KEY)) {
        return;
      }

      const params = new URLSearchParams(window.location.search);

      sessionStorage.setItem(
        LANDING_KEY,
        JSON.stringify({
          page_url: safeUrl(window.location.href),
          page_path: window.location.pathname,
          referrer: safeUrl(document.referrer),
          utm_source: params.get("utm_source") || "",
          utm_medium: params.get("utm_medium") || "",
          utm_campaign: params.get("utm_campaign") || "",
          captured_at: new Date().toISOString(),
          consumed: false
        })
      );
    } catch {
      // Storage unavailable (private mode, blocked site data). Attribution is
      // a best-effort improvement, never a requirement for the site to work.
    }
  }

  const consent = localStorage.getItem(CONSENT_KEY);

  if (consent === "denied") {
    // Explicit denial: drop any snapshot taken before the visitor decided.
    try {
      sessionStorage.removeItem(LANDING_KEY);
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
  } else {
    captureLandingAttribution();
  }

  if (consent) {
    return;
  }

  const banner = document.createElement("div");
  banner.id = "gdg-consent-banner";

  banner.innerHTML = `
    <div style="
      position:fixed;
      bottom:20px;
      left:20px;
      right:20px;
      max-width:700px;
      margin:auto;
      background:#fff;
      color:#202124;
      padding:18px;
      border-radius:12px;
      box-shadow:0 4px 20px rgba(0,0,0,.2);
      z-index:99999;
      font-family:Arial,sans-serif;
    ">
      <div style="margin-bottom:12px;">
        We use basic analytics to understand how visitors use the GDG Tulsa website.
        Analytics are only enabled with your permission.
      </div>

      <button id="gdg-consent-accept"
        style="padding:8px 16px;margin-right:8px;cursor:pointer;">
        Accept
      </button>

      <button id="gdg-consent-decline"
        style="padding:8px 16px;cursor:pointer;">
        Decline
      </button>
    </div>
  `;

  document.body.appendChild(banner);

  document
    .getElementById("gdg-consent-accept")
    .addEventListener("click", () => {
      localStorage.setItem(CONSENT_KEY, "granted");
      location.reload();
    });

  document
    .getElementById("gdg-consent-decline")
    .addEventListener("click", () => {
      localStorage.setItem(CONSENT_KEY, "denied");

      // Analytics was refused, so the pre-consent snapshot has no purpose.
      try {
        sessionStorage.removeItem(LANDING_KEY);
      } catch {
        // Nothing to clean up if storage is unavailable.
      }

      banner.remove();
    });
})();
