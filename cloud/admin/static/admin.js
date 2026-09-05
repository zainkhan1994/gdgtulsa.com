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

const skeletons = document.querySelectorAll("[data-skeleton]");
const sidebar = document.querySelector("[data-sidebar]");
const sidebarToggle = document.querySelector("[data-sidebar-toggle]");
const sidebarBackdrop = document.querySelector("[data-sidebar-backdrop]");
const navLinks = document.querySelectorAll("[data-nav-link]");
const refreshLabel = refreshButton?.querySelector("span");

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

// Presentation helpers. Nothing below interprets API data differently; they
// only change how an already-computed value is drawn.

const BADGE_LEVELS = ["high", "medium", "low", "none"];

function badgeClass(value) {
  const key = String(value || "").trim().toLowerCase();
  return BADGE_LEVELS.includes(key) ? `status-badge badge-${key}` : "status-badge badge-none";
}

function badgeElement(text, className) {
  const badge = document.createElement("span");
  badge.className = className;
  // The label always carries the meaning; colour is only reinforcement.
  badge.textContent = text;
  return badge;
}

function appendBadgeCell(row, value, className) {
  const cell = document.createElement("td");
  cell.appendChild(badgeElement(displayValue(value), className));
  row.appendChild(cell);
}

function emptyRow(body, columns, message) {
  const row = document.createElement("tr");
  const cell = document.createElement("td");

  cell.colSpan = columns;
  cell.className = "empty-cell";
  cell.textContent = message;

  row.appendChild(cell);
  body.appendChild(row);
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

function renderTrends(rows) {
  const body = document.querySelector("[data-trends-body]");
  if (!body) return;

  body.replaceChildren();

  if (!rows.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 6;

    cell.className = "empty-cell";
    cell.textContent =
      "No website activity was recorded for this period.";

    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  for (const item of rows) {
    const row = document.createElement("tr");

    appendCell(row, item.date);
    appendCell(
      row,
      formatNumber(item.visitors),
      "number-cell"
    );
    appendCell(
      row,
      formatNumber(item.sessions),
      "number-cell"
    );
    appendCell(
      row,
      formatNumber(item.page_views),
      "number-cell"
    );
    appendCell(
      row,
      formatNumber(item.registration_starts),
      "number-cell"
    );
    appendCell(
      row,
      formatNumber(item.schedule_submits),
      "number-cell"
    );

    body.appendChild(row);
  }
}

// Inline SVG so the dashboard gains a chart without taking on a chart library.
const TREND_SERIES = [
  { key: "page_views", label: "Page views", color: "#2563eb" },
  { key: "sessions", label: "Sessions", color: "#0f766e" },
  { key: "visitors", label: "Visitors", color: "#b45309" }
];

const SVG_NS = "http://www.w3.org/2000/svg";

function svgNode(name, attributes) {
  const node = document.createElementNS(SVG_NS, name);

  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, String(value));
  }

  return node;
}

function shortDate(value) {
  if (!value) return "";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);

  return parsed.toLocaleDateString([], { month: "short", day: "numeric" });
}

