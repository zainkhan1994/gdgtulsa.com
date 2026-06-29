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
