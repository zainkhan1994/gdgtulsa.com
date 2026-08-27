(() => {
  const CONSENT_KEY = "gdg_analytics_consent";

  if (localStorage.getItem(CONSENT_KEY)) {
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
      banner.remove();
    });
})();
