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
  const TOTAL = 5900;
  /* Der Loop ist der Ruhezustand ganz oben. Sobald gescrollt wird, darf er
     seinen Durchlauf zu Ende spielen -- er ist nahtlos geschnitten (letztes
     gegen erstes Bild: 0.68 von 255), und sein Schlussbild deckt sich mit
     buch.mp4 bei 0s (0.79). Erst danach wird übergeblendet.
     Die Notbremse bei SCROLL_FORCE verhindert, dass der Loop bei schnellem
     Scrollen zu weit hinter der Videoposition zurückbleibt -- bis dorthin ist
     buch.mp4 noch in derselben Schwebephase, der Wechsel bleibt unsichtbar. */
  const SCROLL_ARM = 6; // ab hier gilt "der Nutzer scrollt"
  // Gemessen an der geglätteten Position, also an dem, was buch.mp4 gerade
  // zeigt -- nicht an der rohen Scrollposition. 900px entsprechen 3.2s, das
  // Buch schwebt dort noch wie im Loop.
  const SCROLL_FORCE = 700;
  const OUTRO_MS = 600; // Dauer der Überblendung

  /* Die Abspielposition hängt am Scroll, hält aber bei 10s, 15s und 20s an,
     damit der Text links auf den drei Buchmomenten steht: liegend, stehend,
     Bibliothek. t1 = -1 heißt "letztes Bild" (das Video läuft bis 20.31s,
     und genau darauf passt step_4_libary.png). */
  /* Die Halte sind auf die Mitte der jeweiligen Textblende gelegt, damit das
     Einrasten auf dem lesbaren Moment landet. Zwischen den Halten liegt nur
     so viel Weg, wie die Kamerabewegung braucht -- vorher lief die Seite auf
     einem Drittel der Strecke leer. */
  const TIMELINE = [
    { from: 400, to: 1375, t0: 0, t1: 10 },
    { from: 1375, to: 2175, t0: 10, t1: 10, hold: 10 },
    { from: 2175, to: 2675, t0: 10, t1: 15 },
    { from: 2675, to: 3475, t0: 15, t1: 15, hold: 15 },
    // Bis zum letzten Bild durchlaufen, nicht bis 20.0s: zwischen 20.0s und
    // dem Ende fährt die Kamera noch weiter, und step_4_libary.png zeigt das
    // Ende. Ein Halt bei 20.0s ließe das Video zu früh stehenbleiben.
    { from: 3475, to: 3975, t0: 15, t1: -1 },
    { from: 3975, to: 4775, t0: -1, t1: -1, hold: 20 },
    { from: 4775, to: 5900, t0: -1, t1: -1 },
  ];

  // Kurz gehalten: Video und Standbild gleichen sich zu 96%, eine lange
  // Blende dazwischen sieht aus wie Stillstand.
  const REVEAL_FADE_START = 4775; // Standbild ein, Video aus
  const REVEAL_FADE_END = 5100;
  const REVEAL_OPEN_START = 5100; // Bild öffnet sich auf volles Format
  const REVEAL_OPEN_END = 5900;

  /* Deckung zwischen Video und Standbild, gemessen per Korrelationssuche:
     der Videoausschnitt entspricht der PNG-Region x 287, y 4, 799x759
     von 1376x768. */
  const IMG_AR = 1376 / 768;
  const CROP_X = 0.20858;
  const CROP_Y = 0.00521;
  const CROP_W = 0.58067;

  const COPY_FADE = 220;
  const COPY_SHIFT = 26;

  // Die Halte aus der Timeline ableiten, damit Marken und Snap automatisch
  // mitwandern, wenn der Fahrplan sich ändert.
  const HOLDS = TIMELINE.filter((seg) => seg.hold).map((seg) => ({
    from: seg.from,
    to: seg.to,
    center: (seg.from + seg.to) / 2,
    time: seg.hold,
  }));
  const SNAP_DELAY = 170; // ms Ruhe, bevor gefangen wird
  const SNAP_MAX = 420; // weiter als das wird nie gezogen
  const SNAP_MIN = 26; // darunter lohnt es nicht

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
  const COVER_IN = 2675;
  const COVER_OUT = 3475;

  // Eigene Logos hier eintragen: PNG oder SVG mit Transparenz. Die Datei
  // wird als Maske ueber einen Goldverlauf gelegt, die Farbe der Quelle ist
  // also egal. { text: ... } statt { src: ... } setzt ein beschriftetes
  // Platzhalterfeld.
  /* Ledertöne. "hard-light" entscheidet anhand der Helligkeit des Tons, ob
     das Leder angehoben oder abgedunkelt wird -- deshalb steuert jede Zeile
     ihre Stärke selbst. Siyah = unverändert, also Stärke 0. */
  const COVER_LEATHERS = [
    { name: "Siyah", swatch: "#1b1519", lift: "none", strength: 0 },
    { name: "Kahve", swatch: "#6b4326", lift: "brightness(1.5) sepia(0.85) saturate(1.5) hue-rotate(-14deg)", strength: 1 },
    { name: "Bordo", swatch: "#6b2029", lift: "brightness(1.35) sepia(0.85) saturate(2.2) hue-rotate(-40deg)", strength: 1 },
    { name: "Lacivert", swatch: "#243d66", lift: "brightness(1.35) sepia(0.85) saturate(1.9) hue-rotate(180deg)", strength: 1 },
    { name: "Zeytin", swatch: "#2c4834", lift: "brightness(1.24) sepia(0.85) saturate(1.15) hue-rotate(58deg)", strength: 1 },
  ];

  const FOIL_STOPS = "0%, {b} 26%, {c} 42%, {d} 48%, {b} 62%, {a} 100%";
  const COVER_FOILS = [
    { name: "Altın", swatch: "#c8a55e", a: "#8a6c33", b: "#c8a55e", c: "#f3e6bd", d: "#fffaea" },
    { name: "Gümüş", swatch: "#b9bfc6", a: "#6f7379", b: "#b9bfc6", c: "#eef1f4", d: "#ffffff" },
    { name: "Bakır", swatch: "#c07440", a: "#7a3f22", b: "#c07440", c: "#eeb98a", d: "#ffe0c4" },
    {
      name: "Kabartma",
      swatch: "#4a3f45",
      a: "#2b2328",
      b: "#463b42",
      c: "#5d5058",
      d: "#6a5c64",
      relief: "drop-shadow(0 1px 0 rgba(255, 244, 224, 0.34)) drop-shadow(0 -1px 1px rgba(0, 0, 0, 0.75))",
    },
  ];

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
  let activeLeather = 0;
  let activeFoil = 0;
  let logoSwapTimer = 0;
  let snapTimer = 0;
  let loopArmed = false; // Loop spielt seinen letzten Durchlauf
  let loopDone = false; // Loop ist ausgelaufen, Überblendung läuft
  let fadeStart = 0;

  /* ---------- helpers ---------- */

  const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));

  const smoothstep = (e0, e1, v) => {
    const x = clamp((v - e0) / (e1 - e0));
    return x * x * (3 - 2 * x);
  };

  const lerp = (a, b, t) => a + (b - a) * t;

  const getScrollDistance = () =>
    clamp(-section.getBoundingClientRect().top, 0, section.offsetHeight - window.innerHeight);

  // Achtung: das letzte Bild beginnt bei (Bilder-1)/fps = 20.2702s, die Datei
  // ist 20.3120s lang. Ein Abzug von 0.05 landete im vorletzten Bild -- das
  // Video wirkte dadurch abgeschnitten. 0.01 liegt sicher im letzten Bild.
  const videoEnd = () =>
    mainVideo && Number.isFinite(mainVideo.duration) ? Math.max(0, mainVideo.duration - 0.01) : 20.3;

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

    /* Zweite Abbildung: das Lederfeld für die Einfärbung. Etwas aufgeweitet,
       weil das gemessene Viereck die INNERE Kante der Goldbordüre ist -- ohne
       Aufweitung bliebe ein ungefärbter Lederrand stehen. Die weiche Kante
       (Maske im CSS) fängt den Überstand wieder ab. */
    const cx = (quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4;
    const cy = (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4;
    const grow = 1.06;
    const tintQuad = quad.map((p) => [cx + (p[0] - cx) * grow, cy + (p[1] - cy) * grow]);
    const pw = Math.max(8, (dist(tintQuad[0], tintQuad[1]) + dist(tintQuad[3], tintQuad[2])) / 2);
    const ph = Math.max(8, (dist(tintQuad[0], tintQuad[3]) + dist(tintQuad[1], tintQuad[2])) / 2);
    const hPanel = solveHomography(
      [
        [0, 0],
        [pw, 0],
        [pw, ph],
        [0, ph],
      ],
      tintQuad
    );
    if (hPanel) {
      root.style.setProperty("--cover-panel-w", `${pw}px`);
      root.style.setProperty("--cover-panel-h", `${ph}px`);
      root.style.setProperty(
        "--cover-panel-matrix",
        `matrix3d(${hPanel[0]},${hPanel[3]},0,${hPanel[6]},${hPanel[1]},${hPanel[4]},0,${hPanel[7]},0,0,1,0,${hPanel[2]},${hPanel[5]},0,1)`
      );
    }

    const clampX = (x) => Math.min(s.width - 26, Math.max(26, x));
    const prev = toStage([COVER_ARROW_X[0], COVER_ARROW_Y]);
    const next = toStage([COVER_ARROW_X[1], COVER_ARROW_Y]);
    root.style.setProperty("--cover-prev-x", `${clampX(prev[0])}px`);
    root.style.setProperty("--cover-prev-y", `${prev[1]}px`);
    root.style.setProperty("--cover-next-x", `${clampX(next[0])}px`);
    root.style.setProperty("--cover-next-y", `${next[1]}px`);

    const centre = toStage([(COVER_ARROW_X[0] + COVER_ARROW_X[1]) / 2, 0]);
    root.style.setProperty("--cover-panel-x", `${centre[0]}px`);
  }

  function renderLeather() {
    const entry = COVER_LEATHERS[activeLeather];
    if (!entry) return;
    root.style.setProperty("--cover-leather-lift", entry.lift);
    root.style.setProperty("--cover-leather-strength", String(entry.strength));
    markSwatches(".cover-swatches-leather", activeLeather);
  }

  function renderFoil() {
    const f = COVER_FOILS[activeFoil];
    if (!f) return;
    root.style.setProperty(
      "--cover-foil",
      `linear-gradient(115deg, ${f.a} 0%, ${f.b} 26%, ${f.c} 42%, ${f.d} 48%, ${f.b} 62%, ${f.a} 100%)`
    );
    root.style.setProperty("--cover-foil-relief", f.relief || "none");
    markSwatches(".cover-swatches-foil", activeFoil);
  }

  function markSwatches(selector, active) {
    const host = document.querySelector(selector);
    if (!host) return;
    Array.from(host.children).forEach((btn, i) => btn.classList.toggle("is-on", i === active));
  }

  function buildSwatches(selector, list, onPick) {
    const host = document.querySelector(selector);
    if (!host) return;
    host.replaceChildren(
      ...list.map((entry, i) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cover-swatch";
        btn.style.setProperty("--swatch", entry.swatch || entry.color);
        btn.setAttribute("aria-label", entry.name);
        btn.title = entry.name;
        btn.addEventListener("click", () => onPick(i));
        return btn;
      })
    );
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
      } else if (loopVideo.paused && !loopDone) {
        // Nach dem Ausklang nicht neu anwerfen: das Video steht dann auf
        // seinem Schlussbild und bleibt dort, bis es überblendet ist.
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

  // Überschriften in Wörter zerlegen und nach ihrer Zeilenlage gruppieren:
  // alle Wörter einer Zeile bekommen denselben Index und laufen dadurch
  // gemeinsam ein. Muss nach jedem Umbruch neu berechnet werden.
  function prepareCopyReveal() {
    for (const block of copyBlocks) {
      let unit = 0;
      for (const child of Array.from(block.children)) {
        const isHeading = child.tagName === "H1" || child.tagName === "H2";
        if (!isHeading) {
          child.classList.add("rv");
          child.style.setProperty("--line", String(unit));
          unit += 1;
          continue;
        }
        if (!child.dataset.raw) child.dataset.raw = child.innerHTML;
        const source = document.createElement("div");
        source.innerHTML = child.dataset.raw;
        const frag = document.createDocumentFragment();
        for (const node of Array.from(source.childNodes)) {
          if (node.nodeType !== Node.TEXT_NODE) {
            frag.appendChild(node.cloneNode(true));
            continue;
          }
          for (const part of node.textContent.split(/(\s+)/)) {
            if (!part) continue;
            if (/^\s+$/.test(part)) {
              frag.appendChild(document.createTextNode(" "));
              continue;
            }
            const word = document.createElement("span");
            word.className = "rv w";
            word.textContent = part;
            frag.appendChild(word);
          }
        }
        child.replaceChildren(frag);

        let lastTop = null;
        let line = -1;
        for (const word of child.querySelectorAll(".w")) {
          const top = word.offsetTop;
          if (lastTop === null || Math.abs(top - lastTop) > 4) {
            line += 1;
            lastTop = top;
          }
          word.style.setProperty("--line", String(unit + line));
        }
        unit += line + 1;
      }
    }
  }

  function updateCopy(scroll) {
    for (const block of copyBlocks) {
      const from = Number(block.dataset.in);
      const to = Number(block.dataset.out);
      if (!Number.isFinite(from) || !Number.isFinite(to)) continue;

      const enter = smoothstep(from, from + COPY_FADE, scroll);
      const exit = smoothstep(to - COPY_FADE, to, scroll);

      // Der Auftritt läuft über den Zeilenaufbau, der Abgang bleibt eine
      // Blende -- sonst überlagern sich zwei Bewegungen.
      block.style.opacity = 1 - exit;
      block.style.setProperty("--copy-y", `${-exit * COPY_SHIFT}px`);
      block.style.visibility = enter > 0.02 && exit < 0.999 ? "visible" : "hidden";
      block.classList.toggle("is-in", enter > 0.14 && exit < 0.999);
    }
  }

  /* ---------- Kapitelmarken und Einrasten ---------- */

  function buildProgressMarks() {
    const track = document.querySelector(".scroll-progress");
    if (!track) return;
    for (const hold of HOLDS) {
      const mark = document.createElement("span");
      mark.className = "scroll-mark";
      mark.style.left = `${(hold.center / TOTAL) * 100}%`;
      mark.dataset.time = String(hold.time);
      track.appendChild(mark);
    }
  }

  function updateProgressMarks(progress) {
    const marks = document.querySelectorAll(".scroll-mark");
    marks.forEach((mark, i) => {
      mark.classList.toggle("is-passed", progress >= HOLDS[i].center / TOTAL - 0.004);
    });
  }

  // Leichtes Einrasten: erst wenn der Scroll steht, und nur über kurze
  // Distanz -- es soll nachhelfen, nicht am Rad drehen.
  function applySnap() {
    if (reduceMotion.matches || !section) return;
    const here = getScrollDistance();
    for (const hold of HOLDS) {
      if (here < hold.from || here > hold.to) continue;
      const delta = hold.center - here;
      if (Math.abs(delta) < SNAP_MIN || Math.abs(delta) > SNAP_MAX) return;
      window.scrollTo({ top: window.scrollY + delta, behavior: "smooth" });
      return;
    }
  }

  function scheduleSnap() {
    window.clearTimeout(snapTimer);
    snapTimer = window.setTimeout(applySnap, SNAP_DELAY);
  }

  /* ---------- frame loop ---------- */

  // Verwaltet den Ausklang des Loops und liefert die Deckkraft von buch.mp4.
  // Anders als der Rest der Seite hängt diese Blende an der Zeit, nicht am
  // Scroll -- sie startet erst, wenn der Loop durchgelaufen ist.
  function updateHandover(now) {
    if (!loopArmed && targetScroll > SCROLL_ARM) {
      loopArmed = true;
      if (loopVideo) loopVideo.loop = false;
    }

    if (loopArmed && !loopDone) {
      const v = loopVideo;
      const played = v && Number.isFinite(v.duration) && v.currentTime >= v.duration - 0.06;
      if (!v || reduceMotion.matches || v.ended || played || smoothScroll > SCROLL_FORCE) {
        loopDone = true;
        fadeStart = now;
      }
    }

    // Zurück am Seitenanfang: Ruhezustand wiederherstellen.
    if (loopDone && targetScroll <= 2) {
      loopArmed = false;
      loopDone = false;
      fadeStart = 0;
      if (loopVideo) {
        loopVideo.loop = true;
        loopVideo.currentTime = 0;
      }
      return 0;
    }

    return loopDone ? clamp((now - fadeStart) / OUTRO_MS) : 0;
  }

  function update(timestamp) {
    rafPending = false;
    const now = timestamp || performance.now();

    targetScroll = getScrollDistance();

    if (!initialized || reduceMotion.matches) {
      smoothScroll = targetScroll;
      initialized = true;
    } else {
      smoothScroll = lerp(smoothScroll, targetScroll, 0.14);
    }
    if (Math.abs(smoothScroll - targetScroll) < 0.08) smoothScroll = targetScroll;

    const mainFade = updateHandover(now);
    const revealFade = smoothstep(REVEAL_FADE_START, REVEAL_FADE_END, smoothScroll);
    const revealOpen = smoothstep(REVEAL_OPEN_START, REVEAL_OPEN_END, smoothScroll);
    const time = scrubTime(smoothScroll);

    // Der Loop verschwindet erst, wenn buch.mp4 ihn praktisch deckt --
    // sonst dippt die Überblendung. Danach bleibt er weg, damit er beim
    // Wechsel aufs Standbild nicht wieder auftaucht.
    root.style.setProperty("--film-loop-opacity", 1 - smoothstep(0.88, 1, mainFade));
    root.style.setProperty("--film-main-opacity", mainFade * (1 - revealFade));
    root.style.setProperty("--rv-opacity", revealFade);
    const progress = clamp(smoothScroll / TOTAL);
    root.style.setProperty("--progress", progress);
    updateProgressMarks(progress);
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

    // Während des Ausklangs und der Blende kommen keine Scrollereignisse --
    // die Bilder müssen also selbst angefordert werden.
    const waiting = (loopArmed && !loopDone) || (loopDone && mainFade < 1);
    if (Math.abs(smoothScroll - targetScroll) > 0.08 || waiting) requestTick();
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

  window.addEventListener(
    "scroll",
    () => {
      requestTick();
      scheduleSnap();
    },
    { passive: true }
  );
  window.addEventListener("resize", () => {
    updateRevealGeometry();
    updateCoverGeometry();
    prepareCopyReveal();
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
  buildSwatches(".cover-swatches-leather", COVER_LEATHERS, (i) => {
    activeLeather = i;
    renderLeather();
  });
  buildSwatches(".cover-swatches-foil", COVER_FOILS, (i) => {
    activeFoil = i;
    renderFoil();
  });
  renderCoverLogo(true);
  renderLeather();
  renderFoil();

  buildProgressMarks();
  prepareCopyReveal();
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
