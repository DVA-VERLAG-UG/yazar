(() => {
  "use strict";

  const section = document.querySelector(".cinema-scroll");
  const stage = document.querySelector(".stage");
  const film = document.querySelector(".film");
  const root = document.documentElement;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const loopVideo = document.querySelector(".film-video-loop");
  const mainVideo = document.querySelector(".film-video-main");
  const copyBlocks = Array.from(document.querySelectorAll(".copy-block"));
  const navToggle = document.querySelector(".nav-toggle");
  const navPanel = document.querySelector(".nav-panel");
  const coverPick = document.querySelector(".cover-pick");
  const coverLabel = document.querySelector(".cover-label");
  const coverDots = document.querySelector(".cover-dots");
  const coverLogo = document.querySelector(".cover-logo");
  const coverLogoText = document.querySelector(".cover-logo-text");

  /* Scroll-Fahrplan in Pixeln Scrollstrecke (max. 8200, siehe
     .cinema-scroll in styles.css). */
  const TOTAL = 8200;
  const LOOP_FADE_START = 80; // buch.mp4 beginnt einzublenden
  const LOOP_FADE_END = 520; // ... und ist hier voll da

  /* Die Abspielposition hängt am Scroll, hält aber bei 10s, 15s und 20s an,
     damit der Text links auf den drei Buchmomenten steht: liegend, stehend,
     Bibliothek. t1 = -1 heißt "letztes Bild" (das Video läuft bis 20.31s,
     und genau darauf passt step_4_libary.png). */
  const TIMELINE = [
    { from: 520, to: 1700, t0: 0, t1: 10 },
    { from: 1700, to: 2800, t0: 10, t1: 10 }, // Halt
    { from: 2800, to: 3500, t0: 10, t1: 15 },
    { from: 3500, to: 4600, t0: 15, t1: 15 }, // Halt
    { from: 4600, to: 5300, t0: 15, t1: 20 },
    { from: 5300, to: 6400, t0: 20, t1: 20 }, // Halt
    { from: 6400, to: 7300, t0: 20, t1: -1 },
  ];

  const REVEAL_FADE_START = 6400; // Standbild ein, Video aus
  const REVEAL_FADE_END = 7300;
  const REVEAL_OPEN_START = 7300; // Bild öffnet sich auf volles Format
  const REVEAL_OPEN_END = 8200;

  /* Deckung zwischen Video und Standbild, gemessen per Korrelationssuche:
     der Videoausschnitt entspricht der PNG-Region x 287, y 4, 799x759
     von 1376x768. */
  const IMG_AR = 1376 / 768;
  const CROP_X = 0.20858;
  const CROP_Y = 0.00521;
  const CROP_W = 0.58067;

  const COPY_FADE = 300;
  const COPY_SHIFT = 26;

  /* Logo-Auswahl auf dem Buchdeckel, sichtbar während des Halts bei 15s.
     Die Ecken sind das Lederfeld innerhalb der Goldbordüre, ausgemessen im
     758x720-Frame (318,173 / 597,181 / 623,526 / 344,610). Verjüngung 0.789,
     deshalb eine echte Homographie statt einer Skalierung. */
  const COVER_QUAD = {
    tl: [0.4195, 0.2403],
    tr: [0.7876, 0.2514],
    br: [0.8219, 0.7306],
    bl: [0.4538, 0.8472],
  };
  const COVER_U = [0.15, 0.85]; // Anteil der Deckelbreite, den das Logo einnimmt
  const COVER_V = [0.41, 0.59];
  const COVER_ARROW_X = [0.065, 0.95]; // Frameanteil links/rechts vom Buch
  const COVER_ARROW_Y = 0.544;
  const COVER_META_Y = 0.965;
  const COVER_IN = 3500;
  const COVER_OUT = 4600;

  // Eigene Logos hier eintragen: PNG oder SVG mit Transparenz. Die Datei
  // wird als Maske ueber einen Goldverlauf gelegt, die Farbe der Quelle ist
  // also egal. { text: ... } statt { src: ... } setzt ein beschriftetes
  // Platzhalterfeld.
  const COVER_LOGOS = [
    { src: "assets/yazar_logo.png", name: "Yazardan Direkt" },
    { text: "Logonuz\nburada olabilir", name: "Sizin logonuz" },
    { src: "assets/emblem-1.svg", name: "Kalem" },
    { src: "assets/emblem-2.svg", name: "Nişan" },
    { src: "assets/emblem-3.svg", name: "Pusula" },
  ];

  let targetScroll = 0;
  let smoothScroll = 0;
  let initialized = false;
  let rafPending = false;
  let revealFrom = null;
  let revealTo = null;
  let activeLogo = 0;
  let logoSwapTimer = 0;

  /* ---------- helpers ---------- */

  const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));

  const smoothstep = (e0, e1, v) => {
    const x = clamp((v - e0) / (e1 - e0));
    return x * x * (3 - 2 * x);
  };

  const lerp = (a, b, t) => a + (b - a) * t;

  const getScrollDistance = () =>
    clamp(-section.getBoundingClientRect().top, 0, section.offsetHeight - window.innerHeight);

  const videoEnd = () =>
    mainVideo && Number.isFinite(mainVideo.duration) ? Math.max(0, mainVideo.duration - 0.05) : 20.26;

  /* ---------- Abspielposition aus dem Scroll ---------- */

  function scrubTime(scroll) {
    const end = videoEnd();
    const resolve = (t) => (t < 0 ? end : t);
    if (scroll <= TIMELINE[0].from) return 0;
    for (const seg of TIMELINE) {
      if (scroll < seg.to) {
        const t0 = resolve(seg.t0);
        const t1 = resolve(seg.t1);
        if (scroll <= seg.from) return t0;
        return lerp(t0, t1, (scroll - seg.from) / (seg.to - seg.from));
      }
    }
    return end;
  }

  /* ---------- Standbild ---------- */

  // Anfangslage: das Bild liegt so, dass sein gemessener Ausschnitt exakt
  // den Videorahmen füllt. Endlage: das ganze Bild, mittig in die Bühne
  // eingepasst. Hängt nur am Layout, also einmal pro Resize rechnen.
  function updateRevealGeometry() {
    if (!film || !stage) return;
    const f = film.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    if (!f.width || !s.width) return;

    const wFrom = f.width / CROP_W;
    const hFrom = wFrom / IMG_AR;
    revealFrom = {
      winX: f.left - s.left,
      winY: f.top - s.top,
      winW: f.width,
      winH: f.height,
      imgX: f.left - s.left - CROP_X * wFrom,
      imgY: f.top - s.top - CROP_Y * hFrom,
      imgW: wFrom,
    };

    const wTo = Math.min(s.width, s.height * IMG_AR);
    const hTo = wTo / IMG_AR;
    revealTo = {
      winX: 0,
      winY: 0,
      winW: s.width,
      winH: s.height,
      imgX: (s.width - wTo) / 2,
      imgY: (s.height - hTo) / 2,
      imgW: wTo,
    };
  }

  function updateReveal(open) {
    if (!revealFrom || !revealTo) return;
    const winX = lerp(revealFrom.winX, revealTo.winX, open);
    const winY = lerp(revealFrom.winY, revealTo.winY, open);
    const imgX = lerp(revealFrom.imgX, revealTo.imgX, open);
    const imgY = lerp(revealFrom.imgY, revealTo.imgY, open);

    root.style.setProperty("--rv-x", `${winX}px`);
    root.style.setProperty("--rv-y", `${winY}px`);
    root.style.setProperty("--rv-w", `${lerp(revealFrom.winW, revealTo.winW, open)}px`);
    root.style.setProperty("--rv-h", `${lerp(revealFrom.winH, revealTo.winH, open)}px`);
    root.style.setProperty("--rv-iw", `${lerp(revealFrom.imgW, revealTo.imgW, open)}px`);
    root.style.setProperty("--rv-ix", `${imgX - winX}px`);
    root.style.setProperty("--rv-iy", `${imgY - winY}px`);
    // Die weiche Kante verschwindet, während sich das Bild öffnet.
    root.style.setProperty("--rv-fade", `${lerp(18, 0, open)}%`);
  }

  /* ---------- Buchdeckel: Logo perspektivisch auflegen ---------- */

  // Löst die projektive Abbildung src -> dst (vier Punktpaare, 8 Unbekannte).
  function solveHomography(src, dst) {
    const a = [];
    const b = [];
    for (let i = 0; i < 4; i += 1) {
      const [x, y] = src[i];
      const [u, v] = dst[i];
      a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
      b.push(u);
      a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
      b.push(v);
    }
    for (let col = 0; col < 8; col += 1) {
      let piv = col;
      for (let r = col + 1; r < 8; r += 1) {
        if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
      }
      [a[col], a[piv]] = [a[piv], a[col]];
      [b[col], b[piv]] = [b[piv], b[col]];
      if (!a[col][col]) return null;
      for (let r = 0; r < 8; r += 1) {
        if (r === col) continue;
        const f = a[r][col] / a[col][col];
        if (!f) continue;
        for (let c = col; c < 8; c += 1) a[r][c] -= f * a[col][c];
        b[r] -= f * b[col];
      }
    }
    return b.map((v, i) => v / a[i][i]);
  }

  const applyH = (h, x, y) => {
    const w = h[6] * x + h[7] * y + 1;
    return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
  };

  const dist = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);

  function updateCoverGeometry() {
    if (!coverPick || !film || !stage) return;
    const f = film.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    if (!f.width || !s.width) return;

    // Frameanteil -> Bühnenkoordinate. Die Videobox hat exakt das
    // Seitenverhältnis der Quelle, also ist das ein reiner Maßstab.
    const toStage = ([fx, fy]) => [f.left - s.left + fx * f.width, f.top - s.top + fy * f.height];

    const quad = [COVER_QUAD.tl, COVER_QUAD.tr, COVER_QUAD.br, COVER_QUAD.bl].map(toStage);
    const unit = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const hCover = solveHomography(unit, quad);
    if (!hCover) return;

    const corners = [
      applyH(hCover, COVER_U[0], COVER_V[0]),
      applyH(hCover, COVER_U[1], COVER_V[0]),
      applyH(hCover, COVER_U[1], COVER_V[1]),
      applyH(hCover, COVER_U[0], COVER_V[1]),
    ];

    // Grundgröße = mittlere Kantenlänge, damit das Element ungefähr in
    // Zielgröße gerastert wird und nicht unscharf skaliert.
    const w0 = Math.max(8, (dist(corners[0], corners[1]) + dist(corners[3], corners[2])) / 2);
    const h0 = Math.max(8, (dist(corners[0], corners[3]) + dist(corners[1], corners[2])) / 2);
    const hLogo = solveHomography(
      [
        [0, 0],
        [w0, 0],
        [w0, h0],
        [0, h0],
      ],
      corners
    );
    if (!hLogo) return;

    root.style.setProperty("--cover-w", `${w0}px`);
    root.style.setProperty("--cover-h", `${h0}px`);
    root.style.setProperty("--cover-fs", `${Math.max(8, h0 * 0.165)}px`);
    root.style.setProperty(
      "--cover-matrix",
      `matrix3d(${hLogo[0]},${hLogo[3]},0,${hLogo[6]},${hLogo[1]},${hLogo[4]},0,${hLogo[7]},0,0,1,0,${hLogo[2]},${hLogo[5]},0,1)`
    );

    const clampX = (x) => Math.min(s.width - 26, Math.max(26, x));
    const prev = toStage([COVER_ARROW_X[0], COVER_ARROW_Y]);
    const next = toStage([COVER_ARROW_X[1], COVER_ARROW_Y]);
    root.style.setProperty("--cover-prev-x", `${clampX(prev[0])}px`);
    root.style.setProperty("--cover-prev-y", `${prev[1]}px`);
    root.style.setProperty("--cover-next-x", `${clampX(next[0])}px`);
    root.style.setProperty("--cover-next-y", `${next[1]}px`);

    const meta = toStage([(COVER_ARROW_X[0] + COVER_ARROW_X[1]) / 2, COVER_META_Y]);
    root.style.setProperty("--cover-meta-x", `${meta[0]}px`);
    root.style.setProperty("--cover-meta-y", `${meta[1]}px`);
  }

  function renderCoverLogo(immediate) {
    const entry = COVER_LOGOS[activeLogo];
    if (!entry) return;
    const swap = () => {
      if (entry.text) {
        if (coverLogoText) coverLogoText.textContent = entry.text;
        coverLogo?.classList.add("is-text");
      } else {
        coverLogo?.classList.remove("is-text");
        root.style.setProperty("--cover-src", `url("${entry.src}")`);
      }
      if (coverLabel) coverLabel.textContent = entry.name;
      root.style.setProperty("--cover-logo-opacity", "1");
    };
    if (coverDots) {
      Array.from(coverDots.children).forEach((dot, i) => {
        dot.classList.toggle("is-on", i === activeLogo);
      });
    }
    if (immediate) {
      swap();
      return;
    }
    root.style.setProperty("--cover-logo-opacity", "0");
    window.clearTimeout(logoSwapTimer);
    logoSwapTimer = window.setTimeout(swap, 220);
  }

  function cycleLogo(direction) {
    activeLogo = (activeLogo + direction + COVER_LOGOS.length) % COVER_LOGOS.length;
    renderCoverLogo(false);
  }

  /* ---------- Videos ---------- */

  const play = (video) => {
    const played = video.play();
    if (played && typeof played.catch === "function") played.catch(() => {});
  };

  function syncVideos(mainFade, time) {
    // Der Loop ist nur der Ruhezustand ganz oben. Sobald buch.mp4 ihn
    // vollständig überdeckt, anhalten -- sonst dekodieren zwei Videos.
    if (loopVideo) {
      if (reduceMotion.matches || mainFade > 0.995) {
        if (!loopVideo.paused) loopVideo.pause();
      } else if (loopVideo.paused) {
        play(loopVideo);
      }
    }

    // buch.mp4 wird nie abgespielt, sondern nur gesucht. Der Encode ist
    // all-intra, damit jedes Suchen sofort sitzt. Wichtig: der Server muss
    // HTTP-Range beantworten, sonst bleibt das Video auf 0 stehen.
    if (mainVideo && Number.isFinite(mainVideo.duration) && mainVideo.duration > 0) {
      if (!mainVideo.paused) mainVideo.pause();
      if (Math.abs(mainVideo.currentTime - time) > 1 / 48) {
        mainVideo.currentTime = time;
      }
    }
  }

  /* ---------- Textspalte ---------- */

  function updateCopy(scroll) {
    for (const block of copyBlocks) {
      const from = Number(block.dataset.in);
      const to = Number(block.dataset.out);
      if (!Number.isFinite(from) || !Number.isFinite(to)) continue;

      const enter = smoothstep(from, from + COPY_FADE, scroll);
      const exit = smoothstep(to - COPY_FADE, to, scroll);
      const opacity = enter * (1 - exit);

      block.style.opacity = opacity;
      block.style.setProperty("--copy-y", `${(1 - enter) * COPY_SHIFT - exit * COPY_SHIFT}px`);
      block.style.visibility = opacity < 0.004 ? "hidden" : "visible";
    }
  }

  /* ---------- frame loop ---------- */

  function update() {
    rafPending = false;

    targetScroll = getScrollDistance();

    if (!initialized || reduceMotion.matches) {
      smoothScroll = targetScroll;
      initialized = true;
    } else {
      smoothScroll = lerp(smoothScroll, targetScroll, 0.14);
    }
    if (Math.abs(smoothScroll - targetScroll) < 0.08) smoothScroll = targetScroll;

    const mainFade = smoothstep(LOOP_FADE_START, LOOP_FADE_END, smoothScroll);
    const revealFade = smoothstep(REVEAL_FADE_START, REVEAL_FADE_END, smoothScroll);
    const revealOpen = smoothstep(REVEAL_OPEN_START, REVEAL_OPEN_END, smoothScroll);
    const time = scrubTime(smoothScroll);

    // Der Loop verschwindet erst, wenn buch.mp4 ihn praktisch deckt --
    // sonst dippt die Überblendung. Danach bleibt er weg, damit er beim
    // Wechsel aufs Standbild nicht wieder auftaucht.
    root.style.setProperty("--film-loop-opacity", 1 - smoothstep(0.88, 1, mainFade));
    root.style.setProperty("--film-main-opacity", mainFade * (1 - revealFade));
    root.style.setProperty("--rv-opacity", revealFade);
    root.style.setProperty("--progress", clamp(smoothScroll / TOTAL));
    root.style.setProperty("--hint-opacity", 1 - smoothstep(0, 220, smoothScroll));

    const coverOpacity =
      smoothstep(COVER_IN, COVER_IN + COPY_FADE, smoothScroll) *
      (1 - smoothstep(COVER_OUT - COPY_FADE, COVER_OUT, smoothScroll));
    root.style.setProperty("--cover-opacity", coverOpacity);
    root.style.setProperty("--cover-visibility", coverOpacity < 0.004 ? "hidden" : "visible");
    if (coverPick) coverPick.classList.toggle("is-ready", coverOpacity > 0.9);

    updateReveal(revealOpen);
    updateCopy(smoothScroll);
    syncVideos(mainFade, time);

    if (Math.abs(smoothScroll - targetScroll) > 0.08) requestTick();
  }

  function requestTick() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(update);
  }

  /* ---------- Menü ---------- */

  function setNavOpen(open) {
    if (!navPanel || !navToggle) return;
    navPanel.hidden = !open;
    navToggle.setAttribute("aria-expanded", String(open));
    navToggle.setAttribute("aria-label", open ? "Menüyü kapat" : "Menüyü aç");
    document.body.style.overflow = open ? "hidden" : "";
  }

  if (navToggle && navPanel) {
    navToggle.addEventListener("click", () => setNavOpen(navPanel.hidden));
    navPanel.addEventListener("click", (event) => {
      if (event.target.closest("a")) setNavOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !navPanel.hidden) setNavOpen(false);
    });
  }

  /* ---------- listeners ---------- */

  if (!section) return;

  window.addEventListener("scroll", requestTick, { passive: true });
  window.addEventListener("resize", () => {
    updateRevealGeometry();
    updateCoverGeometry();
    requestTick();
  });

  if (mainVideo) {
    mainVideo.addEventListener("loadedmetadata", requestTick);
    // Safari/iOS gibt ein nie abgespieltes Video für currentTime nicht immer
    // frei. Einmal kurz anstoßen, sobald der Nutzer die Seite berührt.
    const unlock = () => {
      mainVideo.play().then(() => mainVideo.pause()).catch(() => {});
    };
    window.addEventListener("pointerdown", unlock, { once: true, passive: true });
    window.addEventListener("touchstart", unlock, { once: true, passive: true });
  }

  reduceMotion.addEventListener("change", requestTick);

  if (coverDots) {
    coverDots.replaceChildren(...COVER_LOGOS.map(() => document.createElement("span")));
  }
  document.querySelector(".cover-arrow-prev")?.addEventListener("click", () => cycleLogo(-1));
  document.querySelector(".cover-arrow-next")?.addEventListener("click", () => cycleLogo(1));
  renderCoverLogo(true);

  updateRevealGeometry();
  updateCoverGeometry();
  requestTick();
  // Die Bühnenmaße stehen erst nach dem ersten Layout endgültig fest.
  requestAnimationFrame(() => {
    updateRevealGeometry();
    updateCoverGeometry();
    requestTick();
  });
})();
