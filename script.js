import { adminEmails, firebaseConfig, firebaseReady } from "./firebase-config.js?v=9e35f5939bdd03bf3dc53bb32b83512516bebbaf";

const FIREBASE_SDK_VERSION = "10.12.5";
const meter = document.querySelector(".scroll-meter");
const toast = document.querySelector(".toast");
const navLinks = [...document.querySelectorAll(".site-header nav a[href^='#']")];
const sections = navLinks.map((link) => document.querySelector(link.getAttribute("href"))).filter(Boolean);
const memberSection = document.querySelector("[data-member-section]");
const memberFeed = document.querySelector("[data-member-feed]");
const authModal = document.querySelector("[data-auth-modal]");
const scheduleModal = document.querySelector("[data-schedule-modal]");
const adminDashboard = document.querySelector("[data-admin-dashboard]");

(function initRotatingHeadline() {
  const container = document.querySelector(".rotating-container");
  if (!container) return;

  const items = [
    {
      name: "Gemini",
      textColor: "#A8C7FA",
      svg: `<svg class="brand-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" fill="url(#gemini-grad)"/><defs><linearGradient id="gemini-grad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse"><stop stop-color="#4E82EE"/><stop offset="0.5" stop-color="#9B72CB"/><stop offset="1" stop-color="#D96570"/></linearGradient></defs></svg>`
    },
    {
      name: "Google Cloud",
      textColor: "#4285F4",
      svg: `<svg class="brand-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/></svg>`
    },
    {
      name: "Flutter",
      textColor: "#02569B",
      svg: `<svg class="brand-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#02569B" d="M14.314 0L2.3 12 6 15.7 21.686 0h-7.372zm.014 11.072L7.643 17.757l3.685 3.715 6.685-6.686 3.686 3.714L14.328 24H21.7l-3.686-3.714L21.7 16.572l-7.372-5.5z"/></svg>`
    },
    {
      name: "Firebase",
      textColor: "#FFCA28",
      svg: `<svg class="brand-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#FFA000" d="M3.89 15.672L6.255.96a.547.547 0 0 1 1.014-.145l3.153 5.92-6.532 8.937z"/><path fill="#F57C00" d="M12.983 7.82l2.25-4.298a.547.547 0 0 1 .987.037L20.1 15.67 12.983 7.82z"/><path fill="#FFCA28" d="M3.89 15.672l8.11 4.544a1.78 1.78 0 0 0 1.748 0l8.352-4.544-7.217 7.747a1.69 1.69 0 0 1-2.392 0L3.89 15.672z"/></svg>`
    },
    {
      name: "Android",
      textColor: "#3DDC84",
      svg: `<svg class="brand-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#3DDC84" d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.551 0 .9993.4482.9993.9993.0001.5511-.4483.9997-.9993.9997m-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4482.9997-.9993.9997m11.4045-6.02l1.996-3.46a.416.416 0 0 0-.1521-.5676.416.416 0 0 0-.5676.1521l-2.0223 3.503C15.5902 8.2439 13.8533 7.8508 12 7.8508s-3.5902.3931-5.1355 1.0881L4.8422 5.4359a.4161.416 0 0 0-.5677-.1521.4157.4157 0 0 0-.1521.5676l1.996 3.46C2.6889 11.2863.3435 15.3444 0 20.082h24c-.3435-4.7376-2.689-8.7957-6.1185-10.7606"/></svg>`
    }
  ];

  const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reduceMotionQuery.matches) return;

  let position = 1;
  window.setInterval(() => {
    const current = container.querySelector(".rotater.fade-in");
    if (current) {
      current.classList.remove("fade-in");
      current.classList.add("fade-out");
      window.setTimeout(() => current.remove(), 400);
    }

    const next = items[position];
    container.insertAdjacentHTML("beforeend", `
      <span class="rotater fade-in">
        ${next.svg}
        <span class="brand-text" style="--brand-color: ${next.textColor};">${next.name}</span>
      </span>
    `);
    container.setAttribute("aria-label", next.name);
    position = (position + 1) % items.length;
  }, 2600);
})();

// Mega nav dropdowns: previously CSS-only (:hover / :focus-within), which is
// unreliable on touch devices and in Safari (clicking a <button> doesn't
// always move focus there, so :focus-within never fires — the reported bug
// where "Events" needed several taps/clicks before the menu showed).
// Explicit click handling fixes it on every input type.
(function initMegaNav() {
  const megaHeader = document.querySelector(".site-header--mega");
  const navItems = [...document.querySelectorAll(".site-header--mega .nav-item")];
  if (!megaHeader || !navItems.length) return;

  const mobileNavQuery = window.matchMedia("(max-width: 900px)");

  function closeNavItems(except) {
    navItems.forEach((item) => {
      if (item === except) return;
      item.classList.remove("is-open");
      item.querySelector(".nav-trigger")?.setAttribute("aria-expanded", "false");
    });
  }

  navItems.forEach((item) => {
    const trigger = item.querySelector(".nav-trigger");
    const menu = item.querySelector(".nav-menu");
    if (!trigger || !menu) return;

    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      const isOpen = item.classList.contains("is-open");
      closeNavItems(isOpen ? null : item);
      item.classList.toggle("is-open", !isOpen);
      trigger.setAttribute("aria-expanded", String(!isOpen));
      if (!isOpen && mobileNavQuery.matches) {
        const headerBottom = megaHeader.getBoundingClientRect().bottom;
        menu.style.setProperty("--nav-menu-top", `${headerBottom + 8}px`);
      }
    });
  });

  document.addEventListener("click", () => closeNavItems(null));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeNavItems(null);
  });
})();

const storageKeys = {
  pendingMember: "gdgTulsaPendingMember",
  pendingGoogleTerms: "gdgTulsaPendingGoogleTerms",
  previewMembers: "gdgTulsaPreviewMembers",
  previewCurrentMember: "gdgTulsaPreviewCurrentMember",
  previewRegistrations: "gdgTulsaPreviewRegistrations",
  previewSchedules: "gdgTulsaPreviewScheduleRequests",
  // Set once a member signs in, so returning visitors get Firebase loaded
  // automatically while first-time visitors never pay for it.
  hasSignedIn: "gdgTulsaHasSignedIn"
};

