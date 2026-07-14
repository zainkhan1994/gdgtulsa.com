/*
 * GDG Tulsa — self-contained rotating globe.
 * No dependencies. Renders a graticule sphere + world cities on <canvas data-globe>,
 * rotating slowly with Tulsa highlighted (pulsing marker + arcs to other communities).
 * Respects prefers-reduced-motion and pauses when offscreen / tab hidden.
 */
(() => {
  const canvas = document.querySelector("[data-globe]");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const D2R = Math.PI / 180;
  const TILT = 0.32; // tip the north pole toward the viewer

  // Google brand palette
  const BLUE = "#4285f4";
  const RED = "#ea4335";
  const YELLOW = "#fbbc04";

  const TULSA = { name: "Tulsa", lat: 36.15, lng: -95.99 };

  const CITIES = [
    { name: "San Francisco", lat: 37.77, lng: -122.42 },
    { name: "Los Angeles", lat: 34.05, lng: -118.24 },
    { name: "Seattle", lat: 47.61, lng: -122.33 },
    { name: "New York", lat: 40.71, lng: -74.0 },
    { name: "Toronto", lat: 43.65, lng: -79.38 },
    { name: "Chicago", lat: 41.88, lng: -87.63 },
    { name: "Mexico City", lat: 19.43, lng: -99.13 },
    { name: "São Paulo", lat: -23.55, lng: -46.63 },
    { name: "London", lat: 51.5, lng: -0.13 },
    { name: "Berlin", lat: 52.52, lng: 13.4 },
    { name: "Lagos", lat: 6.52, lng: 3.37 },
    { name: "Nairobi", lat: -1.29, lng: 36.82 },
    { name: "Cairo", lat: 30.04, lng: 31.24 },
    { name: "Dubai", lat: 25.2, lng: 55.27 },
    { name: "Delhi", lat: 28.61, lng: 77.21 },
    { name: "Beijing", lat: 39.9, lng: 116.4 },
    { name: "Bangkok", lat: 13.75, lng: 100.5 },
    { name: "Singapore", lat: 1.35, lng: 103.82 },
    { name: "Tokyo", lat: 35.68, lng: 139.65 },
    { name: "Sydney", lat: -33.87, lng: 151.21 },
  ];

  // Cities Tulsa connects to with arcs
  const LINKS = ["San Francisco", "New York", "London", "Tokyo"];
  const linkTargets = LINKS.map((n) => CITIES.find((c) => c.name === n)).filter(Boolean);

  // Precompute graticule points (dotted parallels + meridians)
  const grat = [];
  for (let lat = -80; lat <= 80; lat += 20) {
    for (let lng = -180; lng < 180; lng += 6) grat.push({ lat, lng });
  }
  for (let lng = -180; lng < 180; lng += 30) {
    for (let lat = -88; lat <= 88; lat += 6) grat.push({ lat, lng });
  }

  let W = 0, H = 0, cx = 0, cy = 0, R = 0, dpr = 1;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width;
    H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W / 2;
    cy = H / 2;
    R = Math.min(W, H) * 0.42;
  }

  // lat/lng -> rotated 3D unit vector, then screen coords. z>0 = front.
  function project(lat, lng, ry) {
    const pl = lat * D2R;
    const ll = lng * D2R;
    let x = Math.cos(pl) * Math.sin(ll);
    let y = Math.sin(pl);
    let z = Math.cos(pl) * Math.cos(ll);
    // rotate around Y (spin)
    const x1 = x * Math.cos(ry) + z * Math.sin(ry);
    const z1 = -x * Math.sin(ry) + z * Math.cos(ry);
    // tilt around X
    const y2 = y * Math.cos(TILT) - z1 * Math.sin(TILT);
    const z2 = y * Math.sin(TILT) + z1 * Math.cos(TILT);
    return { x: cx + x1 * R, y: cy - y2 * R, z: z2 };
  }

  // great-circle interpolation between two lat/lng (returns array of points)
  function arcPoints(a, b, steps) {
    const toVec = (p) => {
      const pl = p.lat * D2R, ll = p.lng * D2R;
      return [Math.cos(pl) * Math.cos(ll), Math.cos(pl) * Math.sin(ll), Math.sin(pl)];
    };
    const va = toVec(a), vb = toVec(b);
    let dot = va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2];
    dot = Math.max(-1, Math.min(1, dot));
    const omega = Math.acos(dot) || 1e-6;
    const sinO = Math.sin(omega);
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const s1 = Math.sin((1 - t) * omega) / sinO;
      const s2 = Math.sin(t * omega) / sinO;
      const v = [s1 * va[0] + s2 * vb[0], s1 * va[1] + s2 * vb[1], s1 * va[2] + s2 * vb[2]];
      const lat = Math.asin(v[2]) / D2R;
      const lng = Math.atan2(v[1], v[0]) / D2R;
      // lift arc slightly off surface for a nice curve
      out.push({ lat, lng, r: 1 + 0.16 * Math.sin(Math.PI * t) });
    }
    return out;
  }

  const arcs = linkTargets.map((c) => arcPoints(TULSA, c, 48));

  function projectR(lat, lng, ry, rMul) {
    const p = project(lat, lng, ry);
    // scale distance from center by rMul to lift arcs
    return { x: cx + (p.x - cx) * rMul, y: cy + (p.y - cy) * rMul, z: p.z };
  }

  let ry = 1.62; // start with Tulsa (lng -95.99) facing the viewer
  let t = 0;
  let running = true;

  function frame() {
    if (!running) return;
    t += 1;
    if (!reduceMotion) ry += 0.0016;
    draw();
    requestAnimationFrame(frame);
  }

  function draw() {
    if (!W) resize();
    ctx.clearRect(0, 0, W, H);

    // ocean sphere with volume
    const grd = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.2, cx, cy, R);
    grd.addColorStop(0, "rgba(45, 90, 170, 0.55)");
    grd.addColorStop(0.6, "rgba(20, 45, 100, 0.5)");
    grd.addColorStop(1, "rgba(9, 18, 45, 0.65)");
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    // atmosphere glow
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.02, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(120, 170, 255, 0.35)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // graticule dots
    for (let i = 0; i < grat.length; i++) {
      const p = project(grat[i].lat, grat[i].lng, ry);
      if (p.z <= 0) continue;
      const a = 0.12 + p.z * 0.28;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(150, 190, 255, ${a})`;
      ctx.fill();
    }

    // arcs from Tulsa
    for (let a = 0; a < arcs.length; a++) {
      const pts = arcs[a];
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < pts.length; i++) {
        const p = projectR(pts[i].lat, pts[i].lng, ry, pts[i].r);
        if (p.z <= -0.15) { started = false; continue; }
        if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = "rgba(251, 188, 4, 0.5)";
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // traveling pulse along arc
      const prog = ((t * 0.006) + a * 0.25) % 1;
      const idx = Math.floor(prog * (pts.length - 1));
      const pp = projectR(pts[idx].lat, pts[idx].lng, ry, pts[idx].r);
      if (pp.z > -0.15) {
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = YELLOW;
        ctx.fill();
      }
    }

    // world cities
    for (let i = 0; i < CITIES.length; i++) {
      const p = project(CITIES[i].lat, CITIES[i].lng, ry);
      if (p.z <= 0) continue;
      const a = 0.35 + p.z * 0.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.1, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.6, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(120, 170, 255, ${a * 0.5})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Tulsa focal marker
    const tp = project(TULSA.lat, TULSA.lng, ry);
    if (tp.z > -0.1) {
      const pulse = (Math.sin(t * 0.06) + 1) / 2;
      // outer pulsing ring
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, 6 + pulse * 10, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(234, 67, 53, ${0.5 - pulse * 0.4})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      // halo
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(234, 67, 53, 0.25)";
      ctx.fill();
      // core dot
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, 4.2, 0, Math.PI * 2);
      ctx.fillStyle = RED;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      // label
      const onFront = tp.z > 0.15;
      ctx.font = "700 14px Arial, sans-serif";
      ctx.textBaseline = "middle";
      const label = "Tulsa";
      const tw = ctx.measureText(label).width;
      const lx = tp.x + 12;
      const ly = tp.y - 14;
      ctx.globalAlpha = onFront ? 1 : 0.35;
      ctx.beginPath();
      const padX = 8, padY = 5, bh = 22, bw = tw + padX * 2;
      const rr = 6;
      roundRect(ctx, lx, ly - bh / 2, bw, bh, rr);
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fill();
      ctx.fillStyle = "#1b2a4a";
      ctx.fillText(label, lx + padX, ly + 1);
      // connector line to marker
      ctx.beginPath();
      ctx.moveTo(tp.x, tp.y);
      ctx.lineTo(lx, ly);
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function start() {
    if (running && !reduceMotion) return;
    running = true;
    frame();
  }
  function stop() {
    running = false;
  }

  window.addEventListener("resize", resize, { passive: true });
  resize();

  // pause when offscreen
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { if (!reduceMotion) start(); else draw(); }
        else stop();
      });
    }, { threshold: 0.05 });
    io.observe(canvas);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (!reduceMotion) start();
  });

  if (reduceMotion) draw();
  else frame();
})();
