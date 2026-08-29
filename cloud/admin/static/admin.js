import { firebaseConfig } from "./firebase-config.js";

const FIREBASE_SDK_VERSION = "10.12.5";

const loginButton = document.querySelector("[data-google-login]");
const signOutButton = document.querySelector("[data-admin-signout]");
const status = document.querySelector("[data-auth-status]");

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

    // The Firebase credential is needed only long enough to establish the
    // server-side admin session. Do not persist it in this admin application.
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

    // The server session is now the authentication authority.
    // Do not keep the Firebase login alive in browser persistence.
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

loginButton?.addEventListener("click", loginWithGoogle);
signOutButton?.addEventListener("click", logout);
