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

    cell.colSpan = 9;

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
    row.appendChild(intentCell(item, 1));

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

const FOLLOW_UP_STATUSES = ["new", "reviewed", "contacted", "dismissed"];

function followUpLabel(status) {
  if (!status) return "New";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// ===================== Follow-up workflow (V2) =====================
//
// Firestore holds operational state only; member details and activity still
// come from the existing member/analytics join. Nothing here writes anything
// that is not echoed back by the server.

const FOLLOW_UP_PRIORITIES = ["high", "medium", "low"];

/* System-derived behavioural intent. Read-only everywhere in the UI: there is
   no control that writes it, and it is deliberately never mixed with the
   admin-controlled `priority` field. */
const INTENT_LABELS = { high: "High intent", medium: "Medium intent", low: "Low intent" };

function intentOf(item) {
  return {
    score: Number.isFinite(item?.intent_score) ? item.intent_score : 0,
    level: item?.intent_level || "low",
    reasons: Array.isArray(item?.intent_reasons) ? item.intent_reasons : []
  };
}

function intentLabel(level) {
  return INTENT_LABELS[level] || INTENT_LABELS.low;
}

/* Level first so the meaning survives without colour, score second. */
function intentCell(item, reasonLimit = 2) {
  const intent = intentOf(item);
  const cell = document.createElement("td");
  cell.dataset.label = "Intent";

  const headline = document.createElement("div");
  headline.className = "intent-headline";
  headline.appendChild(
    badgeElement(intentLabel(intent.level), `status-badge badge-${intent.level}`)
  );

  const score = document.createElement("span");
  score.className = "intent-score";
  score.textContent = `${intent.score}`;
  headline.appendChild(score);
  cell.appendChild(headline);

  if (intent.reasons.length) {
    const summary = document.createElement("div");
    summary.className = "journey-secondary";
    // textContent, so a reason can only ever be displayed as text.
    summary.textContent = intent.reasons.slice(0, reasonLimit).join(" · ");
    cell.appendChild(summary);
  }

  return cell;
}

let followUpRows = [];
let followUpAdmins = [];
let currentAdmin = null;
let followUpEditing = null;
let followUpSaving = false;

const followUpFilters = {
  status: "", priority: "", owner: "", timing: "", intent: ""
};

function startOfTodayUtc() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function followUpDayValue(iso) {
  if (!iso) return null;

  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;

  return Date.UTC(
    parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()
  );
}

/* Overdue is derived from the clock, never stored: a persisted flag would be
   wrong the moment the day rolled over. Day granularity means something due
   today reads as due today rather than turning overdue at midnight. */
function followUpTiming(state) {
  const due = followUpDayValue(state.follow_up_at);
  if (due === null) return "none";

  const today = startOfTodayUtc();

  if (due < today) return state.status === "dismissed" ? "upcoming" : "overdue";
  if (due === today) return "today";
  return "upcoming";
}

/* journeyDate() omits the year, which is fine for recent activity but makes a
   2020 due date and a 2099 one both read as "Jan 1". Operational dates show
   the year whenever it is not the current one. */
function followUpDate(iso) {
  if (!iso) return "—";

  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";

  const sameYear = parsed.getUTCFullYear() === new Date().getUTCFullYear();

  return parsed.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
    ...(sameYear ? {} : { year: "numeric" })
  });
}

function followUpState(item) {
  return item.follow_up || { status: item.follow_up_status || "new" };
}

const TIMING_RANK = { overdue: 0, today: 2, upcoming: 3, none: 4 };

/* Actionable work first. Overdue outranks everything, then high priority,
   then due today, upcoming, unscheduled, and dismissed last. */
