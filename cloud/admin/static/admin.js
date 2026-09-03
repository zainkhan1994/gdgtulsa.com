import { firebaseConfig } from "./firebase-config.js";

const FIREBASE_SDK_VERSION = "10.12.5";

const loginButton = document.querySelector("[data-google-login]");
const signOutButton = document.querySelector("[data-admin-signout]");
const status = document.querySelector("[data-auth-status]");

const analyticsRoot = document.querySelector("[data-analytics-root]");
const analyticsStatus = document.querySelector("[data-analytics-status]");
const analyticsContents = document.querySelectorAll("[data-analytics-content]");
const metrics = document.querySelector("[data-metrics]");
const refreshButton = document.querySelector("[data-analytics-refresh]");
const rangeSelect = document.querySelector("[data-analytics-range]");
const updatedAt = document.querySelector("[data-updated-at]");

const communityStatus = document.querySelector("[data-community-status]");
const communityMetrics = document.querySelector("[data-community-metrics]");
const communityContents = document.querySelectorAll("[data-community-content]");

function setStatus(message) {
  if (status) status.textContent = message;
}

async function firebaseModules() {
  const [appMod, authMod] = await Promise.all([
    import(
      `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`
    ),
    import(
      `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth.js`
    )
  ]);

  return { appMod, authMod };
}

async function loginWithGoogle() {
  if (!loginButton) return;

  loginButton.disabled = true;
  setStatus("Opening secure Google sign-in...");

  try {
    const { appMod, authMod } = await firebaseModules();

    const app = appMod.initializeApp(firebaseConfig);
    const auth = authMod.getAuth(app);

    await authMod.setPersistence(
      auth,
      authMod.inMemoryPersistence
    );

    const provider = new authMod.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    const credential = await authMod.signInWithPopup(
      auth,
      provider
    );

    const token = await credential.user.getIdToken(true);

    const response = await fetch("/session", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id_token: token
      })
    });

    await authMod.signOut(auth);

    if (!response.ok) {
      let message = "Admin sign-in failed.";

      try {
        const payload = await response.json();

        if (payload?.error === "admin access required") {
          message = "This Google account is not approved for admin access.";
        } else if (payload?.error === "verified account required") {
          message = "A verified Google account is required.";
        }
      } catch {
        // Keep generic error text.
      }

      throw new Error(message);
    }

    window.location.replace("/");
  } catch (error) {
    setStatus(
      error instanceof Error
        ? error.message
        : "Admin sign-in failed."
    );

    loginButton.disabled = false;
  }
}

async function logout() {
  if (!signOutButton) return;

  signOutButton.disabled = true;

  try {
    await fetch("/logout", {
      method: "POST",
      credentials: "same-origin"
    });
  } finally {
    window.location.replace("/login");
  }
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  return String(value);
}

function numericValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(
    numericValue(value)
  );
}

function formatDecimal(value) {
  const number = numericValue(value);

  return number.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}


