// Organizer page: Google Developer Program badge wall.
//
// Badge artwork is NOT in the repo. To add a real badge image, save it as
//   assets/badges/program/<slug>.png
// (slug is the `s` field below) and add that slug to WITH_ART. Anything not
// listed renders the neutral GDG placeholder tile instead, so we never fire
// a request for a file we know is missing.
(function () {
  var WITH_ART = [];

  var BADGES = [
    {"n": "Google Developer Group discovery", "d": "Aug 17, 2025", "s": "google-developer-group-discovery"},
    {"n": "Google Cloud Innovator", "d": "Mar 25, 2024", "s": "google-cloud-innovator"},
    {"n": "Attendee I/O '23", "d": "Mar 31, 2023", "s": "attendee-i-o-23"},
    {"n": "Joined the Google Developer Program", "d": "Mar 16, 2022", "s": "joined-the-google-developer-program"},
    {"n": "Learning", "d": "Aug 16, 2026", "s": "learning", "c": 24},
    {"n": "Sunnyvale Cloud Engineer's AI Toolkit", "d": "Aug 16, 2026", "s": "sunnyvale-cloud-engineer-s-ai-toolkit"},
    {"n": "App Actions with Google Assistant", "d": "Aug 16, 2026", "s": "app-actions-with-google-assistant"},
    {"n": "AI for Science World Models Hack", "d": "Jul 31, 2026", "s": "ai-for-science-world-models-hack"},
    {"n": "Track 1: Business Builder #BuildwithGemini", "d": "Jul 31, 2026", "s": "track-1-business-builder-buildwithgemini"},
    {"n": "Track 2: Platform IT Developer #BuildwithGemini", "d": "Jul 31, 2026", "s": "track-2-platform-it-developer-buildwithgemini"},
    {"n": "Track 3: Software Developer / App Builder #BuildwithGemini", "d": "Jul 31, 2026", "s": "track-3-software-developer-app-builder-buildwithgemini"},
    {"n": "GEAR Intro to Agents", "d": "Jul 30, 2026", "s": "gear-intro-to-agents"},
    {"n": "GDG Events", "d": "Jul 22, 2026", "s": "gdg-events", "c": 8},
    {"n": "Starting Builder Journey", "d": "Jul 15, 2026", "s": "starting-builder-journey"},
    {"n": "Trainer - Build with AI 2026", "d": "Jul 2, 2026", "s": "trainer-build-with-ai-2026"},
    {"n": "Organizer - Build with AI 2026", "d": "Jul 2, 2026", "s": "organizer-build-with-ai-2026"},
    {"n": "Launched the code for the AIventure app solution", "d": "Jun 26, 2026", "s": "launched-the-code-for-the-aiventure-app-solution"},
    {"n": "Completed AIventure app solution", "d": "Jun 26, 2026", "s": "completed-aiventure-app-solution"},
    {"n": "Started the AIventure app solution", "d": "Jun 26, 2026", "s": "started-the-aiventure-app-solution"},
    {"n": "Completed Race Condition solution", "d": "Jun 14, 2026", "s": "completed-race-condition-solution"},
    {"n": "Started the Race Condition solution", "d": "Jun 14, 2026", "s": "started-the-race-condition-solution"},
    {"n": "GDG Baltimore Member", "d": "Jun 10, 2026", "s": "gdg-baltimore-member"},
    {"n": "Austin Cloud Engineer's AI Toolkit", "d": "Jun 2, 2026", "s": "austin-cloud-engineer-s-ai-toolkit"},
    {"n": "Developer Explorer", "d": "May 20, 2026", "s": "developer-explorer", "c": 21},
    {"n": "GDG NYC Member", "d": "May 19, 2026", "s": "gdg-nyc-member"},
    {"n": "Next '26 Attendee", "d": "Apr 22, 2026", "s": "next-26-attendee"},
    {"n": "Get Started with Google Maps Platform Series Badge", "d": "Apr 18, 2026", "s": "get-started-with-google-maps-platform-series-badge"},
    {"n": "Get started with Google Maps Platform - web", "d": "Apr 18, 2026", "s": "get-started-with-google-maps-platform-web"},
    {"n": "Google Developer Community Online Member", "d": "Apr 13, 2026", "s": "google-developer-community-online-member"},
    {"n": "Code Whisperer", "d": "Apr 4, 2026", "s": "code-whisperer"},
    {"n": "Attendee - Build with AI 2026", "d": "Mar 30, 2026", "s": "attendee-build-with-ai-2026"},
    {"n": "AI Learning Lab", "d": "Mar 29, 2026", "s": "ai-learning-lab"},
    {"n": "Wednesday Build Hour Attendee", "d": "Mar 24, 2026", "s": "wednesday-build-hour-attendee"},
    {"n": "GDG on Campus Oregon State University - Corvallis, United States Member", "d": "Mar 24, 2026", "s": "gdg-on-campus-oregon-state-university-corvallis-united-states-member"},
    {"n": "Google Developer Group organizer", "d": "Mar 19, 2026", "s": "google-developer-group-organizer"},
    {"n": "AI Explorer", "d": "Mar 14, 2026", "s": "ai-explorer"},
    {"n": "Firebase Studio Developer Community", "d": "Feb 23, 2026", "s": "firebase-studio-developer-community"},
    {"n": "I/O 2026 - Registered", "d": "Feb 23, 2026", "s": "i-o-2026-registered"},
    {"n": "Speed Up Data Analytics with GPUs", "d": "Feb 20, 2026", "s": "speed-up-data-analytics-with-gpus"},
    {"n": "Intro to Inference: How to Run AI Models on a GPU", "d": "Feb 20, 2026", "s": "intro-to-inference-how-to-run-ai-models-on-a-gpu"},
    {"n": "Deploy Faster Generative AI models with NVIDIA NIM on GKE", "d": "Feb 20, 2026", "s": "deploy-faster-generative-ai-models-with-nvidia-nim-on-gke"},
    {"n": "First Learning Pathway and Quiz badge", "d": "Feb 20, 2026", "s": "first-learning-pathway-and-quiz-badge"},
    {"n": "Completed Agentic Barista app solution", "d": "Feb 10, 2026", "s": "completed-agentic-barista-app-solution"},
    {"n": "Started the Agentic Barista app solution.", "d": "Feb 10, 2026", "s": "started-the-agentic-barista-app-solution"},
    {"n": "Get Certified application", "d": "Feb 10, 2026", "s": "get-certified-application"},
    {"n": "Gemini Enterprise Agent Ready", "d": "Feb 10, 2026", "s": "gemini-enterprise-agent-ready"},
    {"n": "Google Developer Program premium tier", "d": "Feb 7, 2026", "s": "google-developer-program-premium-tier"},
    {"n": "GDG on Campus The University of Oklahoma - Norman, United States Member", "d": "Jan 19, 2026", "s": "gdg-on-campus-the-university-of-oklahoma-norman-united-states-member"},
    {"n": "Chrome DevTools User", "d": "Dec 28, 2025", "s": "chrome-devtools-user"},
    {"n": "Looker forums user", "d": "Nov 11, 2025", "s": "looker-forums-user"},
    {"n": "Cloud forums user", "d": "Nov 11, 2025", "s": "cloud-forums-user"},
    {"n": "AppSheet forums user", "d": "Nov 11, 2025", "s": "appsheet-forums-user"},
    {"n": "Workspace forums user", "d": "Nov 11, 2025", "s": "workspace-forums-user"},
    {"n": "GDG Wichita Member", "d": "Oct 23, 2025", "s": "gdg-wichita-member"},
    {"n": "GDG Cloud Southlake Member", "d": "Oct 23, 2025", "s": "gdg-cloud-southlake-member"},
    {"n": "GDG Cloud Hanoi Member", "d": "Oct 23, 2025", "s": "gdg-cloud-hanoi-member"},
    {"n": "Google Developer Group on Campus member", "d": "Oct 23, 2025", "s": "google-developer-group-on-campus-member"},
    {"n": "GDG Oklahoma City Member", "d": "Oct 23, 2025", "s": "gdg-oklahoma-city-member"},
    {"n": "GDG Cloud Fremont Member", "d": "Oct 23, 2025", "s": "gdg-cloud-fremont-member"},
    {"n": "Google Developer Group member", "d": "Oct 23, 2025", "s": "google-developer-group-member"},
    {"n": "GDG Dallas Member", "d": "Oct 23, 2025", "s": "gdg-dallas-member"},
    {"n": "GDG Austin Member", "d": "Oct 23, 2025", "s": "gdg-austin-member"},
    {"n": "GDG Fremont Member", "d": "Oct 23, 2025", "s": "gdg-fremont-member"},
    {"n": "GDG on Campus The University of Texas at Dallas - Richardson, United States Member", "d": "Oct 23, 2025", "s": "gdg-on-campus-the-university-of-texas-at-dallas-richardson-united-states-member"},
    {"n": "Attendee - Build with AI 2025", "d": "Sep 2, 2025", "s": "attendee-build-with-ai-2025"},
    {"n": "Google Home Developer Challenge 2025 - Participant", "d": "Aug 25, 2025", "s": "google-home-developer-challenge-2025-participant"},
    {"n": "Google Maps Platform Innovators", "d": "Jul 31, 2025", "s": "google-maps-platform-innovators"},
    {"n": "Google Cloud & NVIDIA community member", "d": "Jul 17, 2025", "s": "google-cloud-nvidia-community-member"},
    {"n": "Google Skills", "d": "Jun 5, 2025", "s": "google-skills"},
    {"n": "Code Wiki", "d": "May 20, 2025", "s": "code-wiki"},
    {"n": "Google Developer Experts follower", "d": "May 20, 2025", "s": "google-developer-experts-follower"},
    {"n": "I/O 2025 - Registered", "d": "May 6, 2025", "s": "i-o-2025-registered"}
  ];

  var TONES = ['tone-blue', 'tone-green', 'tone-yellow', 'tone-red'];
  var INITIAL = 8;

  var grid = document.getElementById('pb-grid');
  if (!grid) return;

  var expandBtn = document.querySelector('[data-badge-expand]');
  var countEl = document.querySelector('[data-badge-count]');
  var expanded = false;

  if (countEl) countEl.textContent = String(BADGES.length);

  function artFor(b) {
    if (WITH_ART.indexOf(b.s) !== -1) {
      return '<img class="pb-art" src="assets/badges/program/' + b.s + '.png" alt="" width="96" height="96" loading="lazy">';
    }
    return '<span class="pb-art pb-art--placeholder" aria-hidden="true">' +
           '<img src="assets/logos/gdg-icon.png" alt="" width="44" height="44" loading="lazy"></span>';
  }

  function cardHTML(b, i) {
    var tone = TONES[i % TONES.length];
    var count = b.c ? '<span class="pb-count-chip">' + b.c + '</span>' : '';
    return '<button class="pb-card" type="button" data-badge-open="' + i + '">' +
             '<span class="pb-card-art ' + tone + '">' + artFor(b) + count + '</span>' +
             '<span class="pb-card-body">' +
               '<span class="pb-card-name">' + b.n + '</span>' +
               '<span class="pb-card-date">' + b.d + '</span>' +
             '</span>' +
           '</button>';
  }

  function render() {
    var list = expanded ? BADGES : BADGES.slice(0, INITIAL);
    grid.innerHTML = list.map(cardHTML).join('');
    if (expandBtn) {
      expandBtn.textContent = expanded
        ? 'Show fewer'
        : 'Expand to see all ' + BADGES.length;
      expandBtn.setAttribute('aria-expanded', String(expanded));
    }
  }

  if (expandBtn) {
    expandBtn.addEventListener('click', function () {
      expanded = !expanded;
      render();
      if (!expanded) grid.scrollIntoView({ block: 'start' });
    });
  }

  // ── Modal ──────────────────────────────────────────────────────────────
  var modal = document.querySelector('[data-badge-modal]');
  var mArt = document.querySelector('[data-badge-modal-art]');
  var mTitle = document.querySelector('[data-badge-modal-title]');
  var mDate = document.querySelector('[data-badge-modal-date]');
  var lastFocused = null;

  function openModal(i) {
    var b = BADGES[i];
    if (!b || !modal) return;
    lastFocused = document.activeElement;
    mArt.className = 'pb-modal-art ' + TONES[i % TONES.length];
    mArt.innerHTML = artFor(b) +
      (b.c ? '<span class="pb-count-chip">' + b.c + '</span>' : '');
    mTitle.textContent = b.n;
    mDate.textContent = b.c ? b.d + ' · ' + b.c + ' earned' : b.d;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    var closeBtn = modal.querySelector('[data-badge-close]');
    if (closeBtn) closeBtn.focus();
  }

  function closeModal() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.style.overflow = '';
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  grid.addEventListener('click', function (e) {
    var card = e.target.closest('[data-badge-open]');
    if (card) openModal(Number(card.getAttribute('data-badge-open')));
  });

  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.closest('[data-badge-close]')) closeModal();
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModal();
  });

  render();
})();