const starterResources = [
  { category: "Certifications", tag: "Cloud", title: "Google Cloud Digital Leader sprint", body: "A Tulsa study track with prep links, weekly checkpoints, and a shared accountability channel.", action: "Start path", tone: "green-resource", order: 10 },
  { category: "Certifications", tag: "AI", title: "Gemini API portfolio badge", body: "Build a small AI project, publish a demo, and prepare a short community showcase.", action: "Open guide", tone: "yellow-resource", order: 20 },
  { category: "Certifications", tag: "Web", title: "Firebase app launch checklist", body: "Authentication, hosting, data rules, analytics, and deploy hygiene for first-time builders.", action: "View checklist", tone: "blue-resource", order: 30 },
  { category: "Accelerators", tag: "Startup", title: "Google for Startups readiness", body: "Office-hour prep, application checklist, and mentor notes for early Tulsa founders.", action: "Prepare", tone: "red-resource", order: 40 },
  { category: "Accelerators", tag: "Community", title: "Build with AI local showcase", body: "Member project slots for demos, feedback, and sponsor introductions.", action: "Apply", tone: "blue-resource", order: 50 },
  { category: "Accelerators", tag: "Mentors", title: "Founder and engineer roundtable", body: "A small-group session for product, architecture, hiring, and launch advice.", action: "Request slot", tone: "green-resource", order: 60, actionType: "schedule" },
  { category: "Job Opportunities", tag: "Google", title: "Cloud customer engineer track", body: "Curated role watchlist, resume notes, and interview prep resources for Google Cloud paths.", action: "View lead", tone: "yellow-resource", order: 70 },
  { category: "Job Opportunities", tag: "Tulsa", title: "Local partner hiring board", body: "Developer, data, product, and startup roles shared by community partners.", action: "Open board", tone: "green-resource", order: 80 },
  { category: "Job Opportunities", tag: "Resume", title: "Portfolio review queue", body: "Submit your GitHub, LinkedIn, or project page for review before applications.", action: "Schedule review", tone: "blue-resource", order: 90, actionType: "schedule" }
];

const starterEvents = [
  { date: "Jul 18", title: "Gemini build night", body: "Hands-on AI prototyping with practical demos and local project ideas.", order: 10 },
  { date: "Aug 08", title: "Firebase for founders", body: "Ship auth, hosting, and analytics without overbuilding the first version.", order: 20 },
  { date: "Sep 12", title: "Google Cloud career lab", body: "Cert prep, project portfolio review, and role matching with the community.", order: 30 }
];

const state = {
  authReady: false,
  firebaseOnline: false,
  currentMember: null,
  resources: [],
  events: [],
  registeredEvents: new Set(),
  admin: false
};

let firebaseApi = null;

const ANALYTICS_IDENTITY_ENDPOINT =
  "https://gdg-tulsa-collector-867531953739.us-central1.run.app/identify";
const ANALYTICS_ADMIN_ENDPOINT =
  "https://gdg-tulsa-collector-867531953739.us-central1.run.app/admin/analytics";
const ANALYTICS_CONSENT_KEY = "gdg_analytics_consent";
const ANALYTICS_ANON_KEY = "gdg_anonymous_id";
const ANALYTICS_SESSION_KEY = "gdg_session_id";

let analyticsIdentityLinked = "";
let analyticsIdentityInFlight = null;

async function linkAnalyticsIdentity(user = firebaseApi?.auth?.currentUser) {
  if (!user || user.emailVerified !== true) return;

  if (window.localStorage.getItem(ANALYTICS_CONSENT_KEY) !== "granted") {
    return;
  }

  const anonymousId = window.localStorage.getItem(ANALYTICS_ANON_KEY);
  const sessionId = window.sessionStorage.getItem(ANALYTICS_SESSION_KEY);

  if (!anonymousId || !sessionId) return;

  // Kept only in memory. The raw Firebase UID is never written to analytics
  // storage or sent in the request body.
  const linkKey = `${user.uid}:${anonymousId}:${sessionId}`;

  if (analyticsIdentityLinked === linkKey) return;

  if (analyticsIdentityInFlight?.key === linkKey) {
    return analyticsIdentityInFlight.promise;
  }

  const promise = (async () => {
    const token = await user.getIdToken();

    const response = await fetch(ANALYTICS_IDENTITY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        consent: true,
        anonymous_id: anonymousId,
        session_id: sessionId
      })
    });

    if (!response.ok) {
      throw new Error(`Identity link failed (${response.status})`);
    }

    analyticsIdentityLinked = linkKey;
  })()
    .catch((error) => {
      // Never log the token, UID or Firebase claims.
      console.warn(
        "Analytics identity link failed.",
        error instanceof Error ? error.message : "Unknown error"
      );
    })
    .finally(() => {
      if (analyticsIdentityInFlight?.key === linkKey) {
        analyticsIdentityInFlight = null;
      }
    });

  analyticsIdentityInFlight = { key: linkKey, promise };
  return promise;
}

window.addEventListener("gdg:analytics-ready", () => {
  void linkAnalyticsIdentity();
});

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isAdminEmail(email) {
  return adminEmails.map(normalizeEmail).includes(normalizeEmail(email));
}

function readJSON(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    showToast("Browser storage is unavailable.");
  }
}

function removeStored(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    return;
  }
}

function formatDate(value) {
  if (!value) return "";
  const date = value?.toDate ? value.toDate() : new Date(value);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function escapeHTML(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function toMillis(value) {
  if (!value) return 0;
  if (value.toMillis) return value.toMillis();
  return new Date(value).getTime();
}

function switchAuthTab(mode = "register") {
  const selected = mode === "login" ? "login" : "register";
  document.querySelectorAll("[data-auth-tab]").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.authTab === selected);
  });
  document.querySelectorAll("[data-auth-form]").forEach((form) => {
    form.hidden = form.dataset.authForm !== selected;
  });

  const title = document.querySelector("#auth-title");
  if (title) {
    title.textContent = selected === "login" ? "Sign in with a secure email link." : "Create your member account.";
  }
}

