(() => {
  const CONSENT_KEY = "gdg_analytics_consent";
  const ANON_KEY = "gdg_anonymous_id";
  const SESSION_KEY = "gdg_session_id";
  const LANDING_KEY = "gdg_landing_attribution";

  // Announced after every stored consent change so tracker.js can start or
  // stop in place. Nothing about the visitor travels on it beyond the decision
  // itself.
  const CHANGED_EVENT = "gdg:consent-changed";

  // Storage can throw outright, not just return null: Safari in private mode
  // and a browser configured to block site data both raise on access. Every
  // read and write goes through these so a hostile storage implementation
  // degrades the site instead of breaking it. A failed write reports false,
  // which callers treat as "the decision was not recorded".
  function readLocal(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeLocal(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  function dropLocal(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
  }

  function readSession(key) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeSession(key, value) {
    try {
      sessionStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  function dropSession(key) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
  }

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

  function snapshotOfCurrentPage() {
    const params = new URLSearchParams(window.location.search);

    return {
      page_url: safeUrl(window.location.href),
      page_path: window.location.pathname,
      referrer: safeUrl(document.referrer),
      utm_source: params.get("utm_source") || "",
      utm_medium: params.get("utm_medium") || "",
      utm_campaign: params.get("utm_campaign") || "",
      captured_at: new Date().toISOString(),
      consumed: false
    };
  }

  function captureLandingAttribution({ replace = false } = {}) {
    // First landing of the browsing session wins. Later internal navigation
    // must never overwrite an external entry source. A re-grant passes
    // replace, because at that point the visitor's entry point genuinely is
    // the page they are standing on.
    if (!replace && readSession(LANDING_KEY)) return;

    writeSession(LANDING_KEY, JSON.stringify(snapshotOfCurrentPage()));
  }

  // Only the two real states are honoured. Anything else in storage — a
  // leftover value, or something another script wrote — reads as undecided,
  // which is the safe interpretation because it collects nothing.
  function getConsent() {
    const stored = readLocal(CONSENT_KEY);
    return stored === "granted" || stored === "denied" ? stored : null;
  }

  // Everything that identifies a visitor to analytics, removed together. The
  // landing snapshot goes too: it describes how this person arrived, so it
  // outlives its purpose the moment they refuse collection.
  function clearAnalyticsIdentity() {
    dropLocal(ANON_KEY);
    dropSession(SESSION_KEY);
    dropSession(LANDING_KEY);
  }

  // The single writer for the consent key. The banner and the preferences
  // dialog both come through here, so a decision has the same consequences
  // however it was made.
  function setConsent(next) {
    if (next !== "granted" && next !== "denied") return false;

    const previous = getConsent();

    // Fail closed. If the decision cannot be recorded, nothing downstream is
    // told it changed, so the tracker does not start on a preference that
    // would be forgotten on the next page load.
    if (!writeLocal(CONSENT_KEY, next)) return false;

    if (next === "denied") {
      clearAnalyticsIdentity();
    } else if (previous === "denied") {
      // Re-granting after a revocation. The old snapshot was destroyed at the
      // moment of denial and is not recoverable, which is the point: nothing
      // from the denied period is reconstructed. What the visitor gets is a
      // fresh snapshot of where they are standing now, from the same safe
      // fields as any other landing.
      //
      // An undecided visitor accepting for the first time is deliberately not
      // handled here: their pre-consent snapshot already holds the real entry
      // source and must survive the internal navigation that usually happens
      // before someone clicks Accept.
      captureLandingAttribution({ replace: true });
    }

    window.dispatchEvent(
      new CustomEvent(CHANGED_EVENT, { detail: { consent: next, previous } })
    );

    return true;
  }

  // Published for the preferences dialog. Deliberately small: read the
  // decision, write a decision. The storage keys and the identifier lifecycle
  // stay this file's business.
  window.gdgConsent = {
    CONSENT_KEY,
    CHANGED_EVENT,
    get: getConsent,
    set: setConsent,
    isGranted: () => getConsent() === "granted"
  };

  const consent = getConsent();

  if (consent === "denied") {
    // Explicit denial: drop any snapshot taken before the visitor decided.
    dropSession(LANDING_KEY);
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
      // No reload. setConsent announces the change and tracker.js starts in
      // place, which is the same path the preferences dialog uses.
      if (setConsent("granted")) {
        banner.remove();
      }
    });

  document
    .getElementById("gdg-consent-decline")
    .addEventListener("click", () => {
      setConsent("denied");
      banner.remove();
    });
})();