function followUpSortKey(a, b) {
  const stateA = followUpState(a);
  const stateB = followUpState(b);

  const dismissed = (s) => (s.status === "dismissed" ? 1 : 0);
  if (dismissed(stateA) !== dismissed(stateB)) {
    return dismissed(stateA) - dismissed(stateB);
  }

  // Overdue work outranks everything else that is still open.
  const overdue = (s) => (followUpTiming(s) === "overdue" ? 0 : 1);
  if (overdue(stateA) !== overdue(stateB)) return overdue(stateA) - overdue(stateB);

  /* Explicit human priority beats automated scoring: intent only breaks ties
     between leads an organiser has ranked the same. */
  const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
  const priority = (s) => PRIORITY_RANK[s.priority] ?? 3;
  if (priority(stateA) !== priority(stateB)) return priority(stateA) - priority(stateB);

  const intentRank = intentOf(b).score - intentOf(a).score;
  if (intentRank !== 0) return intentRank;

  const rank = (TIMING_RANK[followUpTiming(stateA)] ?? 4)
    - (TIMING_RANK[followUpTiming(stateB)] ?? 4);
  if (rank !== 0) return rank;

  const dueA = followUpDayValue(stateA.follow_up_at);
  const dueB = followUpDayValue(stateB.follow_up_at);

  if (dueA !== dueB) {
    if (dueA === null) return 1;
    if (dueB === null) return -1;
    return dueA - dueB;
  }

  const left = a.last_meaningful_activity_at || "";
  const right = b.last_meaningful_activity_at || "";
  if (left !== right) return left < right ? 1 : -1;

  // Name last so the order never depends on object iteration order.
  return (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase());
}

function followUpMatchesFilters(item) {
  const state = followUpState(item);

  if (followUpFilters.status && state.status !== followUpFilters.status) {
    return false;
  }

  if (followUpFilters.priority) {
    const wanted = followUpFilters.priority;
    const actual = state.priority || "unset";
    if (actual !== wanted) return false;
  }

  // System intent, evaluated independently of the manual priority filter so an
  // admin can hold both at once (high intent AND low priority, for example).
  if (followUpFilters.intent && intentOf(item).level !== followUpFilters.intent) {
    return false;
  }

  if (followUpFilters.owner === "me" && state.owner !== currentAdmin) return false;
  if (followUpFilters.owner === "unassigned" && state.owner) return false;

  if (followUpFilters.timing && followUpTiming(state) !== followUpFilters.timing) {
    return false;
  }

  return true;
}

function labelledCell(row, label, value, className = "") {
  const cell = document.createElement("td");
  cell.dataset.label = label;
  cell.textContent = displayValue(value);
  if (className) cell.className = className;
  row.appendChild(cell);
  return cell;
}

function renderFollowUps(rows) {
  const body = document.querySelector("[data-follow-ups-body]");
  if (!body) return;

  followUpRows = rows;
  body.replaceChildren();

  const visible = rows.filter(followUpMatchesFilters).sort(followUpSortKey);
  const counter = document.querySelector("[data-followup-count]");

  if (counter) {
    counter.textContent = rows.length
      ? `${visible.length} of ${rows.length} shown`
      : "";
  }

  if (!visible.length) {
    emptyRow(
      body, 10,
      rows.length
        ? "No follow-ups match these filters."
        : "Nobody needs follow-up right now."
    );
    return;
  }

  for (const item of visible) {
    const state = followUpState(item);
    const timing = followUpTiming(state);
    const row = document.createElement("tr");

    if (timing === "overdue") row.classList.add("row-overdue");

    const member = document.createElement("td");
    member.dataset.label = "Member";
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

    const interest = document.createElement("td");
    interest.dataset.label = "Interest";
    interest.appendChild(
      badgeElement(displayValue(item.interest_level), badgeClass(item.interest_level))
    );
    const reason = document.createElement("div");
    reason.className = "journey-secondary";
    reason.textContent = displayValue(item.interest_reason);
    interest.appendChild(reason);
    row.appendChild(interest);
    row.appendChild(intentCell(item));

    const priority = document.createElement("td");
    priority.dataset.label = "Priority";
    priority.appendChild(
      state.priority
        ? badgeElement(followUpLabel(state.priority), badgeClass(state.priority))
        : badgeElement("Not set", "status-badge badge-none")
    );
    row.appendChild(priority);

    const status = document.createElement("td");
    status.dataset.label = "Status";
    status.appendChild(
      badgeElement(
        followUpLabel(state.status),
        `status-badge badge-${state.status || "new"}`
      )
    );
    row.appendChild(status);

    labelledCell(row, "Owner", state.owner_label || "Unassigned");

    labelledCell(row, "Last contacted", followUpDate(state.last_contacted_at));

    const due = document.createElement("td");
    due.dataset.label = "Next follow-up";
    const dueText = document.createElement("span");
    dueText.textContent = followUpDate(state.follow_up_at);
    due.appendChild(dueText);

    if (timing === "overdue") {
      due.appendChild(badgeElement("Overdue", "status-badge badge-overdue"));
    } else if (timing === "today") {
      due.appendChild(badgeElement("Today", "status-badge badge-new"));
    }
    row.appendChild(due);

    labelledCell(row, "Next action", state.next_action || "—", "wrap-cell");

    const actions = document.createElement("td");
    actions.dataset.label = "Manage";
    const manage = document.createElement("button");
    manage.type = "button";
    manage.className = "secondary-button compact-button";
    manage.textContent = "Manage";
    manage.addEventListener("click", () => openFollowUpDrawer(item));
    actions.appendChild(manage);
    row.appendChild(actions);

    body.appendChild(row);
  }
}