function openAuth(mode = "register", email = "") {
  if (!authModal) return;
  authModal.hidden = false;
  switchAuthTab(mode);
  const activeForm = document.querySelector(`[data-auth-form="${mode === "login" ? "login" : "register"}"]`);
  const emailInput = activeForm?.querySelector("input[name='email']");
  if (emailInput && email) emailInput.value = email;
  window.setTimeout(() => activeForm?.querySelector("input")?.focus(), 60);
}

function closeAuth() {
  if (authModal) authModal.hidden = true;
}

function showConfirmationPanel() {
  const panel = document.querySelector("[data-confirm-panel]");
  if (panel) panel.hidden = false;
}

function emailLinkSettings() {
  return {
    url: `${window.location.origin}${window.location.pathname}#members`,
    handleCodeInApp: true
  };
}

function formatAuthError(error) {
  const code = error?.code || "";
  const message = error?.message || "Please try again.";
  const knownMessages = {
    "auth/operation-not-allowed": "Firebase Authentication is blocking this method. Enable Email/Password with email-link sign-in and Google sign-in in the Firebase Console.",
    "auth/unauthorized-domain": `Firebase is blocking ${window.location.hostname}. Add this domain in Firebase Authentication > Settings > Authorized domains.`,
    "auth/invalid-api-key": "Firebase rejected the API key. Check firebase-config.js.",
    "auth/network-request-failed": "Firebase could not be reached. Check the network connection and try again.",
    "auth/popup-blocked": "The Google sign-in popup was blocked. Allow popups for this site and try again.",
    "auth/popup-closed-by-user": "The Google sign-in popup was closed before the account was selected."
  };
  return knownMessages[code] || message.replace(/^Firebase:\s*/i, "");
}