function renderTrendsChart(rows) {
  const host = document.querySelector("[data-trends-chart]");
  if (!host) return;

  host.replaceChildren();

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "chart-empty";
    empty.textContent = "No daily activity recorded for this period.";
    host.appendChild(empty);
    return;
  }

  const width = 720;
  const height = 220;
  const left = 44;
  const right = 16;
  const top = 16;
  const bottom = 28;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;

  const peak = Math.max(
    1,
    ...rows.flatMap((item) =>
      TREND_SERIES.map((series) => numericValue(item[series.key]))
    )
  );

  const xAt = (index) =>
    rows.length > 1
      ? left + (index * innerWidth) / (rows.length - 1)
      : left + innerWidth / 2;

  const yAt = (value) =>
    top + innerHeight - (numericValue(value) / peak) * innerHeight;

  const svg = svgNode("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label":
      `Daily website activity over ${rows.length} ` +
      `${rows.length === 1 ? "day" : "days"}. ` +
      "The table below lists the same values."
  });

  // Horizontal gridlines with value labels.
  for (let step = 0; step <= 4; step += 1) {
    const value = (peak / 4) * step;
    const y = yAt(value);

    svg.appendChild(
      svgNode("line", {
        x1: left,
        x2: width - right,
        y1: y,
        y2: y,
        stroke: "#e6eaf0",
        "stroke-width": 1
      })
    );

    const label = svgNode("text", {
      x: left - 8,
      y: y + 4,
      "text-anchor": "end",
      fill: "#98a2b3",
      "font-size": 10
    });

    label.textContent = formatNumber(Math.round(value));
    svg.appendChild(label);
  }

  for (const series of TREND_SERIES) {
    const points = rows
      .map((item, index) => `${xAt(index)},${yAt(item[series.key])}`)
      .join(" ");

    svg.appendChild(
      svgNode("polyline", {
        points,
        fill: "none",
        stroke: series.color,
        "stroke-width": 2,
        "stroke-linecap": "round",
        "stroke-linejoin": "round"
      })
    );

    // A single day has no line to draw, so mark it with a dot instead.
    if (rows.length === 1) {
      svg.appendChild(
        svgNode("circle", {
          cx: xAt(0),
          cy: yAt(rows[0][series.key]),
          r: 3.5,
          fill: series.color
        })
      );
    }
  }

  // Only label the ends so crowded ranges stay readable.
  const ticks =
    rows.length > 1 ? [0, rows.length - 1] : [0];

  for (const index of ticks) {
    const label = svgNode("text", {
      x: xAt(index),
      y: height - 8,
      "text-anchor": index === 0 ? "start" : "end",
      fill: "#98a2b3",
      "font-size": 10
    });

    label.textContent = shortDate(rows[index].date);
    svg.appendChild(label);
  }

  host.appendChild(svg);

  const legend = document.createElement("div");
  legend.className = "chart-legend";

  for (const series of TREND_SERIES) {
    const item = document.createElement("span");
    item.className = "chart-legend-item";

    const swatch = document.createElement("span");
    swatch.className = "chart-swatch";
    swatch.style.background = series.color;
    swatch.setAttribute("aria-hidden", "true");

    const text = document.createElement("span");
    text.textContent = series.label;

    item.append(swatch, text);
    legend.appendChild(item);
  }

  host.appendChild(legend);
}

