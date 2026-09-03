(() => {
  const CONSENT_KEY = "gdg_analytics_consent";
  const LANDING_KEY = "gdg_landing_attribution";
  const ANON_KEY = "gdg_anonymous_id";
  const SESSION_KEY = "gdg_session_id";

  // Storage throws outright in private mode or when site data is blocked, so
  // every access goes through these. A failed read must never be mistaken for
  // consent: it degrades to "no decision recorded", which keeps analytics off.
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

  let banner = null;

  // The single place any consent decision is written.
  //
  // Granting re-captures landing attribution only when no snapshot exists. On
  // a first visit one was already taken at page load and is left alone; a
  // visitor re-enabling analytics after a denial has none, so the CURRENT page
  // becomes the consent-era entry point. Activity from the denied period is
  // never reconstructed.
  //
  // Denying clears every analytics identifier immediately. No event is sent
  // and the collector is never told: revocation is a purely local action, and
  // data already stored under consent is left untouched.
  function setConsent(state) {
    if (state !== "granted" && state !== "denied") return;

    // Fail closed. If the decision cannot be persisted, do not act as though
    // it was taken — in particular do not start tracking a visitor whose
    // "granted" would be forgotten on the very next page load.
    if (!writeLocal(CONSENT_KEY, state)) return;

    if (state === "granted") {
      captureLandingAttribution();
    } else {
      dropLocal(ANON_KEY);
      dropSession(SESSION_KEY);
      dropSession(LANDING_KEY);
    }

    if (banner) {
      banner.remove();
      banner = null;
    }

    // tracker.js starts or stops on this, so it is dispatched only once the
    // stored state and the identifiers are already consistent.
    window.dispatchEvent(
      new CustomEvent("gdg:consent-changed", { detail: { state } })
    );
  }

  const consent = readLocal(CONSENT_KEY);

  if (consent === "denied") {
    // Explicit denial: drop any snapshot taken before the visitor decided.
    dropSession(LANDING_KEY);
  } else {
    captureLandingAttribution();
  }

  // ---------------------------------------------------------------------
  // Privacy preferences dialog
  //
  // Reuses the site's existing modal pattern (.modal-backdrop / .auth-panel)
  // so it matches the scheduler dialog rather than introducing a second,
  // inconsistent system. Built lazily, on first open.
  // ---------------------------------------------------------------------
  let dialog = null;
  let dialogSelect = null;
  let lastFocused = null;

  function currentState() {
    // An undecided visitor is shown as not enabled. Opening preferences must
    // never record a decision on its own.
    return readLocal(CONSENT_KEY) === "granted" ? "granted" : "denied";
  }

  function focusable() {
    if (!dialog) return [];

    return Array.from(
      dialog.querySelectorAll("button, select, [href], input, textarea")
    ).filter(el => !el.disabled && el.offsetParent !== null);
  }

  function closeDialog() {
    if (!dialog || dialog.hidden) return;

    dialog.hidden = true;
    document.removeEventListener("keydown", onKeydown);

    try {
      if (lastFocused && typeof lastFocused.focus === "function") {
        lastFocused.focus();
      }
    } catch {
      // Returning focus is best effort.
    }

    lastFocused = null;
  }

  function onKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }

    if (event.key !== "Tab") return;

    // Keep Tab inside the dialog, but never strand the visitor: if nothing is
    // focusable the key is left entirely alone.
    const items = focusable();
    if (!items.length) return;

    const first = items[0];
    const last = items[items.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function buildDialog() {
    dialog = document.createElement("div");
    dialog.className = "modal-backdrop";
    dialog.hidden = true;
    dialog.setAttribute("data-privacy-dialog", "");

    dialog.innerHTML = `
      <section class="auth-panel privacy-panel" role="dialog" aria-modal="true"
        aria-labelledby="gdg-privacy-title">
        <button class="icon-close" type="button" data-privacy-close
          aria-label="Close privacy preferences">&times;</button>
        <div class="auth-copy">
          <h2 id="gdg-privacy-title">Privacy Preferences</h2>
          <p>
            Analytics helps us understand which pages and community resources
            are useful.
          </p>
        </div>
        <div class="privacy-field">
          <label for="gdg-privacy-analytics">Analytics</label>
          <select id="gdg-privacy-analytics" data-privacy-analytics>
            <option value="granted">Enabled</option>
            <option value="denied">Disabled</option>
          </select>
        </div>
        <div class="privacy-actions">
          <button class="button primary" type="button" data-privacy-save>
            Save preferences
          </button>
          <button class="button secondary" type="button" data-privacy-cancel>
            Cancel
          </button>
        </div>
      </section>
    `;

    document.body.appendChild(dialog);
    dialogSelect = dialog.querySelector("[data-privacy-analytics]");

    dialog.querySelector("[data-privacy-save]").addEventListener("click", () => {
      setConsent(dialogSelect.value === "granted" ? "granted" : "denied");
      closeDialog();
    });

    dialog
      .querySelector("[data-privacy-cancel]")
      .addEventListener("click", closeDialog);
    dialog
      .querySelector("[data-privacy-close]")
      .addEventListener("click", closeDialog);

    // Clicking the backdrop cancels, exactly like the site's other modal.
    dialog.addEventListener("click", event => {
      if (event.target === dialog) closeDialog();
    });
  }

  function openDialog(trigger) {
    if (!dialog) buildDialog();

    lastFocused = trigger || document.activeElement;

    // Always reflect the stored decision at the moment of opening.
    dialogSelect.value = currentState();

    dialog.hidden = false;
    document.addEventListener("keydown", onKeydown);

    window.setTimeout(() => {
      try {
        dialogSelect.focus();
      } catch {
        // Focus is a convenience; never let it break the dialog.
      }
    }, 30);
  }

  // The footer trigger ships hidden in the markup and is revealed here, so it
  // is never a dead control on a page where this script failed to run.
  const triggers = document.querySelectorAll("[data-privacy-preferences]");

  for (const trigger of triggers) {
    trigger.hidden = false;
    trigger.addEventListener("click", () => openDialog(trigger));
  }

  // ---------------------------------------------------------------------
  // First-visit consent banner
  // ---------------------------------------------------------------------
  if (consent) {
    return;
  }

  banner = document.createElement("div");
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
    .addEventListener("click", () => setConsent("granted"));

  document
    .getElementById("gdg-consent-decline")
    .addEventListener("click", () => setConsent("denied"));
})();