async function withFormStatus(form, pendingText, callback) {
  const button = form?.querySelector("button[type='submit']");
  const originalText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = pendingText;
  }
  try {
    await callback();
  } catch (error) {
    console.error(error);
    showToast(formatAuthError(error));
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function setupFirebase() {
  if (!firebaseReady) {
    state.authReady = true;
    renderAll();
    await renderAdminDashboard();
    showToast("Firebase config is not filled in yet. Real email verification is waiting on Firebase setup.");
    return;
  }

  try {
    const [appMod, authMod, firestoreMod] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-firestore.js`)
    ]);

    const app = appMod.initializeApp(firebaseConfig);
    const auth = authMod.getAuth(app);
    const db = firestoreMod.getFirestore(app);
    const googleProvider = new authMod.GoogleAuthProvider();
    googleProvider.setCustomParameters({ prompt: "select_account" });

    firebaseApi = { ...authMod, ...firestoreMod, app, auth, db, googleProvider };
    state.firebaseOnline = true;

    await completeEmailLinkSignIn();

    firebaseApi.onAuthStateChanged(auth, async (user) => {
      if (!user) {
        state.currentMember = null;
        state.admin = false;
        state.resources = [];
        state.events = [];
        state.registeredEvents.clear();
        state.authReady = true;
        // Stop pre-loading the SDK for this browser now that nobody is signed in.
        removeStored(storageKeys.hasSignedIn);
        renderAll();
        return;
      }

      // Remember that this browser has a session, so the next visit loads the
      // SDK up front instead of waiting for a click.
      writeJSON(storageKeys.hasSignedIn, true);
      state.currentMember = await saveMemberFromFirebaseUser(user);
      void linkAnalyticsIdentity(user);
      state.admin = isAdminEmail(user.email);
      state.authReady = true;
      await loadProtectedMemberContent();
      renderAll();
      await renderAdminDashboard();
    });
  } catch (error) {
    console.error(error);
    state.authReady = true;
    renderAll();
    showToast("Firebase could not load. Check the config and authorized domains.");
  }
}

async function completeEmailLinkSignIn() {
  if (!firebaseApi?.isSignInWithEmailLink(firebaseApi.auth, window.location.href)) return;

  const pending = readJSON(storageKeys.pendingMember, null);
  const email = pending?.email || window.prompt("Confirm your email for GDG Tulsa membership");
  if (!email) return;

  const credential = await firebaseApi.signInWithEmailLink(firebaseApi.auth, email, window.location.href);
  await saveMemberFromFirebaseUser(credential.user, pending);
  removeStored(storageKeys.pendingMember);

  window.history.replaceState({}, document.title, `${window.location.origin}${window.location.pathname}#members`);
  showToast("Email verified. Welcome to GDG Tulsa members.");
}

async function saveMemberFromFirebaseUser(user, pending = null) {
  if (!firebaseApi || !user) return null;
  const email = normalizeEmail(user.email);
  const memberRef = firebaseApi.doc(firebaseApi.db, "members", user.uid);
  const snapshot = await firebaseApi.getDoc(memberRef);
  const existing = snapshot.exists() ? snapshot.data() : {};
  const terms = pending?.termsAcceptedAt || readJSON(storageKeys.pendingGoogleTerms, null);
  const provider = user.providerData?.[0]?.providerId || "emailLink";

  const memberData = {
    uid: user.uid,
    email,
    name: pending?.name || existing.name || user.displayName || email.split("@")[0],
    authProvider: provider,
    confirmed: Boolean(user.emailVerified || provider === "google.com"),
    admin: isAdminEmail(email),
    lastSeenAt: firebaseApi.serverTimestamp()
  };

  if (!snapshot.exists()) {
    memberData.createdAt = firebaseApi.serverTimestamp();
  }
  if (terms && !existing.termsAcceptedAt) {
    memberData.termsAcceptedAt = terms;
  }

  await firebaseApi.setDoc(memberRef, memberData, { merge: true });
  removeStored(storageKeys.pendingGoogleTerms);

  const updated = await firebaseApi.getDoc(memberRef);
  return updated.exists() ? updated.data() : memberData;
}

async function loadProtectedMemberContent() {
  if (!state.currentMember?.confirmed) return;

  if (!state.firebaseOnline) {
    state.resources = starterResources;
    state.events = starterEvents;
    return;
  }

  const resourceSnapshot = await firebaseApi.getDocs(firebaseApi.query(
    firebaseApi.collection(firebaseApi.db, "memberResources"),
    firebaseApi.orderBy("order", "asc")
  ));
  const eventSnapshot = await firebaseApi.getDocs(firebaseApi.query(
    firebaseApi.collection(firebaseApi.db, "memberEvents"),
    firebaseApi.orderBy("order", "asc")
  ));

  state.resources = resourceSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  state.events = eventSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function registerMember(form) {
  const formData = new FormData(form);
  const name = String(formData.get("name") || "").trim();
  const email = normalizeEmail(formData.get("email"));
  const acceptedTerms = formData.get("terms") === "on";

  if (!name || !email || !acceptedTerms) {
    showToast("Name, email, and terms confirmation are required.");
    return;
  }

  if (!firebaseApi) {
    showToast("Firebase is not configured yet, so real email verification cannot send.");
    return;
  }

  const pending = {
    name,
    email,
    termsAcceptedAt: new Date().toISOString()
  };
  writeJSON(storageKeys.pendingMember, pending);
  await withFormStatus(form, "Sending...", async () => {
    await firebaseApi.sendSignInLinkToEmail(firebaseApi.auth, email, emailLinkSettings());
    showConfirmationPanel();
    showToast(`Confirmation email sent to ${email}.`);
  });
}

async function loginMember(form) {
  const formData = new FormData(form);
  const email = normalizeEmail(formData.get("email"));
  if (!email) {
    showToast("Enter your email to receive a secure sign-in link.");
    return;
  }
  if (!firebaseApi) {
    showToast("Firebase is not configured yet, so real sign-in cannot send.");
    return;
  }
  writeJSON(storageKeys.pendingMember, { email });
  await withFormStatus(form, "Sending...", async () => {
    await firebaseApi.sendSignInLinkToEmail(firebaseApi.auth, email, emailLinkSettings());
    showConfirmationPanel();
    showToast(`Secure sign-in link sent to ${email}.`);
  });
}

async function continueWithGoogle({ adminLogin = false } = {}) {
  if (!firebaseApi) {
    showToast("Firebase is not configured yet, so Google sign-in cannot run.");
    return;
  }

  const existingUser = firebaseApi.auth.currentUser;
  const existingAdmin = existingUser && isAdminEmail(existingUser.email);
  const termsAccepted = document.querySelector("[data-auth-form='register'] input[name='terms']")?.checked;

  if (!adminLogin && !existingAdmin && !termsAccepted) {
    switchAuthTab("register");
    openAuth("register");
    showToast("Accept member terms before creating a new Google member account.");
    return;
  }

  if (termsAccepted) {
    writeJSON(storageKeys.pendingGoogleTerms, new Date().toISOString());
  }

  try {
    const credential = await firebaseApi.signInWithPopup(firebaseApi.auth, firebaseApi.googleProvider);
    state.currentMember = await saveMemberFromFirebaseUser(credential.user);
    state.admin = isAdminEmail(credential.user.email);
    closeAuth();
    await loadProtectedMemberContent();
    renderAll();
    await renderAdminDashboard();
    showToast(state.admin ? "Admin signed in with Google." : "Signed in with Google.");
  } catch (error) {
    console.error(error);
    showToast(formatAuthError(error));
  }
}

async function signOutMember() {
  if (firebaseApi?.auth?.currentUser) {
    await firebaseApi.signOut(firebaseApi.auth);
  }
  state.currentMember = null;
  state.admin = false;
  state.resources = [];
  state.events = [];
  state.registeredEvents.clear();
  renderAll();
  showToast("Signed out.");
}

function requireConfirmedMember() {
  if (state.currentMember?.confirmed) return state.currentMember;
  openAuth("register");
  showToast("Confirm a free member account to unlock this.");
  return null;
}

async function registerForEvent(eventName) {
  const member = requireConfirmedMember();
  if (!member) return;
  const uid = member.uid || firebaseApi?.auth?.currentUser?.uid;
  if (!firebaseApi || !uid) {
    showToast("Firebase is not connected yet.");
    return;
  }

  await firebaseApi.addDoc(firebaseApi.collection(firebaseApi.db, "registrations"), {
    uid,
    type: "Event",
    title: eventName,
    name: member.name,
    email: member.email,
    createdAt: firebaseApi.serverTimestamp()
  });
  state.registeredEvents.add(eventName);
  renderMemberFeed();
  showToast(`Registered for ${eventName}.`);
  await renderAdminDashboard();
}

function openScheduler() {
  const member = requireConfirmedMember();
  if (!member || !scheduleModal) return;
  scheduleModal.hidden = false;

  // Emitted only once the scheduler is genuinely open: the guard above returns
  // for an unconfirmed member or a missing modal, so a click that never opens
  // anything is not counted. Carries no member details — tracker.js reads only
  // event_name.
  window.dispatchEvent(new CustomEvent("gdg:analytics", {
    detail: { event_name: "schedule_open" }
  }));

  window.setTimeout(() => scheduleModal.querySelector("select")?.focus(), 60);
}

function closeScheduler() {
  if (scheduleModal) scheduleModal.hidden = true;
}

async function requestScheduleTime(form) {
  const member = requireConfirmedMember();
  if (!member) return;
  const uid = member.uid || firebaseApi?.auth?.currentUser?.uid;
  if (!firebaseApi || !uid) {
    showToast("Firebase is not connected yet.");
    return;
  }

  const formData = new FormData(form);
  const topic = String(formData.get("topic") || "").trim();
  const slot = String(formData.get("slot") || "").trim();
  const notes = String(formData.get("notes") || "").trim();
  if (!topic || !slot) {
    showToast("Choose a topic and preferred slot.");
    return;
  }

  await firebaseApi.addDoc(firebaseApi.collection(firebaseApi.db, "scheduleRequests"), {
    uid,
    type: "Office Hours",
    title: `${topic} - ${slot}`,
    topic,
    slot,
    notes,
    name: member.name,
    email: member.email,
    createdAt: firebaseApi.serverTimestamp()
  });

  // Conversion signal only. Reached solely when the Firestore write above
  // resolves: the earlier guards return on a missing member, missing Firebase
  // or failed validation, and an addDoc rejection propagates rather than
  // falling through to here.
  //
  // Deliberately carries no uid, name, email, topic, slot or notes — tracker.js
  // reads only event_name. Firestore remains the record of the actual request.
  window.dispatchEvent(new CustomEvent("gdg:analytics", {
    detail: { event_name: "schedule_submit" }
  }));

  form.reset();
  closeScheduler();
  showToast("Office-hour request saved.");
  await renderAdminDashboard();
}

function renderMemberSection() {
  const member = state.currentMember;
  const isUnlocked = Boolean(member?.confirmed);

  document.querySelectorAll("[data-member-signout]").forEach((button) => {
    button.hidden = !isUnlocked && !state.admin;
  });
  document.querySelectorAll("[data-admin-only]").forEach((element) => {
    element.hidden = !state.admin;
  });
  document.querySelectorAll("[data-admin-google-login]").forEach((button) => {
    button.hidden = state.admin;
  });
  document.querySelectorAll(".header-member").forEach((button) => {
    button.textContent = isUnlocked ? "Member Portal" : "Member Sign In";
  });

  if (!memberSection) return;
  memberSection.classList.toggle("is-unlocked", isUnlocked);
  memberSection.classList.toggle("is-locked", !isUnlocked);

  // While locked, the feed and action strip are a blurred teaser. CSS already
  // sets pointer-events:none, but that only stops the mouse — without `inert`
  // a keyboard user still tabs through a dozen unreadable "Unlock" buttons and
  // a screen reader still reads out the placeholder cards. The real call to
  // action lives in the unblurred .gated-overlay, so hide the teaser outright.
  [memberFeed, document.querySelector(".member-action-strip")].forEach((el) => {
    if (!el) return;
    el.inert = !isUnlocked;
  });

  const kicker = document.querySelector("[data-member-kicker]");
  const title = document.querySelector("[data-member-title]");
  const copy = document.querySelector("[data-member-copy]");
  const avatar = document.querySelector("[data-member-avatar]");
  const profileName = document.querySelector("[data-member-profile-name]");
  const profileEmail = document.querySelector("[data-member-profile-email]");

  if (isUnlocked) {
    if (kicker) kicker.textContent = "Member portal";
    if (title) title.textContent = `Welcome back, ${member.name}.`;
    if (copy) copy.textContent = "Your member resources, event registrations, office hours, and opportunities are unlocked.";
    if (avatar) avatar.textContent = member.name?.trim().charAt(0).toUpperCase() || "M";
    if (profileName) profileName.textContent = member.name;
    if (profileEmail) profileEmail.textContent = `${member.email} - ${member.authProvider === "google.com" ? "Google sign-in" : "Email verified"}`;
  } else {
    if (kicker) kicker.textContent = firebaseReady ? "Members only" : "Firebase setup needed";
    if (title) title.textContent = "Unlock certifications, accelerator links, job leads, and member events.";
    if (copy) copy.textContent = firebaseReady
      ? "Register with name, email, and member terms, then verify the secure email link to unlock the portal."
      : "Firebase config is not filled in yet. Once configured, this portal will send real email verification links.";
    if (avatar) avatar.textContent = "G";
    if (profileName) profileName.textContent = "Guest member";
    if (profileEmail) profileEmail.textContent = "Sign in to unlock the portal";
  }

  document.querySelectorAll(".member-heading-actions").forEach((actions) => {
    actions.hidden = isUnlocked;
  });
}

function lockedRows() {
  return [
    { category: "Certifications", cards: ["Cloud certification path", "AI portfolio credential", "Firebase launch checklist"] },
    { category: "Accelerators", cards: ["Startup readiness program", "Build with AI showcase", "Mentor roundtable"] },
    { category: "Job Opportunities", cards: ["Google career lead", "Tulsa partner hiring board", "Portfolio review queue"] },
    { category: "Member Events", cards: ["Gemini build night", "Firebase for founders", "Google Cloud career lab"] }
  ];
}

function renderMemberFeed() {
  if (!memberFeed) return;
  if (!state.currentMember?.confirmed) {
    memberFeed.innerHTML = lockedRows().map((row) => `
      <article class="exclusive-row">
        <div class="exclusive-row-title">
          <h3>${escapeHTML(row.category)}</h3>
          <button class="row-link" type="button" data-open-auth="register">Unlock</button>
        </div>
        <div class="exclusive-row-grid">
          ${row.cards.map((title, index) => `
            <article class="member-card ${["green-resource", "yellow-resource", "blue-resource"][index % 3]}">
              <span>Members</span>
              <h4>${escapeHTML(title)}</h4>
              <p>Verified members can view the full details after signing in.</p>
              <button type="button" data-open-auth="register">Unlock</button>
            </article>
          `).join("")}
        </div>
      </article>
    `).join("");
    return;
  }

  const resources = state.firebaseOnline ? state.resources : starterResources;
  const events = state.firebaseOnline ? state.events : starterEvents;
  if (!resources.length && !events.length) {
    memberFeed.innerHTML = `
      <div class="member-empty-state">
        <h3>Member content is ready for Firebase.</h3>
        <p>No Firestore resources have been published yet. Add documents to <code>memberResources</code> and <code>memberEvents</code>, or use the admin seed action.</p>
        ${state.admin ? '<button class="button primary" type="button" data-seed-content>Publish starter content</button>' : ""}
      </div>
    `;
    return;
  }

  const categories = [...new Set(resources.map((item) => item.category))].map((category) => ({
    category,
    cards: resources.filter((item) => item.category === category)
  }));

  if (events.length) {
    categories.push({ category: "Member Events", cards: events.map((event) => ({ ...event, eventCard: true, tag: event.date || "Event", tone: "event-member-card", action: "Register" })) });
  }

  memberFeed.innerHTML = categories.map((row) => `
    <article class="exclusive-row">
      <div class="exclusive-row-title">
        <h3>${escapeHTML(row.category)}</h3>
        <button class="row-link" type="button" data-requires-member="${escapeHTML(row.category)}">See all</button>
      </div>
      <div class="exclusive-row-grid">
        ${row.cards.map((card) => `
          <article class="member-card ${escapeHTML(card.tone || "blue-resource")}">
            <span>${escapeHTML(card.tag || card.date || "Member")}</span>
            <h4>${escapeHTML(card.title)}</h4>
            <p>${escapeHTML(card.body)}</p>
            <button type="button" ${card.eventCard && state.registeredEvents.has(card.title) ? "disabled" : ""} ${card.eventCard ? `data-event-signup="${escapeHTML(card.title)}"` : card.actionType === "schedule" ? "data-open-scheduler" : `data-requires-member="${escapeHTML(card.title)}"`}>${escapeHTML(card.eventCard && state.registeredEvents.has(card.title) ? "Registered" : card.action || "Open")}</button>
          </article>
        `).join("")}
      </div>
    </article>
  `).join("");
}

function setAdminTab(tabName) {
  if (!adminDashboard) return;
  const selected = tabName || "overview";
  document.querySelectorAll("[data-admin-tab]").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.adminTab === selected);
  });
  document.querySelectorAll("[data-admin-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.adminPanel === selected);
  });
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function renderAdminAnalyticsMessage(message) {
  setText("[data-admin-analytics-status]", message);
}