function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function timestampValue(value) {
  if (!value) return 0;

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function appendCell(row, value, className = "") {
  const cell = document.createElement("td");
  cell.textContent = displayValue(value);

  if (className) {
    cell.className = className;
  }

  row.appendChild(cell);
}

function renderMetrics(payload) {
  const funnel = Array.isArray(payload.funnel)
    ? payload.funnel
    : [];

  const pages = Array.isArray(payload.pages)
    ? payload.pages
    : [];

  const sources = Array.isArray(payload.sources)
    ? payload.sources
    : [];

  const totalVisitors = funnel.reduce(
    (highest, row) =>
      Math.max(highest, numericValue(row.visitors)),
    0
  );

  const totalPageViews = pages.reduce(
    (total, row) =>
      total + numericValue(row.page_views),
    0
  );

  const totalSessions = sources.reduce(
    (total, row) =>
      total + numericValue(row.sessions),
    0
  );

  const visitorTarget = document.querySelector(
    "[data-total-visitors]"
  );
  const viewsTarget = document.querySelector(
    "[data-total-page-views]"
  );
  const sessionsTarget = document.querySelector(
    "[data-total-sessions]"
  );

  if (visitorTarget) {
    visitorTarget.textContent = formatNumber(totalVisitors);
  }

  if (viewsTarget) {
    viewsTarget.textContent = formatNumber(totalPageViews);
  }

  if (sessionsTarget) {
    sessionsTarget.textContent = formatNumber(totalSessions);
  }
}

function renderFunnel(rows) {
  const body = document.querySelector("[data-funnel-body]");
  if (!body) return;

  body.replaceChildren();

  for (const item of rows) {
    const row = document.createElement("tr");

    appendCell(row, item.stage);
    appendCell(row, formatNumber(item.visitors), "number-cell");
    appendCell(
      row,
      `${formatDecimal(
        numericValue(item.percent_of_visitors) * 100
      )}%`,
      "number-cell"
    );

    body.appendChild(row);
  }
}

function renderPages(rows) {
  const body = document.querySelector("[data-pages-body]");
  if (!body) return;

  body.replaceChildren();

  for (const item of rows) {
    const row = document.createElement("tr");

    appendCell(row, item.page_path);
    appendCell(row, formatNumber(item.page_views), "number-cell");
    appendCell(
      row,
      formatNumber(item.unique_visitors),
      "number-cell"
    );
    appendCell(row, formatNumber(item.sessions), "number-cell");
    appendCell(
      row,
      formatDecimal(item.page_views_per_visitor),
      "number-cell"
    );

    body.appendChild(row);
  }
}

function renderSources(rows) {
  const body = document.querySelector("[data-sources-body]");
  if (!body) return;

  body.replaceChildren();

  for (const item of rows) {
    const row = document.createElement("tr");

    appendCell(row, item.source_type);
    appendCell(row, item.source);
    appendCell(row, item.utm_medium);
    appendCell(row, item.utm_campaign);
    appendCell(row, formatNumber(item.sessions), "number-cell");
    appendCell(
      row,
      formatNumber(item.unique_visitors),
      "number-cell"
    );

    body.appendChild(row);
  }
}

function setMetric(selector, value) {
  const target = document.querySelector(selector);

  if (target) {
    target.textContent = formatNumber(value);
  }
}

function renderCommunitySummary(summary) {
  setMetric(
    "[data-chapter-members]",
    summary.chapter_members_all_time
  );
  setMetric("[data-new-members]", summary.new_members);
  setMetric(
    "[data-confirmed-members]",
    summary.confirmed_members
  );
  setMetric(
    "[data-registration-count]",
    summary.event_registrations
  );
  setMetric(
    "[data-schedule-count]",
    summary.schedule_requests
  );
}

function renderMembers(rows) {
  const body = document.querySelector("[data-members-body]");
  if (!body) return;

  body.replaceChildren();

  const sorted = [...rows].sort(
    (a, b) =>
      timestampValue(b.created_at) -
      timestampValue(a.created_at)
  );

  if (!sorted.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 5;
    cell.textContent = "No members registered yet.";
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  for (const item of sorted) {
    const row = document.createElement("tr");

    appendCell(row, item.name);
    appendCell(row, item.email);
    appendCell(
      row,
      item.confirmed ? "Confirmed" : "Pending"
    );
    appendCell(row, formatDate(item.created_at));
    appendCell(row, formatDate(item.terms_accepted_at));

    body.appendChild(row);
  }
}

function renderRegistrations(rows) {
  const body = document.querySelector(
    "[data-registrations-body]"
  );
  if (!body) return;

  body.replaceChildren();

  const sorted = [...rows].sort(
    (a, b) =>
      timestampValue(b.created_at) -
      timestampValue(a.created_at)
  );

  if (!sorted.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 5;
    cell.textContent = "No event registrations yet.";
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  for (const item of sorted) {
    const row = document.createElement("tr");

    appendCell(row, item.name);
    appendCell(row, item.email);
    appendCell(row, item.title);
    appendCell(row, item.type);
    appendCell(row, formatDate(item.created_at));

    body.appendChild(row);
  }
}

function renderSchedules(rows) {
  const body = document.querySelector("[data-schedules-body]");
  if (!body) return;

  body.replaceChildren();

  const sorted = [...rows].sort(
    (a, b) =>
      timestampValue(b.created_at) -
      timestampValue(a.created_at)
  );

  if (!sorted.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 5;
    cell.textContent = "No schedule requests yet.";
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  for (const item of sorted) {
    const row = document.createElement("tr");

    appendCell(row, item.name);
    appendCell(row, item.email);
    appendCell(row, item.title);
    appendCell(row, item.type);
    appendCell(row, formatDate(item.created_at));

    body.appendChild(row);
  }
}

function renderActivity(members, registrations, schedules) {
  const list = document.querySelector("[data-activity-list]");
  if (!list) return;

  list.replaceChildren();

  const activity = [
    ...members.map((item) => ({
      created_at: item.created_at,
      label: `${item.name || item.email || "Member"} ${
        item.confirmed
          ? "confirmed membership"
          : "started registration"
      }`
    })),
    ...registrations.map((item) => ({
      created_at: item.created_at,
      label: `${item.name || item.email || "Member"} registered for ${
        item.title || "an event"
      }`
    })),
    ...schedules.map((item) => ({
      created_at: item.created_at,
      label: `${item.name || item.email || "Member"} submitted ${
        item.title || "a schedule request"
      }`
    }))
  ]
    .sort(
      (a, b) =>
        timestampValue(b.created_at) -
        timestampValue(a.created_at)
    )
    .slice(0, 8);

  if (!activity.length) {
    const item = document.createElement("li");
    item.className = "activity-item";
    item.textContent = "No community activity yet.";
    list.appendChild(item);
    return;
  }

  for (const activityItem of activity) {
    const item = document.createElement("li");
    item.className = "activity-item";

    const label = document.createElement("strong");
    label.textContent = activityItem.label;

    const time = document.createElement("span");
    time.className = "activity-meta";
    time.textContent = formatDate(activityItem.created_at);

    item.append(label, time);
    list.appendChild(item);
  }
}

function setAnalyticsLoading(isLoading) {
  if (refreshButton) {
    refreshButton.disabled = isLoading;
    refreshButton.textContent = isLoading
      ? "Refreshing..."
      : "Refresh";
  }

  if (rangeSelect) {
    rangeSelect.disabled = isLoading;
  }
}

async function loadAnalytics() {
  if (!analyticsRoot) return;

  setAnalyticsLoading(true);

  if (analyticsStatus) {
    analyticsStatus.hidden = false;
    analyticsStatus.classList.remove("error");
    analyticsStatus.textContent = "Loading analytics...";
  }

  try {
    const range = rangeSelect?.value || "30d";

    const response = await fetch(
      `/api/analytics?range=${encodeURIComponent(range)}`,
      {
        credentials: "same-origin",
        cache: "no-store"
      }
    );

    if (response.status === 401) {
      window.location.replace("/login");
      return;
    }

    if (!response.ok) {
      throw new Error("Analytics could not be loaded.");
    }

    const payload = await response.json();

    const funnel = Array.isArray(payload.funnel)
      ? payload.funnel
      : [];

    const pages = Array.isArray(payload.pages)
      ? payload.pages
      : [];

    const sources = Array.isArray(payload.sources)
      ? payload.sources
      : [];

    renderMetrics(payload);
    renderFunnel(funnel);
    renderPages(pages);
    renderSources(sources);

    if (metrics) {
      metrics.hidden = false;
    }

    for (const section of analyticsContents) {
      section.hidden = false;
    }

    if (analyticsStatus) {
      analyticsStatus.hidden = true;
    }

    if (updatedAt) {
      updatedAt.textContent =
        `Updated ${new Date().toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit"
        })}`;
    }
  } catch (error) {
    if (analyticsStatus) {
      analyticsStatus.hidden = false;
      analyticsStatus.classList.add("error");
      analyticsStatus.textContent =
        error instanceof Error
          ? error.message
          : "Analytics could not be loaded.";
    }
  } finally {
    setAnalyticsLoading(false);
  }
}

async function loadCommunity() {
  if (!analyticsRoot) return;

  if (communityStatus) {
    communityStatus.hidden = false;
    communityStatus.classList.remove("error");
    communityStatus.textContent = "Loading community data...";
  }

  try {
    const response = await fetch("/api/community", {
      credentials: "same-origin",
      cache: "no-store"
    });

    if (response.status === 401) {
      window.location.replace("/login");
      return;
    }

    if (!response.ok) {
      throw new Error("Community data could not be loaded.");
    }

    const payload = await response.json();

    const members = Array.isArray(payload.members)
      ? payload.members
      : [];

    const registrations = Array.isArray(payload.registrations)
      ? payload.registrations
      : [];

    const schedules = Array.isArray(payload.schedule_requests)
      ? payload.schedule_requests
      : [];

    const summary =
      payload.summary && typeof payload.summary === "object"
        ? payload.summary
        : {};

    renderCommunitySummary(summary);
    renderMembers(members);
    renderRegistrations(registrations);
    renderSchedules(schedules);
    renderActivity(members, registrations, schedules);

    if (communityMetrics) {
      communityMetrics.hidden = false;
    }

    for (const section of communityContents) {
      section.hidden = false;
    }

    if (communityStatus) {
      communityStatus.hidden = true;
    }
  } catch (error) {
    if (communityStatus) {
      communityStatus.hidden = false;
      communityStatus.classList.add("error");
      communityStatus.textContent =
        error instanceof Error
          ? error.message
          : "Community data could not be loaded.";
    }
  }
}

async function loadDashboard() {
  await Promise.all([
    loadAnalytics(),
    loadCommunity()
  ]);
}

loginButton?.addEventListener("click", loginWithGoogle);
signOutButton?.addEventListener("click", logout);
refreshButton?.addEventListener("click", loadDashboard);
rangeSelect?.addEventListener("change", loadAnalytics);

if (analyticsRoot) {
  loadDashboard();
}
