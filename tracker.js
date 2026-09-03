(() => {
  const COLLECTOR =
    "https://gdg-tulsa-collector-867531953739.us-central1.run.app/collect";

  const CONSENT_KEY = "gdg_analytics_consent";
  const ANON_KEY = "gdg_anonymous_id";
  const SESSION_KEY = "gdg_session_id";
  const LANDING_KEY = "gdg_landing_attribution";

  if (localStorage.getItem(CONSENT_KEY) !== "granted") {
    return;
  }

  const createId = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2);

  let anonymousId = localStorage.getItem(ANON_KEY);

  if (!anonymousId) {
    anonymousId = createId();
    localStorage.setItem(ANON_KEY, anonymousId);
  }

  let sessionId = sessionStorage.getItem(SESSION_KEY);

  if (!sessionId) {
    sessionId = createId();
    sessionStorage.setItem(SESSION_KEY, sessionId);
  }

  const params = new URLSearchParams(window.location.search);

  // Conversion events. Only these names are ever sent; anything else arriving
  // on the gdg:analytics channel is discarded. Keeping this an explicit
  // allowlist means application code cannot invent an event name, and cannot
  // smuggle a value through one either.
  const CONVERSION_EVENTS = new Set([
    "email_click",
    "speaker_interest",
    "partner_interest",
    "schedule_open",
    "schedule_submit",
    "member_register_open"
  ]);

  // Reads the fixed subject from a mailto href. These subjects are hard-coded
  // in the site's markup, never typed by a visitor.
  function mailtoSubject(href) {
    const q = href.indexOf("?");
    if (q === -1) return "";
    try {
      return (new URLSearchParams(href.slice(q + 1)).get("subject") || "").trim().toLowerCase();
    } catch {
      return "";
    }
  }

  function safeAnalyticsUrl(value) {
    if (!value) return "";

    try {
      const url = new URL(value, window.location.origin);
      return `${url.origin}${url.pathname}`;
    } catch {
      return "";
    }
  }

  // Acquisition fields preserved from the pre-consent landing snapshot that
  // consent.js writes. Consumed exactly once, by the first tracked page_view,
  // so that later internal navigation cannot overwrite the original entry
  // source. The snapshot is left in place and marked instead of deleted:
  // consent.js only captures when the key is absent, so keeping it prevents a
  // later internal page from being recorded as a new landing.
  //
  // Only referrer and the three UTM fields are taken. page_url and page_path
  // stay the page actually being viewed, so Page Traffic keeps reporting real
  // page views rather than a page the visitor may have left long ago.
  function takeLandingAttribution() {
    let snapshot;

    try {
      const raw = sessionStorage.getItem(LANDING_KEY);
      if (!raw) return null;

      snapshot = JSON.parse(raw);
    } catch {
      return null;
    }

    if (!snapshot || typeof snapshot !== "object" || snapshot.consumed) {
      return null;
    }

    try {
      snapshot.consumed = true;
      sessionStorage.setItem(LANDING_KEY, JSON.stringify(snapshot));
    } catch {
      // Could not mark it consumed, so do not risk applying it more than once.
      return null;
    }

    const text = value => (typeof value === "string" ? value : "");

    return {
      referrer: text(snapshot.referrer),
      utm_source: text(snapshot.utm_source),
      utm_medium: text(snapshot.utm_medium),
      utm_campaign: text(snapshot.utm_campaign)
    };
  }

  function sendEvent(eventName, extra = {}, useBeacon = false) {
    const payload = {
      consent: true,
      anonymous_id: anonymousId,
      session_id: sessionId,
      event_name: eventName,
      page_url: safeAnalyticsUrl(window.location.href),
      page_path: window.location.pathname,
      page_title: document.title,
      referrer: safeAnalyticsUrl(document.referrer),
      utm_source: params.get("utm_source") || "",
      utm_medium: params.get("utm_medium") || "",
      utm_campaign: params.get("utm_campaign") || "",
      ...extra
    };

    const body = JSON.stringify(payload);

    if (useBeacon && navigator.sendBeacon) {
      const blob = new Blob([body], {
        type: "text/plain;charset=UTF-8"
      });

      if (navigator.sendBeacon(COLLECTOR, blob)) {
        return;
      }
    }

    fetch(COLLECTOR, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body,
      keepalive: true
    }).catch(() => {});
  }

  sendEvent("page_view", takeLandingAttribution() || {});

  // Tell application code that consent is granted and the analytics browser
  // and session IDs now exist. No identifiers or authentication data are
  // included in the event itself.
  window.dispatchEvent(new Event("gdg:analytics-ready"));

  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    // Opens a modal rather than navigating, so no beacon is needed. Nothing is
    // prevented or stopped here, so script.js handles the click exactly as before.
    //
    // schedule_open is deliberately NOT tracked here. A click on
    // [data-open-scheduler] is only an attempt — openScheduler() still returns
    // early for a non-confirmed member or a missing modal. script.js emits
    // schedule_open once the modal is actually shown.
    if (target.closest('[data-open-auth="register"]')) {
      sendEvent("member_register_open");
    }

    const link = target.closest("a");

    if (!link) return;

    // Existing generic link tracking — unchanged.
    sendEvent("click", {
      click_text: (link.innerText || link.textContent || "").trim().slice(0, 500),
      click_url: link.href || ""
    }, true);

    // Additionally classify contact links. Sent with no extra fields: the
    // page context sendEvent already attaches is enough to attribute the
    // conversion, and adding the href here would serve no purpose.
    const href = link.getAttribute("href") || "";
    if (!href.toLowerCase().startsWith("mailto:")) return;

    sendEvent("email_click", {}, true);

    const subject = mailtoSubject(href);
    if (subject === "speaker interest") {
      sendEvent("speaker_interest", {}, true);
    } else if (subject === "partnership interest") {
      sendEvent("partner_interest", {}, true);
    }
  });

  // Conversion channel for application code:
  //
  //   window.dispatchEvent(new CustomEvent("gdg:analytics", {
  //     detail: { event_name: "schedule_submit" }
  //   }));
  //
  // Only detail.event_name is read, and only if it is on the allowlist above.
  // Every other property of detail is ignored by construction, so a caller
  // cannot leak an email, uid or form field into analytics even by mistake.
  // anonymous_id and session_id stay private to this closure.
  window.addEventListener("gdg:analytics", event => {
    const name = event && event.detail && event.detail.event_name;
    if (typeof name !== "string" || !CONVERSION_EVENTS.has(name)) return;
    sendEvent(name);
  });
})();