async function renderAdminAnalytics() {
  const funnelTable = document.querySelector("[data-admin-funnel-table]");
  const pagesTable = document.querySelector("[data-admin-pages-table]");
  const sourcesTable = document.querySelector("[data-admin-sources-table]");

  if (!funnelTable || !pagesTable || !sourcesTable) return;

  const user = firebaseApi?.auth?.currentUser;

  if (!user || !state.admin) {
    renderAdminAnalyticsMessage("Admin Google sign-in required.");
    return;
  }

  renderAdminAnalyticsMessage("Loading website analytics...");

  try {
    const token = await user.getIdToken();

    const response = await fetch(ANALYTICS_ADMIN_ENDPOINT, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`
      },
      cache: "no-store"
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload?.error || `Analytics request failed (${response.status})`);
    }

    // The admin may have signed out while the request was in flight.
    // Never repopulate analytics after the authenticated session changes.
    if (firebaseApi?.auth?.currentUser !== user || !state.admin) {
      return;
    }

    const funnel = Array.isArray(payload.funnel) ? payload.funnel : [];
    const pages = Array.isArray(payload.pages) ? payload.pages : [];
    const sources = Array.isArray(payload.sources) ? payload.sources : [];

    funnelTable.innerHTML = funnel.length
      ? funnel.map((row) => `
        <tr>
          <td>${escapeHTML(row.stage)}</td>
          <td>${Number(row.visitors || 0).toLocaleString()}</td>
          <td>${(Number(row.percent_of_visitors || 0) * 100).toFixed(1)}%</td>
        </tr>
      `).join("")
      : '<tr><td colspan="3">No funnel data yet.</td></tr>';

    pagesTable.innerHTML = pages.length
      ? pages.map((row) => `
        <tr>
          <td>${escapeHTML(row.page_path)}</td>
          <td>${Number(row.page_views || 0).toLocaleString()}</td>
          <td>${Number(row.unique_visitors || 0).toLocaleString()}</td>
          <td>${Number(row.sessions || 0).toLocaleString()}</td>
          <td>${Number(row.page_views_per_visitor || 0).toFixed(2)}</td>
        </tr>
      `).join("")
      : '<tr><td colspan="5">No page traffic data yet.</td></tr>';

    sourcesTable.innerHTML = sources.length
      ? sources.map((row) => `
        <tr>
          <td>${escapeHTML(row.source_type)}</td>
          <td>${escapeHTML(row.source)}</td>
          <td>${escapeHTML(row.utm_medium || "—")}</td>
          <td>${escapeHTML(row.utm_campaign || "—")}</td>
          <td>${Number(row.sessions || 0).toLocaleString()}</td>
          <td>${Number(row.unique_visitors || 0).toLocaleString()}</td>
        </tr>
      `).join("")
      : '<tr><td colspan="6">No traffic source data yet.</td></tr>';

    renderAdminAnalyticsMessage("Live BigQuery reporting loaded.");
  } catch (error) {
    renderAdminAnalyticsMessage("Website analytics are temporarily unavailable.");

    funnelTable.innerHTML = '<tr><td colspan="3">Unable to load analytics.</td></tr>';
    pagesTable.innerHTML = '<tr><td colspan="5">Unable to load analytics.</td></tr>';
    sourcesTable.innerHTML = '<tr><td colspan="6">Unable to load analytics.</td></tr>';

    console.warn(
      "Admin analytics load failed.",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}


async function renderAdminDashboard() {
  if (!adminDashboard) return;
  if (!firebaseReady || !firebaseApi) {
    renderAdminMessage("Firebase is not configured yet.");
    return;
  }
  if (!state.admin) {
    renderAdminMessage("Admin Google sign-in required.");
    return;
  }

  void renderAdminAnalytics();

  const [membersSnapshot, registrationsSnapshot, schedulesSnapshot] = await Promise.all([
    firebaseApi.getDocs(firebaseApi.collection(firebaseApi.db, "members")),
    firebaseApi.getDocs(firebaseApi.collection(firebaseApi.db, "registrations")),
    firebaseApi.getDocs(firebaseApi.collection(firebaseApi.db, "scheduleRequests"))
  ]);

  const members = membersSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const registrations = registrationsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const schedules = schedulesSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const allRequests = [...registrations, ...schedules].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

  setText("[data-admin-total-members]", 39 + members.length);
  setText("[data-admin-new-members]", members.length);
  setText("[data-admin-confirmed-members]", members.filter((member) => member.confirmed).length);
  setText("[data-admin-registration-count]", registrations.length);
  setText("[data-admin-ticket-count]", registrations.length);

  const memberTable = document.querySelector("[data-admin-members-table]");
  if (memberTable) {
    memberTable.innerHTML = members.length
      ? members.map((member) => `
        <tr>
          <td>${escapeHTML(member.name)}</td>
          <td>${escapeHTML(member.email)}</td>
          <td><span class="status-pill ${member.confirmed ? "" : "pending"}">${member.confirmed ? "Confirmed" : "Pending"}</span></td>
          <td>${formatDate(member.createdAt)}</td>
          <td>${formatDate(member.termsAcceptedAt)}</td>
        </tr>
      `).join("")
      : "<tr><td colspan='5'>No members registered yet.</td></tr>";
  }

  const registrationsTable = document.querySelector("[data-admin-registrations-table]");
  if (registrationsTable) {
    registrationsTable.innerHTML = allRequests.length
      ? allRequests.map((request) => `
        <tr>
          <td>${escapeHTML(request.name)}</td>
          <td>${escapeHTML(request.email)}</td>
          <td>${escapeHTML(request.title)}</td>
          <td>${escapeHTML(request.type)}</td>
          <td>${formatDate(request.createdAt)}</td>
        </tr>
      `).join("")
      : "<tr><td colspan='5'>No registrations yet.</td></tr>";
  }

  const activityList = document.querySelector("[data-admin-activity-list]");
  if (activityList) {
    const memberActivity = members.map((member) => ({
      createdAt: member.createdAt,
      label: `${member.name} ${member.confirmed ? "confirmed membership" : "started registration"}`
    }));
    const requestActivity = allRequests.map((request) => ({
      createdAt: request.createdAt,
      label: `${request.name} submitted ${String(request.type || "").toLowerCase()}: ${request.title}`
    }));
    const activity = [...memberActivity, ...requestActivity]
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
      .slice(0, 5);

    activityList.innerHTML = activity.length
      ? activity.map((item) => `<li>${escapeHTML(item.label)}<br><small>${formatDate(item.createdAt)}</small></li>`).join("")
      : "<li>No member activity yet.</li>";
  }

  document.querySelectorAll("[data-admin-events-list] article").forEach((card) => {
    const title = card.querySelector("h3")?.textContent || "";
    const count = registrations.filter((registration) => registration.title === title).length;
    let countNode = card.querySelector("small");
    if (!countNode) {
      countNode = document.createElement("small");
      card.append(countNode);
    }
    countNode.textContent = `${count} registrations`;
  });
}

function renderAdminMessage(message) {
  renderAdminAnalyticsMessage(message);

  const funnelTable = document.querySelector("[data-admin-funnel-table]");
  const pagesTable = document.querySelector("[data-admin-pages-table]");
  const sourcesTable = document.querySelector("[data-admin-sources-table]");

  if (funnelTable) {
    funnelTable.innerHTML = `<tr><td colspan="3">${escapeHTML(message)}</td></tr>`;
  }

  if (pagesTable) {
    pagesTable.innerHTML = `<tr><td colspan="5">${escapeHTML(message)}</td></tr>`;
  }

  if (sourcesTable) {
    sourcesTable.innerHTML = `<tr><td colspan="6">${escapeHTML(message)}</td></tr>`;
  }

  setText("[data-admin-total-members]", "0");
  setText("[data-admin-new-members]", "0");
  setText("[data-admin-confirmed-members]", "0");
  setText("[data-admin-registration-count]", "0");
  setText("[data-admin-ticket-count]", "0");
  const memberTable = document.querySelector("[data-admin-members-table]");
  const registrationsTable = document.querySelector("[data-admin-registrations-table]");
  const activityList = document.querySelector("[data-admin-activity-list]");
  if (memberTable) memberTable.innerHTML = `<tr><td colspan="5">${escapeHTML(message)}</td></tr>`;
  if (registrationsTable) registrationsTable.innerHTML = `<tr><td colspan="5">${escapeHTML(message)}</td></tr>`;
  if (activityList) activityList.innerHTML = `<li>${escapeHTML(message)}</li>`;
}

async function seedStarterContent() {
  if (!firebaseApi || !state.admin) {
    showToast("Admin sign-in is required to publish starter content.");
    return;
  }
  await Promise.all(starterResources.map((resource) => firebaseApi.setDoc(
    firebaseApi.doc(firebaseApi.db, "memberResources", slug(resource.title)),
    resource,
    { merge: true }
  )));
  await Promise.all(starterEvents.map((event) => firebaseApi.setDoc(
    firebaseApi.doc(firebaseApi.db, "memberEvents", slug(event.title)),
    event,
    { merge: true }
  )));
  await loadProtectedMemberContent();
  renderAll();
  showToast("Starter member content published.");
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function exportCSV(type) {
  showToast(`Use the Firebase Console export for ${type} once Firestore is live.`);
}

function renderAll() {
  renderMemberSection();
  renderMemberFeed();
}

// Scroll bookkeeping used to measure the document on every scroll event and
// interleave those reads with style writes, forcing a synchronous reflow each
// time. Geometry is now measured once and refreshed only when the layout
// actually changes, so the scroll path is pure arithmetic.
let scrollMax = 0;
let sectionOffsets = [];
let scrollMetricsStale = true;
let scrollFrame = 0;

function refreshScrollMetrics() {
  const scrollY = window.scrollY;
  scrollMax = document.documentElement.scrollHeight - window.innerHeight;
  // Store document-absolute tops so the active section can be resolved from
  // scrollY alone, with no per-scroll getBoundingClientRect().
  sectionOffsets = sections.map((section) => ({
    id: section.id,
    top: section.getBoundingClientRect().top + scrollY,
  }));
  scrollMetricsStale = false;
}

function updateScrollState() {
  if (scrollMetricsStale) refreshScrollMetrics();

  const scrollY = window.scrollY;
  const progress = scrollMax > 0 ? scrollY / scrollMax : 0;
  let active;
  const trackSections = navLinks.length > 0 && scrollY >= 120;
  if (trackSections) {
    let closest = Infinity;
    for (const section of sectionOffsets) {
      const distance = Math.abs(section.top - scrollY - 120);
      if (distance < closest) {
        closest = distance;
        active = section.id;
      }
    }
  }

  // Every write happens after every read, so nothing forces layout twice.
  if (meter) meter.style.transform = `scaleX(${progress})`;
  if (!navLinks.length) return;
  if (!trackSections) {
    navLinks.forEach((link) => link.classList.remove("is-active"));
    return;
  }
  navLinks.forEach((link) => {
    link.classList.toggle("is-active", link.getAttribute("href") === `#${active}`);
  });
}