function renderFunnel(rows) {
  const body = document.querySelector("[data-funnel-body]");
  if (!body) return;

  body.replaceChildren();

  if (!rows.length) {
    emptyRow(body, 3, "No funnel activity for this period.");
    return;
  }

  // stage_order is the canonical ordering field. Sort defensively so the funnel
  // always renders 1 -> 5 and never depends on database row ordering.
  const stages = [...rows].sort(
    (a, b) => numericValue(a.stage_order) - numericValue(b.stage_order)
  );

  for (const item of stages) {
    const row = document.createElement("tr");

    // The bar is drawn from the percentage the backend already returned; the
    // frontend never recomputes funnel progression.
    const stageCell = document.createElement("td");
    const stageWrap = document.createElement("div");
    stageWrap.className = "funnel-stage";

    const stageName = document.createElement("span");
    stageName.textContent = displayValue(item.stage);

    const bar = document.createElement("div");
    bar.className = "funnel-bar";

    const fill = document.createElement("span");
    const share = Math.max(
      0,
      Math.min(1, numericValue(item.percent_of_visitors))
    );
    fill.style.width = `${share * 100}%`;
    bar.appendChild(fill);

    stageWrap.append(stageName, bar);
    stageCell.appendChild(stageWrap);
    row.appendChild(stageCell);

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

    appendCell(row, item.page_path, "path-cell");
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

function renderAcquisition(rows) {
  const body = document.querySelector("[data-acquisition-body]");
  if (!body) return;

  body.replaceChildren();

  if (!rows.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 8;

    cell.className = "empty-cell";
    cell.textContent =
      "No acquisition sources were recorded for this period.";

    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  for (const item of rows) {
    const row = document.createElement("tr");

    appendCell(row, item.source_type);
    appendCell(row, item.source);
    appendCell(row, item.utm_medium);
    appendCell(row, item.utm_campaign);
    appendCell(row, formatNumber(item.visitors), "number-cell");
    appendCell(
      row,
      formatNumber(item.registration_started),
      "number-cell"
    );
    appendCell(
      row,
      formatNumber(item.verified_members),
      "number-cell"
    );
    appendCell(
      row,
      formatNumber(item.schedule_submitted),
      "number-cell"
    );

    body.appendChild(row);
  }
}

function renderTrafficQuality(rows) {
  const body = document.querySelector("[data-traffic-quality-body]");
  if (!body) return;

  body.replaceChildren();

  if (!rows.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 4;

    cell.className = "empty-cell";
    cell.textContent = "No traffic was recorded for this period.";

    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  for (const item of rows) {
    const row = document.createElement("tr");

    appendCell(row, item.traffic_type);
    appendCell(row, formatNumber(item.visitors), "number-cell");
    appendCell(row, formatNumber(item.sessions), "number-cell");
    appendCell(row, formatNumber(item.page_views), "number-cell");

    body.appendChild(row);
  }
}

function journeyDate(value) {
  if (!value) return "—";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";

  return parsed.toLocaleDateString([], { month: "short", day: "numeric" });
}

function renderJourneys(rows) {
  const body = document.querySelector("[data-journeys-body]");
  if (!body) return;

  body.replaceChildren();

  if (!rows.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 8;

    cell.className = "empty-cell";
    cell.textContent = "No verified members yet.";

    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  for (const item of rows) {
    const row = document.createElement("tr");

    // Name over email, both from Firestore. Nothing here comes from analytics.
    const member = document.createElement("td");
    const name = document.createElement("div");
    name.className = "member-name";
    name.textContent = displayValue(item.name);
    member.appendChild(name);

    if (item.email) {
      const email = document.createElement("div");
      email.className = "journey-secondary";
      email.textContent = item.email;
      member.appendChild(email);
    }

    // Only that some activity was withheld, never whose it was.
    if (item.has_ambiguous_activity) {
      const note = document.createElement("div");
      note.className = "journey-note";
      note.textContent =
        "Some activity omitted due to shared-browser linkage.";
      member.appendChild(note);
    }

    row.appendChild(member);

    const interest = document.createElement("td");
    const level = badgeElement(
      displayValue(item.interest_level),
      badgeClass(item.interest_level)
    );
    interest.appendChild(level);

    const reason = document.createElement("div");
    reason.className = "journey-secondary";
    reason.textContent = displayValue(item.interest_reason);
    interest.appendChild(reason);
    row.appendChild(interest);

    if (item.activity_status === "none") {
      const empty = document.createElement("td");
      empty.colSpan = 6;
      empty.className = "journey-secondary empty-cell";
      empty.textContent = "No website activity recorded";
      row.appendChild(empty);
      body.appendChild(row);
      continue;
    }

    if (item.activity_status === "no_activity_in_range") {
      const empty = document.createElement("td");
      empty.colSpan = 6;
      empty.className = "journey-secondary empty-cell";
      empty.textContent = "No activity in selected range";
      row.appendChild(empty);
      body.appendChild(row);
      continue;
    }

    appendCell(row, item.first_source);
    appendCell(row, journeyDate(item.first_seen));
    appendCell(row, journeyDate(item.last_seen));
    appendCell(row, formatNumber(item.session_count), "number-cell");
    appendCell(row, formatNumber(item.page_view_count), "number-cell");
    appendCell(row, journeyDate(item.last_meaningful_activity_at));

    body.appendChild(row);
  }
}

const FOLLOW_UP_RANK = {
  "high:new": 0,
  "high:reviewed": 1,
  "medium:new": 2,
  "medium:reviewed": 3
};

const FOLLOW_UP_COMPLETED_RANK = { contacted: 4, dismissed: 5 };

function followUpRank(member) {
  const status = member.follow_up_status || "new";

  if (status in FOLLOW_UP_COMPLETED_RANK) {
    return FOLLOW_UP_COMPLETED_RANK[status];
  }

  const key = `${member.interest_level}:${status}`;
  return key in FOLLOW_UP_RANK ? FOLLOW_UP_RANK[key] : 6;
}

function followUpSortKey(a, b) {
  const rank = followUpRank(a) - followUpRank(b);
  if (rank !== 0) return rank;

  const left = a.last_meaningful_activity_at || "";
  const right = b.last_meaningful_activity_at || "";

  if (left !== right) return left < right ? 1 : -1;

  return (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase());
}

const FOLLOW_UP_STATUSES = ["new", "reviewed", "contacted", "dismissed"];

function followUpLabel(status) {
  if (!status) return "New";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

async function saveFollowUpStatus(memberRef, status) {
  const response = await fetch(
    `/api/follow-ups/${encodeURIComponent(memberRef)}`,
    {
      method: "PATCH",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    }
  );

  if (response.status === 401) {
    window.location.replace("/login");
    return false;
  }

  return response.ok;
}

function renderFollowUps(rows) {
  const body = document.querySelector("[data-follow-ups-body]");
  if (!body) return;

  body.replaceChildren();

  if (!rows.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 6;

    cell.className = "empty-cell";
    cell.textContent = "Nobody needs follow-up right now.";

    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  for (const item of rows) {
    const row = document.createElement("tr");

    const member = document.createElement("td");
    const name = document.createElement("div");
    name.className = "member-name";
    name.textContent = displayValue(item.name);
    member.appendChild(name);

    if (item.email) {
      const email = document.createElement("div");
      email.className = "journey-secondary";
      email.textContent = item.email;
      member.appendChild(email);
    }

    row.appendChild(member);

    appendBadgeCell(
      row,
      displayValue(item.interest_level),
      badgeClass(item.interest_level)
    );
    appendCell(row, displayValue(item.interest_reason));
    appendCell(row, journeyDate(item.last_meaningful_activity_at));
    appendBadgeCell(
      row,
      followUpLabel(item.follow_up_status),
      `status-badge badge-${item.follow_up_status || "new"}`
    );

    const action = document.createElement("td");
    const select = document.createElement("select");
    select.className = "follow-up-select";

    for (const status of FOLLOW_UP_STATUSES) {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = followUpLabel(status);
      select.appendChild(option);
    }

    select.value = item.follow_up_status || "new";

    select.addEventListener("change", async () => {
      const previous = item.follow_up_status || "new";
      const next = select.value;

      select.disabled = true;

      const saved = await saveFollowUpStatus(item.member_ref, next);

      select.disabled = false;

      if (!saved) {
        // Never leave a value on screen that did not persist.
        select.value = previous;

        if (analyticsStatus) {
          analyticsStatus.hidden = false;
          analyticsStatus.classList.add("error");
          analyticsStatus.textContent = "Follow-up status could not be saved.";
        }

        return;
      }

      item.follow_up_status = next;

      // Status changes placement, so re-render rather than leave a stale order.
      renderFollowUps(rows);
    });

    action.appendChild(select);
    row.appendChild(action);

    body.appendChild(row);
  }
}

function renderSources(rows) {
  const body = document.querySelector("[data-sources-body]");
  if (!body) return;

  body.replaceChildren();

  if (!rows.length) {
    emptyRow(body, 6, "No traffic sources recorded for this period.");
    return;
  }

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

    cell.className = "empty-cell";
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

    cell.className = "empty-cell";
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

    cell.className = "empty-cell";
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
    refreshButton.setAttribute("aria-busy", isLoading ? "true" : "false");
  }

  // Only the label changes; replacing textContent would delete the icon.
  if (refreshLabel) {
    refreshLabel.textContent = isLoading ? "Refreshing..." : "Refresh";
  }

  if (rangeSelect) {
    rangeSelect.disabled = isLoading;
  }
}

function hideSkeletons() {
  for (const skeleton of skeletons) {
    skeleton.hidden = true;
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

    // Journeys is its own endpoint: it needs Firestore as well as BigQuery, and
    // a failure there must not take the analytics dashboard down with it.
    const [response, journeysResponse] = await Promise.all([
      fetch(`/api/analytics?range=${encodeURIComponent(range)}`, {
        credentials: "same-origin",
        cache: "no-store"
      }),
      fetch(`/api/journeys?range=${encodeURIComponent(range)}`, {
        credentials: "same-origin",
        cache: "no-store"
      }).catch(() => null)
    ]);

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

    const acquisition = Array.isArray(payload.acquisition)
      ? payload.acquisition
      : [];

    const trafficQuality = Array.isArray(payload.traffic_quality)
      ? payload.traffic_quality
      : [];

    const trends = Array.isArray(payload.trends)
      ? payload.trends
      : [];

    renderMetrics(payload);
    renderTrends(trends);
    renderTrendsChart(trends);
    renderFunnel(funnel);
    renderAcquisition(acquisition);
    renderPages(pages);
    renderSources(sources);
    renderTrafficQuality(trafficQuality);

    let journeys = [];

    if (journeysResponse && journeysResponse.ok) {
      const journeysPayload = await journeysResponse.json();
      journeys = Array.isArray(journeysPayload.members)
        ? journeysPayload.members
        : [];
    }

    renderJourneys(journeys);

    // All-time operational queue: eligibility comes from the journey signal,
    // not from the analytics range selector.
    const followUps = journeys
      .filter(member =>
        member.activity_status === "active" &&
        (member.interest_level === "high" || member.interest_level === "medium"))
      .sort(followUpSortKey);

    renderFollowUps(followUps);

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
    // Placeholders must never outlive the request, success or failure.
    hideSkeletons();
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

let dashboardLoading = false;

async function loadDashboard() {
  // A second click while a refresh is in flight would double every request.
  if (dashboardLoading) return;

  dashboardLoading = true;

  try {
    await Promise.all([
      loadAnalytics(),
      loadCommunity()
    ]);
  } finally {
    dashboardLoading = false;
  }
}

/* Mobile navigation drawer. The sidebar is always in the DOM; on narrow
   viewports CSS moves it off-canvas and this toggles it back. */
function setSidebar(open) {
  if (!sidebar) return;

  sidebar.dataset.open = open ? "true" : "false";

  if (sidebarToggle) {
    sidebarToggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  if (sidebarBackdrop) {
    sidebarBackdrop.hidden = !open;
  }
}

sidebarToggle?.addEventListener("click", () => {
  setSidebar(sidebar?.dataset.open !== "true");
});

sidebarBackdrop?.addEventListener("click", () => setSidebar(false));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setSidebar(false);
});

for (const link of navLinks) {
  link.addEventListener("click", () => {
    setSidebar(false);

    for (const other of navLinks) {
      other.removeAttribute("aria-current");
    }

    link.setAttribute("aria-current", "true");
  });
}

loginButton?.addEventListener("click", loginWithGoogle);
signOutButton?.addEventListener("click", logout);
refreshButton?.addEventListener("click", loadDashboard);
rangeSelect?.addEventListener("change", loadAnalytics);

if (analyticsRoot) {
  loadDashboard();
}
