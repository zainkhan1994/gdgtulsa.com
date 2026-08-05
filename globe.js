(() => {
  const explorer = document.querySelector("[data-community-explorer]");
  if (!explorer) return;

  const TULSA_CENTER = [-95.9927516, 36.1563122];
  const EVENT_SOURCE_URL = "data/gdg-events.geojson?v=20260805-interactive-globe";
  const COUNTRY_SOURCE_URL = "data/world-countries.geojson?v=20260805-interactive-globe";
  const OFFICIAL_EVENTS_URL = "https://gdg.community.dev/events/";
  const DAY_MS = 24 * 60 * 60 * 1000;
  const RECENT_WINDOW_MS = 90 * DAY_MS;
  const AUTO_ROTATION_DEGREES_PER_SECOND = 1.6;
  const AUTO_ROTATION_INTERVAL_MS = 32;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const elements = {
    map: document.querySelector("#community-globe"),
    frame: document.querySelector("[data-globe-frame]"),
    uiFrame: document.querySelector("[data-globe-ui-frame]"),
    panel: document.querySelector("[data-event-panel]"),
    loading: document.querySelector("[data-globe-loading]"),
    list: document.querySelector("#event-list"),
    search: document.querySelector("#event-search"),
    status: document.querySelector("#event-status"),
    selected: document.querySelector("#selected-event"),
    snapshotNote: document.querySelector("[data-event-snapshot-note]"),
    filters: [...document.querySelectorAll("[data-event-filter]")],
    controls: [...document.querySelectorAll("[data-globe-action]")],
  };

  const state = {
    allEvents: [],
    events: [],
    filtered: [],
    filter: "all",
    search: "",
    selectedId: null,
    map: null,
    mapReady: false,
    mapVisible: true,
    mapInitialized: false,
    manualPaused: false,
    rotationFrame: null,
    lastRotationAt: 0,
    orbitHoldTimer: null,
    orbitHoldFrame: null,
    orbitHoldDirection: 0,
    lastOrbitHoldAt: 0,
    suppressOrbitClick: false,
    mode: "upcoming",
    focused: false,
  };

  const categoryLabels = {
    local: "Tulsa event",
    "build-with-ai": "Build with AI",
    devfest: "DevFest",
    workshop: "Workshop",
  };

  function formatDate(properties) {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: properties.timeZone,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(new Date(properties.startsAt));
    } catch {
      return properties.startsAt;
    }
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function renderList() {
    elements.list.replaceChildren();

    if (!state.filtered.length) {
      const message = state.events.length
        ? "No events match that search. Try another city or browse the official global catalog."
        : "This verified snapshot has no current or recent events. The official GDG catalog is always available.";
      const empty = createElement("li", "empty-results", message);
      elements.list.append(empty);
      elements.status.textContent = state.events.length ? "No matching events" : "No current snapshot events";
      renderMapData();
      return;
    }

    const fragment = document.createDocumentFragment();

    for (const feature of state.filtered) {
      const properties = feature.properties;
      const item = createElement("li", "event-result-item");
      item.dataset.eventId = properties.id;
      item.classList.toggle("is-selected", properties.id === state.selectedId);

      const button = createElement("button", "event-result");
      button.type = "button";
      button.setAttribute("aria-pressed", String(properties.id === state.selectedId));
      button.append(
        createElement("time", "event-result-date", formatDate(properties)),
        createElement("span", "event-result-title", properties.title),
        createElement("span", "event-result-location", `${properties.city}, ${properties.country}`),
      );
      button.firstElementChild.dateTime = properties.startsAt;
      button.addEventListener("click", () => selectEvent(properties.id, { moveMap: true }));

      const link = createElement("a", "event-result-link", "↗");
      link.href = properties.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute("aria-label", `Open official details for ${properties.title}`);

      item.append(button, link);
      fragment.append(item);
    }

    elements.list.append(fragment);
    const stateLabel = state.mode === "recent" ? "recent event" : "verified upcoming event";
    elements.status.textContent = `${state.filtered.length} ${stateLabel}${state.filtered.length === 1 ? "" : "s"}`;
    renderMapData();
  }

  function renderSelected(feature) {
    if (!feature) {
      const kicker = createElement("p", "card-kicker", "Keep exploring");
      const title = createElement("h3", "", "Find the next GDG event");
      const copy = createElement("p", "", "When this list has no current events, use the official GDG catalog.");
      const link = createElement("a", "", "Browse official GDG events ↗");
      link.href = OFFICIAL_EVENTS_URL;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      elements.selected.replaceChildren(kicker, title, copy, link);
      elements.selected.style.setProperty("--selected-color", "#4285f4");
      return;
    }
    const properties = feature.properties;
    const kickerLabel = state.mode === "recent" ? `Recent ${categoryLabels[properties.category] || "GDG event"}` : categoryLabels[properties.category] || "GDG event";
    const kicker = createElement("p", "card-kicker", kickerLabel);
    const title = createElement("h3", "", properties.title);
    const meta = createElement("p", "selected-event-meta");
    const time = createElement("time", "", formatDate(properties));
    time.dateTime = properties.startsAt;
    const chapter = createElement("span", "", properties.chapterName);
    meta.append(time, chapter);
    const location = createElement("p", "", `${properties.mode} · ${properties.location}`);
    const link = createElement("a", "", state.mode === "recent" ? "View the event archive ↗" : "Open official event details ↗");
    link.href = properties.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    elements.selected.replaceChildren(kicker, title, meta, location, link);
    elements.selected.style.setProperty("--selected-color", colorForCategory(properties.category));
  }

  function colorForCategory(category) {
    return {
      local: "#ea4335",
      "build-with-ai": "#f9ab00",
      devfest: "#4285f4",
      workshop: "#34a853",
    }[category] || "#8ab4f8";
  }

  function selectEvent(id, { moveMap = false, scrollList = false } = {}) {
    const feature = state.events.find((event) => event.properties.id === id);
    if (!feature) return;

    state.selectedId = id;
    renderSelected(feature);

    for (const item of elements.list.querySelectorAll("[data-event-id]")) {
      const selected = item.dataset.eventId === id;
      item.classList.toggle("is-selected", selected);
      item.querySelector("button")?.setAttribute("aria-pressed", String(selected));
      if (selected && scrollList) item.scrollIntoView({ block: "nearest" });
    }

    if (!state.mapReady) return;
    state.map.setFilter("selected-event-halo", ["==", ["get", "id"], id]);

    if (moveMap) {
      pauseRotation();
      setFocused(true);
      const [longitude, latitude] = feature.geometry.coordinates;
      state.map.easeTo({
        center: [longitude, latitude],
        zoom: Math.max(state.map.getZoom(), 3.05),
        padding: cameraPadding(),
        duration: reducedMotion.matches ? 0 : 520,
        easing: (value) => 1 - Math.pow(1 - value, 3),
      });
    }
  }

  function setFocused(focused) {
    state.focused = focused;
    explorer.classList.toggle("is-globe-focused", focused);
  }

  function cameraPadding() {
    const mapBounds = elements.map?.getBoundingClientRect();
    const uiBounds = elements.uiFrame?.getBoundingClientRect();
    if (!mapBounds || !uiBounds || !mapBounds.width || !uiBounds.width) {
      return window.innerWidth <= 800
        ? { top: 70, right: 20, bottom: 110, left: 20 }
        : { top: 36, right: 40, bottom: 120, left: 440 };
    }

    const right = Math.max(20, Math.round(mapBounds.right - uiBounds.right + 24));
    const bottom = Math.max(28, Math.round(mapBounds.bottom - uiBounds.bottom + 36));
    const left = Math.max(20, Math.round(uiBounds.left - mapBounds.left + 24));
    const top = Math.max(24, Math.round(uiBounds.top - mapBounds.top + 24));
    return { top, right, bottom, left };
  }

  function syncGlobeUiBounds() {
    const mapBounds = elements.map?.getBoundingClientRect();
    const uiBounds = elements.uiFrame?.getBoundingClientRect();
    if (!mapBounds || !uiBounds || !mapBounds.width || !uiBounds.width) return;

    elements.map.style.setProperty("--globe-ui-top", `${Math.max(0, Math.round(uiBounds.top - mapBounds.top))}px`);
    elements.map.style.setProperty("--globe-ui-right", `${Math.max(0, Math.round(mapBounds.right - uiBounds.right))}px`);
    elements.map.style.setProperty("--globe-ui-bottom", `${Math.max(0, Math.round(mapBounds.bottom - uiBounds.bottom))}px`);
    elements.map.style.setProperty("--globe-ui-left", `${Math.max(0, Math.round(uiBounds.left - mapBounds.left))}px`);
  }

  function chooseDisplayEvents(features, now = Date.now()) {
    const sorted = [...features].sort(
      (left, right) => Date.parse(left.properties.startsAt) - Date.parse(right.properties.startsAt),
    );
    const upcoming = sorted.filter((feature) => Date.parse(feature.properties.endsAt || feature.properties.startsAt) >= now);
    if (upcoming.length) return { mode: "upcoming", events: upcoming };
    const recent = sorted.filter((feature) => {
      const end = Date.parse(feature.properties.endsAt || feature.properties.startsAt);
      return end < now && end >= now - RECENT_WINDOW_MS;
    }).reverse();
    if (recent.length) return { mode: "recent", events: recent };
    return { mode: "empty", events: [] };
  }

  function applyFilters() {
    const query = state.search.trim().toLocaleLowerCase();
    state.filtered = state.events.filter((feature) => {
      const properties = feature.properties;
      const categoryMatch = state.filter === "all" || properties.category === state.filter;
      const haystack = [
        properties.title,
        properties.chapterName,
        properties.city,
        properties.country,
        properties.category,
      ].join(" ").toLocaleLowerCase();
      return categoryMatch && (!query || haystack.includes(query));
    });

    if (!state.filtered.some((feature) => feature.properties.id === state.selectedId)) {
      state.selectedId = state.filtered[0]?.properties.id || null;
      if (state.filtered[0]) renderSelected(state.filtered[0]);
    }

    renderList();
    if (state.mapReady && state.selectedId) {
      state.map.setFilter("selected-event-halo", ["==", ["get", "id"], state.selectedId]);
    }
  }

  function renderMapData() {
    if (!state.mapReady) return;
    const source = state.map.getSource("events");
    if (!source) return;
    source.setData({ type: "FeatureCollection", features: state.filtered });
  }

  function showFallback(message) {
    if (!elements.map) return;
    const fallback = createElement("div", "globe-fallback");
    fallback.append(
      createElement("strong", "", "The interactive globe is unavailable."),
      createElement("p", "", `${message} Every verified event remains searchable in the list.`),
    );
    elements.loading?.remove();
    elements.map.append(fallback);
    elements.controls.forEach((control) => { control.disabled = true; });
  }

  function mapStyle() {
    return {
      version: 8,
      sources: {
        countries: {
          type: "geojson",
          data: COUNTRY_SOURCE_URL,
          attribution: '<a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a>',
        },
        events: {
          type: "geojson",
          data: { type: "FeatureCollection", features: state.filtered },
          attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap geocoding</a>',
        },
      },
      layers: [
        {
          id: "space",
          type: "background",
          paint: { "background-color": "#080907" },
        },
        {
          id: "countries-fill",
          type: "fill",
          source: "countries",
          paint: {
            "fill-color": [
              "interpolate",
              ["linear"],
              ["get", "MAPCOLOR7"],
              1, "#242821",
              3, "#2a2d27",
              7, "#20241f",
              13, "#30332c"
            ],
            "fill-opacity": 0.98,
          },
        },
        {
          id: "countries-border",
          type: "line",
          source: "countries",
          paint: {
            "line-color": "#575c51",
            "line-width": 0.55,
            "line-opacity": 0.72,
          },
        },
        {
          id: "selected-event-halo",
          type: "circle",
          source: "events",
          filter: ["==", ["get", "id"], state.selectedId || ""],
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 0.8, 12, 4, 23],
            "circle-color": [
              "match", ["get", "category"],
              "local", "#ea4335",
              "build-with-ai", "#f9ab00",
              "devfest", "#4285f4",
              "workshop", "#34a853",
              "#8ab4f8"
            ],
            "circle-opacity": 0.2,
            "circle-blur": 0.2,
          },
        },
        {
          id: "event-points",
          type: "circle",
          source: "events",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 0.8, 4.2, 4, 8],
            "circle-color": [
              "match", ["get", "category"],
              "local", "#ea4335",
              "build-with-ai", "#f9ab00",
              "devfest", "#4285f4",
              "workshop", "#34a853",
              "#8ab4f8"
            ],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 1.5,
            "circle-opacity": 0.96,
          },
        },
      ],
    };
  }

  function initMap() {
    if (state.mapInitialized) return;
    state.mapInitialized = true;

    if (!window.maplibregl) {
      showFallback("The map library did not load.");
      return;
    }

    if (typeof window.maplibregl.supported === "function" && !window.maplibregl.supported()) {
      showFallback("This browser does not provide the WebGL support the globe needs.");
      return;
    }

    try {
      state.map = new window.maplibregl.Map({
        container: elements.map,
        style: mapStyle(),
        center: TULSA_CENTER,
        zoom: 1.18,
        minZoom: 0.75,
        maxZoom: 5.5,
        cooperativeGestures: true,
        dragRotate: true,
        pitchWithRotate: false,
        attributionControl: true,
        renderWorldCopies: false,
      });
    } catch (error) {
      showFallback(error.message || "The map could not start.");
      return;
    }

    state.map.on("load", () => {
      state.map.setProjection({ type: "globe" });
      syncGlobeUiBounds();
      state.map.jumpTo({ padding: cameraPadding() });
      state.mapReady = true;
      elements.loading?.remove();
      renderMapData();
      if (state.selectedId) selectEvent(state.selectedId);
      syncMotionButton();
      ensureRotationLoop();
    });

    state.map.on("click", "event-points", (event) => {
      const id = event.features?.[0]?.properties?.id;
      if (id) selectEvent(id, { moveMap: true, scrollList: true });
    });

    state.map.on("mouseenter", "event-points", () => {
      state.map.getCanvas().style.cursor = "pointer";
    });

    state.map.on("mouseleave", "event-points", () => {
      state.map.getCanvas().style.cursor = "grab";
    });

    for (const eventName of ["dragstart", "zoomstart", "rotatestart", "pitchstart"]) {
      state.map.on(eventName, pauseRotation);
    }

    state.map.on("zoomend", () => {
      setFocused(state.map.getZoom() >= 2.05);
    });

    elements.map.addEventListener("focusin", pauseRotation);

    state.map.on("error", (event) => {
      if (!state.mapReady) showFallback(event?.error?.message || "The globe could not load its local data.");
    });

    window.addEventListener("pagehide", () => {
      stopOrbitHold();
      stopRotationLoop();
      state.map?.remove();
    }, { once: true });
  }

  function updateCamera({ longitudeDelta = 0, zoomDelta = 0, reset = false }) {
    if (!state.mapReady) return;
    pauseRotation();
    const current = state.map.getCenter();
    state.map.easeTo({
      center: reset ? TULSA_CENTER : [current.lng + longitudeDelta, current.lat],
      zoom: reset ? 1.18 : Math.max(0.75, Math.min(5.5, state.map.getZoom() + zoomDelta)),
      padding: cameraPadding(),
      duration: reducedMotion.matches ? 0 : 380,
      easing: (value) => 1 - Math.pow(1 - value, 3),
    });
    if (reset) setFocused(false);
  }

  function pauseRotation() {
    state.manualPaused = true;
    stopRotationLoop();
    syncMotionButton();
  }

  function canRotate() {
    return state.mapReady && state.mapVisible && !document.hidden && !state.manualPaused && !state.focused && !reducedMotion.matches;
  }

  function ensureRotationLoop() {
    if (!canRotate() || state.rotationFrame !== null) return;
    state.rotationFrame = requestAnimationFrame(rotateFrame);
  }

  function stopRotationLoop() {
    if (state.rotationFrame !== null) cancelAnimationFrame(state.rotationFrame);
    state.rotationFrame = null;
    state.lastRotationAt = 0;
  }

  function rotateFrame(timestamp) {
    state.rotationFrame = null;
    if (!canRotate()) return;

    if (!state.lastRotationAt) state.lastRotationAt = timestamp;
    const elapsed = timestamp - state.lastRotationAt;
    if (elapsed >= AUTO_ROTATION_INTERVAL_MS) {
      const center = state.map.getCenter();
      const longitudeDelta = AUTO_ROTATION_DEGREES_PER_SECOND * Math.min(elapsed, 100) / 1000;
      state.map.setCenter([center.lng + longitudeDelta, center.lat]);
      state.lastRotationAt = timestamp;
    }

    ensureRotationLoop();
  }

  function stopOrbitHold(button) {
    if (state.orbitHoldTimer !== null) window.clearTimeout(state.orbitHoldTimer);
    state.orbitHoldTimer = null;
    if (state.orbitHoldFrame !== null) cancelAnimationFrame(state.orbitHoldFrame);
    state.orbitHoldFrame = null;
    state.orbitHoldDirection = 0;
    state.lastOrbitHoldAt = 0;
    button?.classList.remove("is-holding");
  }

  function orbitHoldFrame(timestamp) {
    state.orbitHoldFrame = null;
    if (!state.mapReady || !state.orbitHoldDirection || document.hidden || !state.mapVisible) return;

    if (timestamp - state.lastOrbitHoldAt > 42) {
      const center = state.map.getCenter();
      state.map.setCenter([center.lng + state.orbitHoldDirection * 0.9, center.lat]);
      state.lastOrbitHoldAt = timestamp;
    }
    state.orbitHoldFrame = requestAnimationFrame(orbitHoldFrame);
  }

  function scheduleOrbitHold(button, direction) {
    if (reducedMotion.matches) return;
    stopOrbitHold();
    state.orbitHoldTimer = window.setTimeout(() => {
      state.orbitHoldTimer = null;
      state.suppressOrbitClick = true;
      state.orbitHoldDirection = direction;
      button.classList.add("is-holding");
      pauseRotation();
      state.orbitHoldFrame = requestAnimationFrame(orbitHoldFrame);
    }, 180);
  }

  function syncMotionButton() {
    const button = elements.controls.find((control) => control.dataset.globeAction === "motion");
    if (!button) return;

    if (reducedMotion.matches) {
      button.disabled = true;
      button.textContent = "Motion off";
      button.setAttribute("aria-pressed", "true");
      return;
    }

    button.disabled = false;
    button.textContent = state.manualPaused ? "Resume" : "Pause";
    button.setAttribute("aria-pressed", String(state.manualPaused));
  }

  function initControls() {
    elements.controls.forEach((button) => {
      button.addEventListener("click", () => {
        if (state.suppressOrbitClick && button.dataset.globeAction.startsWith("rotate-")) {
          state.suppressOrbitClick = false;
          return;
        }
        switch (button.dataset.globeAction) {
          case "rotate-left": updateCamera({ longitudeDelta: -20 }); break;
          case "rotate-right": updateCamera({ longitudeDelta: 20 }); break;
          case "zoom-in": updateCamera({ zoomDelta: 0.7 }); break;
          case "zoom-out": updateCamera({ zoomDelta: -0.7 }); break;
          case "reset":
            updateCamera({ reset: true });
            if (state.selectedId) selectEvent(state.selectedId, { scrollList: true });
            break;
          case "motion":
            state.manualPaused = !state.manualPaused;
            syncMotionButton();
            ensureRotationLoop();
            break;
        }
      });

      const direction = button.dataset.globeAction === "rotate-left"
        ? -1
        : button.dataset.globeAction === "rotate-right" ? 1 : 0;
      if (!direction) return;

      button.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        button.setPointerCapture?.(event.pointerId);
        scheduleOrbitHold(button, direction);
      });
      for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
        button.addEventListener(eventName, () => stopOrbitHold(button));
      }
      button.addEventListener("blur", () => stopOrbitHold(button));
    });
    syncMotionButton();
  }

  function initVisibilityHandling() {
    if ("IntersectionObserver" in window) {
      const visibilityObserver = new IntersectionObserver(
        ([entry]) => {
          state.mapVisible = Boolean(entry?.isIntersecting);
          if (state.mapVisible) ensureRotationLoop();
          else stopRotationLoop();
        },
        { threshold: 0.04 },
      );
      visibilityObserver.observe(elements.map);

      const loadObserver = new IntersectionObserver(
        ([entry]) => {
          if (!entry?.isIntersecting) return;
          initMap();
          loadObserver.disconnect();
        },
        { rootMargin: "600px 0px" },
      );
      loadObserver.observe(elements.map);
    } else {
      initMap();
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopRotationLoop();
      else ensureRotationLoop();
    });

    reducedMotion.addEventListener("change", () => {
      if (reducedMotion.matches) {
        stopRotationLoop();
        state.map?.jumpTo({ center: TULSA_CENTER, zoom: 1.18, padding: cameraPadding() });
      } else {
        state.manualPaused = false;
        ensureRotationLoop();
      }
      syncMotionButton();
    });
  }

  function initFiltering() {
    elements.search.addEventListener("input", () => {
      state.search = elements.search.value;
      applyFilters();
    });

    elements.filters.forEach((button) => {
      button.addEventListener("click", () => {
        state.filter = button.dataset.eventFilter;
        elements.filters.forEach((candidate) => {
          const active = candidate === button;
          candidate.classList.toggle("is-active", active);
          candidate.setAttribute("aria-pressed", String(active));
        });
        applyFilters();
      });
    });
  }

  async function loadEvents() {
    try {
      const data = await (window.gdgEventDataPromise || fetch(EVENT_SOURCE_URL).then((response) => {
        if (!response.ok) throw new Error(`event data returned ${response.status}`);
        return response.json();
      }));
      if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
        throw new Error("event data is not a FeatureCollection");
      }
      state.allEvents = data.features;
      const display = chooseDisplayEvents(state.allEvents);
      state.mode = display.mode;
      state.events = display.events;
      state.filtered = [...state.events];
      const defaultEvent = state.events.find((feature) => feature.properties.city?.toLocaleLowerCase() === "tulsa") || state.events[0];
      state.selectedId = defaultEvent?.properties.id || null;
      const verifiedDates = state.allEvents.map((feature) => Date.parse(feature.properties.verifiedAt)).filter(Number.isFinite);
      if (verifiedDates.length && elements.snapshotNote) {
        const verifiedLabel = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
          .format(new Date(Math.max(...verifiedDates)));
        elements.snapshotNote.textContent = state.mode === "upcoming"
          ? `Verified upcoming-event snapshot, last checked ${verifiedLabel}; not a complete live feed.`
          : state.mode === "recent"
            ? `No upcoming events remain in this snapshot. Showing events from the last 90 days; last checked ${verifiedLabel}.`
            : `No upcoming or recent events remain in this snapshot; last checked ${verifiedLabel}.`;
      }
      renderList();
      if (state.selectedId) selectEvent(state.selectedId);
      else renderSelected(null);
    } catch (error) {
      elements.status.textContent = "Verified event data could not be loaded";
      const empty = createElement("li", "empty-results", "Use the official GDG event catalog while this list is unavailable.");
      elements.list.replaceChildren(empty);
      showFallback(error.message || "Event data is unavailable.");
    }
  }

  initControls();
  initFiltering();
  initVisibilityHandling();
  loadEvents();

  const resizeObserver = "ResizeObserver" in window ? new ResizeObserver(() => {
    syncGlobeUiBounds();
    if (!state.mapReady) return;
    state.map.resize();
    state.map.jumpTo({ padding: cameraPadding() });
  }) : null;
  resizeObserver?.observe(explorer);
  window.addEventListener("pagehide", () => resizeObserver?.disconnect(), { once: true });
})();