function requestScrollUpdate() {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    updateScrollState();
  });
}

function invalidateScrollMetrics() {
  scrollMetricsStale = true;
  requestScrollUpdate();
}

document.addEventListener("click", async (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const openAuthTarget = target.closest("[data-open-auth]");
  if (openAuthTarget) {
    if (state.currentMember?.confirmed && openAuthTarget.classList.contains("header-member")) {
      memberSection?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    openAuth(openAuthTarget.dataset.openAuth || "register");
  }

  if (target.closest("[data-close-auth]")) closeAuth();
  const authTab = target.closest("[data-auth-tab]");
  if (authTab) switchAuthTab(authTab.dataset.authTab);
  if (target.closest("[data-google-login]")) await continueWithGoogle();
  if (target.closest("[data-admin-google-login]")) await continueWithGoogle({ adminLogin: true });
  if (target.closest("[data-member-signout]")) await signOutMember();

  const memberResource = target.closest("[data-requires-member]");
  if (memberResource) {
    const member = requireConfirmedMember();
    if (member) showToast(`${memberResource.dataset.requiresMember} opened.`);
  }

  const eventSignup = target.closest("[data-event-signup]");
  if (eventSignup) await registerForEvent(eventSignup.dataset.eventSignup);
  if (target.closest("[data-open-scheduler]")) openScheduler();
  if (target.closest("[data-close-scheduler]")) closeScheduler();
  if (target.closest("[data-seed-content]")) await seedStarterContent();

  const adminTab = target.closest("[data-admin-tab]");
  if (adminTab) setAdminTab(adminTab.dataset.adminTab);
  const exportButton = target.closest("[data-admin-export]");
  if (exportButton) exportCSV(exportButton.dataset.adminExport);
});


document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.matches("[data-auth-form='register']")) {
    event.preventDefault();
    await registerMember(form);
  }
  if (form.matches("[data-auth-form='login']")) {
    event.preventDefault();
    await loginMember(form);
  }
  if (form.matches("[data-schedule-form]")) {
    event.preventDefault();
    await requestScheduleTime(form);
  }
});

