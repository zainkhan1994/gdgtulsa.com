(() => {
  // The visitor-facing way to revisit the analytics decision made at the
  // banner. It reads consent through the window.gdgConsent surface that
  // consent.js publishes and writes only on Save, so merely opening this
  // dialog never records a decision.
  const api = window.gdgConsent;

  if (!api) return;

  const DIALOG_ID = "gdg-consent-prefs";
  const TITLE_ID = "gdg-consent-prefs-title";
  const CHOICE_ID = "gdg-consent-prefs-choice";

  let backdrop = null;
  let panel = null;
  let choice = null;
  let statusNote = null;
  let lastFocused = null;
  let triggers = [];

  // Reflect the stored decision every time the dialog opens. An undecided
  // visitor is shown as not yet enabled, which is the truth: nothing is being
  // collected for them.
  function syncFromStorage() {
    const current = api.get();

    choice.value = current === "granted" ? "granted" : "denied";

    statusNote.textContent =
      current === "granted"
        ? "Analytics is currently enabled."
        : current === "denied"
          ? "Analytics is currently disabled."
          : "Analytics is not enabled yet.";
  }

  function focusable() {
    return Array.from(
      panel.querySelectorAll(
        'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'
      )
    ).filter(el => !el.disabled && el.getClientRects().length > 0);
  }

  function onKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }

    if (event.key !== "Tab") return;

    const items = focusable();

    // Nothing to hold focus on means something is wrong with the dialog. Let
    // the browser move focus normally rather than pinning the visitor here.
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

  function open(event) {
    lastFocused =
      (event && event.currentTarget) || document.activeElement || triggers[0];

    syncFromStorage();
    backdrop.hidden = false;

    triggers.forEach(button => button.setAttribute("aria-expanded", "true"));

    // Focus the control the dialog exists to change, not the close button.
    choice.focus();

    document.addEventListener("keydown", onKeydown);
  }

  function close() {
    if (!backdrop || backdrop.hidden) return;

    backdrop.hidden = true;

    triggers.forEach(button => button.setAttribute("aria-expanded", "false"));

    document.removeEventListener("keydown", onKeydown);

    // Return focus to whatever opened the dialog, falling back to the trigger.
    const target =
      lastFocused && document.contains(lastFocused) ? lastFocused : triggers[0];

    lastFocused = null;

    if (target && typeof target.focus === "function") {
      target.focus();
    }
  }

  function save() {
    const next = choice.value === "granted" ? "granted" : "denied";

    // A no-op Save should stay a no-op: re-affirming the current setting must
    // not restart the tracker and produce a second page_view.
    if (next === api.get()) {
      close();
      return;
    }

    if (!api.set(next)) {
      // Storage refused the write. Fail closed and say so rather than leaving
      // the visitor believing a setting was saved that was not.
      statusNote.textContent =
        "This browser is blocking site data, so the preference could not be saved. Analytics stays off.";
      return;
    }

    close();
  }

  function build() {
    backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.hidden = true;

    // Built from the site's own dialog classes — .modal-backdrop, .auth-panel,
    // .icon-close and .button all live in styles.css, which every public page
    // loads — so this matches the member dialog instead of introducing a
    // second modal style.
    backdrop.innerHTML = `
      <section class="auth-panel privacy-panel" id="${DIALOG_ID}"
        role="dialog" aria-modal="true" aria-labelledby="${TITLE_ID}">
        <button class="icon-close" type="button" data-consent-close
          aria-label="Close privacy preferences">&times;</button>
        <div class="auth-copy">
          <h2 id="${TITLE_ID}">Privacy Preferences</h2>
          <p>Analytics helps us understand which pages and community resources are useful.</p>
        </div>
        <div class="privacy-field">
          <label for="${CHOICE_ID}">Analytics</label>
          <select id="${CHOICE_ID}">
            <option value="granted">Enabled</option>
            <option value="denied">Disabled</option>
          </select>
        </div>
        <p class="privacy-status" data-consent-status role="status" aria-live="polite"></p>
        <div class="privacy-actions">
          <button class="button primary" type="button" data-consent-save>Save preferences</button>
          <button class="button secondary" type="button" data-consent-cancel>Cancel</button>
        </div>
      </section>
    `;

    document.body.appendChild(backdrop);

    panel = backdrop.querySelector(".privacy-panel");
    choice = backdrop.querySelector(`#${CHOICE_ID}`);
    statusNote = backdrop.querySelector("[data-consent-status]");

    backdrop.querySelector("[data-consent-save]").addEventListener("click", save);
    backdrop
      .querySelector("[data-consent-cancel]")
      .addEventListener("click", close);
    backdrop
      .querySelector("[data-consent-close]")
      .addEventListener("click", close);

    // Clicking the dimmed area behind the panel closes without saving, which
    // matches the site's other dialogs.
    backdrop.addEventListener("click", event => {
      if (event.target === backdrop) close();
    });
  }

  // The trigger ships in every page's footer markup, hidden, and is revealed
  // here. Shipping it hidden rather than creating it from script keeps it out
  // of the way when scripting is off — where no analytics runs and so there is
  // nothing to configure — while still being real markup in the page.
  function mountTriggers() {
    triggers = Array.from(document.querySelectorAll("[data-privacy-preferences]"));

    if (!triggers.length) {
      // No markup to attach to. Fall back to a created control so the dialog
      // is still reachable rather than silently absent.
      const footer = document.querySelector("footer") || document.body;
      const button = document.createElement("button");

      button.type = "button";
      button.className = "privacy-preferences-trigger";
      button.setAttribute("data-privacy-preferences", "");
      button.textContent = "Privacy Preferences";

      footer.appendChild(button);
      triggers = [button];
    }

    triggers.forEach(button => {
      button.hidden = false;
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-controls", DIALOG_ID);
      button.setAttribute("aria-expanded", "false");
      button.addEventListener("click", open);
    });
  }

  function mount() {
    build();
    mountTriggers();
  }

  // Keep the dialog honest if consent changes from anywhere else.
  window.addEventListener(api.CHANGED_EVENT, () => {
    if (panel && backdrop && !backdrop.hidden) syncFromStorage();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
