const tracks = {
  ai: {
    tag: "Hands-on lab",
    title: "Prompt-to-prototype night",
    detail: "Use Google AI Studio and Gemini APIs to turn a local Tulsa problem into a small working prototype."
  },
  gemini: {
    tag: "Gemini",
    title: "Build a multimodal assistant",
    detail: "Bring text, images, and live demos together so members can learn what Gemini can do in real workflows."
  },
  firebase: {
    tag: "Firebase",
    title: "Launch a useful app in one evening",
    detail: "Pair Firebase Auth, Firestore, and Hosting to ship a simple community tool from idea to URL."
  },
  cloud: {
    tag: "Cloud",
    title: "Cloud foundations for builders",
    detail: "Demystify deploys, storage, functions, and logs with practical patterns that local teams can reuse."
  },
  web: {
    tag: "Web",
    title: "Modern web build clinic",
    detail: "Review performance, accessibility, responsive UI, and clean deployment workflows for real member projects."
  },
  android: {
    tag: "Android",
    title: "Android and AI on-device",
    detail: "Explore app patterns, device capabilities, and AI-assisted product ideas for the mobile-first crowd."
  },
  maps: {
    tag: "Maps",
    title: "Tulsa mapped with Google Maps Platform",
    detail: "Prototype location-aware tools for meetups, community resources, routes, venues, and local discovery."
  },
  startup: {
    tag: "Startup",
    title: "Founder build desk",
    detail: "Help early teams sharpen demos, pick tooling, and leave with a practical next sprint."
  }
};

const meter = document.querySelector(".scroll-meter");
const toast = document.querySelector(".toast");
const navLinks = [...document.querySelectorAll("nav a")];
const sections = navLinks.map((link) => document.querySelector(link.getAttribute("href"))).filter(Boolean);

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.setTimeout(() => toast.classList.remove("is-visible"), 1800);
}

function updateScrollState() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const progress = max > 0 ? window.scrollY / max : 0;
  meter.style.transform = `scaleX(${progress})`;

  const active = sections
    .map((section) => ({ section, top: Math.abs(section.getBoundingClientRect().top - 120) }))
    .sort((a, b) => a.top - b.top)[0]?.section.id;

  navLinks.forEach((link) => {
    link.classList.toggle("is-active", link.getAttribute("href") === `#${active}`);
  });
}

document.addEventListener("click", async (event) => {
  const copyTarget = event.target.closest("[data-copy]");
  if (copyTarget) {
    await navigator.clipboard.writeText(copyTarget.dataset.copy);
    showToast(`Copied ${copyTarget.dataset.copy}`);
  }

  const jumpTarget = event.target.closest("[data-jump]");
  if (jumpTarget) {
    document.querySelector(jumpTarget.dataset.jump)?.scrollIntoView({ behavior: "smooth" });
  }
});

document.querySelectorAll(".filter-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".filter-button").forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    const filter = button.dataset.filter;
    document.querySelectorAll(".event-card").forEach((card) => {
      const visible = filter === "all" || card.dataset.tags.includes(filter);
      card.classList.toggle("is-hidden", !visible);
    });
  });
});

document.querySelectorAll(".topic-chip").forEach((button) => {
  button.addEventListener("click", () => {
    const track = tracks[button.dataset.track];
    document.querySelectorAll(".topic-chip").forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    document.querySelector("#lab-tag").textContent = track.tag;
    document.querySelector("#lab-title").textContent = track.title;
    document.querySelector("#lab-detail").textContent = track.detail;
    document.querySelector("#lab-copy").textContent = "That track is queued up. Bring an idea, a laptop, and a little curiosity.";
  });
});

document.querySelectorAll(".event-card, .hero-art").forEach((card) => {
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
updateScrollState();