document.querySelectorAll(".event-card, .hero-art, .learn-card, .join-point").forEach((card) => {
  card.addEventListener("pointermove", (event) => {
    const rect = card.getBoundingClientRect();
    card.style.setProperty("--tilt-x", `${((event.clientY - rect.top) / rect.height - 0.5) * -4}deg`);
    card.style.setProperty("--tilt-y", `${((event.clientX - rect.left) / rect.width - 0.5) * 4}deg`);
  });
  card.addEventListener("pointerleave", () => {
    card.style.setProperty("--tilt-x", "0deg");
    card.style.setProperty("--tilt-y", "0deg");
  });
});

window.addEventListener("scroll", requestScrollUpdate, { passive: true });
window.addEventListener("resize", invalidateScrollMetrics);
// The globe, the event list and the member feed all render after this point
// and change the page height, so remeasure whenever the layout settles rather
// than trusting a single startup measurement.
if ("ResizeObserver" in window) {
  new ResizeObserver(invalidateScrollMetrics).observe(document.body);
}
renderAll();
invalidateScrollMetrics();

// Workspace-style product row: click an icon to open its detail card
const productCard = document.querySelector("[data-product-card]");
if (productCard) {
  const cardIcon = productCard.querySelector("[data-product-card-icon]");
  const cardName = productCard.querySelector("[data-product-card-name]");
  const cardDesc = productCard.querySelector("[data-product-card-desc]");
  const cardLink = productCard.querySelector("[data-product-card-link]");
  document.querySelectorAll("[data-product]").forEach((item) => {
    item.addEventListener("click", () => {
      const isSame = !productCard.hidden && cardName.textContent === item.dataset.name;
      if (isSame) {
        productCard.hidden = true;
        item.classList.remove("is-active");
        return;
      }
      document.querySelectorAll("[data-product]").forEach((b) => b.classList.remove("is-active"));
      item.classList.add("is-active");
      cardIcon.src = item.dataset.icon;
      cardName.textContent = item.dataset.name;
      cardDesc.textContent = item.dataset.desc;
      cardLink.href = item.dataset.link;
      productCard.hidden = false;
    });
  });
}

