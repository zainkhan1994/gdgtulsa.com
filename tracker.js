(() => {
  const COLLECTOR =
    "https://gdg-tulsa-collector-867531953739.us-central1.run.app/collect";

  const CONSENT_KEY = "gdg_analytics_consent";
  const ANON_KEY = "gdg_anonymous_id";
  const SESSION_KEY = "gdg_session_id";

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

  function sendEvent(eventName, extra = {}) {
    const payload = {
      consent: true,
      anonymous_id: anonymousId,
      session_id: sessionId,
      event_name: eventName,
      page_url: window.location.href,
      page_path: window.location.pathname,
      page_title: document.title,
      referrer: document.referrer,
      utm_source: params.get("utm_source") || "",
      utm_medium: params.get("utm_medium") || "",
      utm_campaign: params.get("utm_campaign") || "",
      ...extra
    };

    fetch(COLLECTOR, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(() => {});
  }

  sendEvent("page_view");

  document.addEventListener("click", event => {
    const link = event.target.closest("a");

    if (!link) return;

    sendEvent("click", {
      click_text: (link.innerText || link.textContent || "").trim().slice(0, 500),
      click_url: link.href || ""
    });
  });
})();
