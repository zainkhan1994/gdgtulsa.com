import { adminEmails, firebaseConfig, firebaseReady } from "./firebase-config.js";

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

const storageKeys = {
  pendingMember: "gdgTulsaPendingMember",
  pendingGoogleTerms: "gdgTulsaPendingGoogleTerms",
  previewMembers: "gdgTulsaPreviewMembers",
  previewCurrentMember: "gdgTulsaPreviewCurrentMember",
  previewRegistrations: "gdgTulsaPreviewRegistrations",
  previewSchedules: "gdgTulsaPreviewScheduleRequests"
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
        renderAll();
        return;
      }

      state.currentMember = await saveMemberFromFirebaseUser(user);
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

function updateScrollState() {
  if (meter) {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const progress = max > 0 ? window.scrollY / max : 0;
    meter.style.transform = `scaleX(${progress})`;
  }
  if (!navLinks.length) return;
  if (window.scrollY < 120) {
    navLinks.forEach((link) => link.classList.remove("is-active"));
    return;
  }
  const active = sections
    .map((section) => ({ section, top: Math.abs(section.getBoundingClientRect().top - 120) }))
    .sort((a, b) => a.top - b.top)[0]?.section.id;
  navLinks.forEach((link) => {
    link.classList.toggle("is-active", link.getAttribute("href") === `#${active}`);
  });
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

  const eventCategory = target.closest("[data-event-category]");
  if (eventCategory) {
    const category = eventCategory.dataset.eventCategory;
    document.querySelectorAll("[data-event-category]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.eventCategory === category);
    });
    document.querySelectorAll("[data-event-card]").forEach((card) => {
      card.classList.toggle("is-active", card.dataset.eventCard === category);
    });
    document.querySelectorAll("[data-event-detail]").forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.eventDetail === category);
    });
  }

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

window.addEventListener("scroll", updateScrollState, { passive: true });
window.addEventListener("resize", updateScrollState);
renderAll();
updateScrollState();
void setupFirebase();