// Animated-tile readiness: module scripts run after DOM parse, so the
// entrance transition starts on the first frame after styles resolve
requestAnimationFrame(() => document.body.classList.add("ready"));

// Ambient video: play only in viewport; honor prefers-reduced-motion
const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
document.querySelectorAll("video[loop]").forEach((video) => {
  if (reduceMotionQuery.matches) {
    video.pause();
    video.removeAttribute("autoplay");
    return;
  }
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) void video.play().catch(() => {});
        else video.pause();
      });
    }, { threshold: 0.1 });
    observer.observe(video);
  }
});

// The Firebase SDK is ~275KB of third-party JavaScript plus an auth iframe,
// and nothing above the fold needs it. It now loads only when someone
// actually touches the member portal — or straight away for people who have
// signed in before, so their session is restored without a click.
let firebaseSetupStarted = false;

function scheduleFirebaseSetup() {
  if (firebaseSetupStarted) return;
  firebaseSetupStarted = true;
  void setupFirebase();
}

// Cheap pre-check for a Firebase email-link landing, used to decide whether the
// SDK must load before any interaction. Firebase's own isSignInWithEmailLink()
// remains the authority inside completeEmailLinkSignIn(); this only inspects the
// query string and never reads, stores or logs oobCode.
function isEmailLinkCallback() {
  const params = new URLSearchParams(window.location.search);
  return params.get("mode") === "signIn" && params.has("oobCode");
}

(function initFirebaseTriggers() {
  const isPortalPage = Boolean(adminDashboard);
  const returning = readJSON(storageKeys.hasSignedIn, false);
  const emailLinkCallback = isEmailLinkCallback();

  // A first-time visitor returning from the verification email has
  // hasSignedIn = false and touches no member UI, so the intent listeners below
  // would never fire and completeEmailLinkSignIn() would never run. Load
  // immediately rather than via requestIdleCallback: sign-in has to complete
  // before the visitor navigates away.
  if (emailLinkCallback) {
    scheduleFirebaseSetup();
    return;
  }

  if (isPortalPage || returning) {
    if ("requestIdleCallback" in window) window.requestIdleCallback(scheduleFirebaseSetup, { timeout: 2200 });
    else window.setTimeout(scheduleFirebaseSetup, 0);
    return;
  }

  // Otherwise wait for intent. Capture phase so the SDK starts loading before
  // the click handlers that need it run.
  const wake = (event) => {
    if (!event.target?.closest?.("[data-open-auth], [data-member-signout], [data-open-scheduler], [data-admin-tab]")) return;
    scheduleFirebaseSetup();
  };
  document.addEventListener("pointerdown", wake, true);
  document.addEventListener("focusin", wake, true);
  document.addEventListener("click", wake, true);
})();