// ------------------------------- drawer -------------------------------

const drawer = document.querySelector("[data-followup-drawer]");
const drawerBackdrop = document.querySelector("[data-followup-backdrop]");
const drawerError = document.querySelector("[data-followup-error]");
let followUpLastFocus = null;

function drawerField(name) {
  return document.querySelector(`[data-followup-${name}]`);
}

function dateInputValue(iso) {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function setDrawerError(message) {
  if (!drawerError) return;
  drawerError.textContent = message || "";
  drawerError.hidden = !message;
}

function renderOwnerOptions(select, selected) {
  if (!select) return;
  select.replaceChildren();

  const none = document.createElement("option");
  none.value = "";
  none.textContent = "Unassigned";
  select.appendChild(none);

  for (const admin of followUpAdmins) {
    const option = document.createElement("option");
    option.value = admin.id;
    option.textContent = admin.label;
    select.appendChild(option);
  }

  select.value = selected || "";
}

function openFollowUpDrawer(item) {
  if (!drawer) return;

  followUpEditing = item;
  followUpLastFocus = document.activeElement;
  const state = followUpState(item);

  const member = drawerField("member");
  if (member) member.textContent = displayValue(item.name);

  drawerField("status").value = state.status || "new";
  drawerField("priority").value = state.priority || "";
  renderOwnerOptions(drawerField("owner"), state.owner);
  drawerField("next-action").value = state.next_action || "";
  drawerField("date").value = dateInputValue(state.follow_up_at);
  drawerField("contacted").value = dateInputValue(state.last_contacted_at);
  drawerField("note").value = state.note || "";

  const intent = intentOf(item);
  const levelNode = drawerField("intent-level");
  const scoreNode = drawerField("intent-score");
  const reasonList = drawerField("intent-reasons");

  if (levelNode) {
    levelNode.replaceChildren(
      badgeElement(intentLabel(intent.level), `status-badge badge-${intent.level}`)
    );
  }

  if (scoreNode) scoreNode.textContent = `${intent.score} / 100`;

  if (reasonList) {
    reasonList.replaceChildren();

    if (!intent.reasons.length) {
      const none = document.createElement("li");
      none.textContent = "No scoring signals recorded yet.";
      reasonList.appendChild(none);
    }

    // Full contributing set here; the queue row shows only the top few.
    for (const reason of intent.reasons) {
      const entry = document.createElement("li");
      entry.textContent = reason;
      reasonList.appendChild(entry);
    }
  }

  const meta = drawerField("updated");
  if (meta) {
    meta.textContent = state.updated_at
      ? `Last updated ${formatDate(state.updated_at)}` +
        (state.updated_by ? ` by ${state.updated_by}` : "")
      : "Not yet updated.";
  }

  setDrawerError("");
  drawer.hidden = false;
  if (drawerBackdrop) drawerBackdrop.hidden = false;
  drawerField("status")?.focus();
}

function closeFollowUpDrawer() {
  if (!drawer) return;
  drawer.hidden = true;
  if (drawerBackdrop) drawerBackdrop.hidden = true;
  followUpEditing = null;
  setDrawerError("");
  followUpLastFocus?.focus?.();
}

function drawerPayload(state) {
  const priority = drawerField("priority").value;
  const owner = drawerField("owner").value;
  const followUpAt = drawerField("date").value;
  const contacted = drawerField("contacted").value;

  return {
    status: drawerField("status").value,
    priority: priority || null,
    owner: owner || null,
    note: drawerField("note").value,
    nextAction: drawerField("next-action").value,
    followUpAt: followUpAt ? `${followUpAt}T00:00:00Z` : null,
    lastContactedAt: contacted ? `${contacted}T00:00:00Z` : null,
    // Echoed straight back so the server can refuse an edit built on a
    // version somebody else has already replaced.
    expectedUpdatedAt: state.updated_at || "",
  };
}

async function saveFollowUp(memberRef, payload) {
  const response = await fetch(
    `/api/follow-ups/${encodeURIComponent(memberRef)}`,
    {
      method: "PATCH",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );

  if (response.status === 401) {
    window.location.replace("/login");
    return { ok: false };
  }

  let body = null;

  try {
    body = await response.json();
  } catch (error) {
    body = null;
  }

  return { ok: response.ok, status: response.status, body };
}

async function submitFollowUp(payload) {
  if (!followUpEditing || followUpSaving) return;

  followUpSaving = true;
  const save = drawerField("save");
  if (save) save.disabled = true;
  setDrawerError("");

  const result = await saveFollowUp(followUpEditing.member_ref, payload);

  followUpSaving = false;
  if (save) save.disabled = false;

  if (!result.ok) {
    if (result.status === 409) {
      // Somebody else got there first; show their version rather than
      // silently overwriting it.
      if (result.body?.follow_up) {
        followUpEditing.follow_up = result.body.follow_up;
        renderFollowUps(followUpRows);
        openFollowUpDrawer(followUpEditing);
      }
      setDrawerError(
        "This follow-up changed while you were editing. Reloaded the latest version."
      );
      return;
    }

    setDrawerError("Follow-up could not be saved.");
    return;
  }

  if (result.body?.follow_up) {
    followUpEditing.follow_up = result.body.follow_up;
    followUpEditing.follow_up_status = result.body.follow_up.status;
  }

  renderFollowUps(followUpRows);
  closeFollowUpDrawer();
}

drawerField("save")?.addEventListener("click", () => {
  submitFollowUp(drawerPayload(followUpState(followUpEditing || {})));
});

drawerField("cancel")?.addEventListener("click", closeFollowUpDrawer);
drawerField("close")?.addEventListener("click", closeFollowUpDrawer);
drawerBackdrop?.addEventListener("click", closeFollowUpDrawer);

drawerField("contact-now")?.addEventListener("click", () => {
  const state = followUpState(followUpEditing || {});
  // The server sets both the status and the moment; the browser clock is
  // never the source of a contact timestamp.
  submitFollowUp({ contactedNow: true, expectedUpdatedAt: state.updated_at || "" });
});

drawerField("assign-me")?.addEventListener("click", () => {
  const state = followUpState(followUpEditing || {});
  submitFollowUp({ assignToMe: true, expectedUpdatedAt: state.updated_at || "" });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && drawer && !drawer.hidden) closeFollowUpDrawer();
});

for (const control of document.querySelectorAll("[data-followup-filter]")) {
  control.addEventListener("change", () => {
    followUpFilters[control.dataset.followupFilter] = control.value;
    renderFollowUps(followUpRows);
  });
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

      // Assignable owners are resolved server-side from the admin allowlist;
      // the browser only ever echoes back an id it was given.
      followUpAdmins = Array.isArray(journeysPayload.admins)
        ? journeysPayload.admins
        : [];
      currentAdmin = journeysPayload.current_admin || null;
      journeys = Array.isArray(journeysPayload.members)
        ? journeysPayload.members
        : [];
    }

    renderJourneys(journeys);

    // All-time operational queue: eligibility comes from the journey signal,
    // not from the analytics range selector.
    // renderFollowUps applies the operational sort and the queue filters.
    const followUps = journeys.filter(member =>
      member.activity_status === "active" &&
      (member.interest_level === "high" || member.interest_level === "medium"));

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
