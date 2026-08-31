(() => {
  "use strict";

  const section = document.querySelector(".cinema-scroll");
  const stage = document.querySelector(".stage");
  const film = document.querySelector(".film");
  const root = document.documentElement;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const loopVideo = document.querySelector(".film-video-loop");
  const clipVideos = Array.from(document.querySelectorAll(".film-video-clip"));
  const copyBlocks = Array.from(document.querySelectorAll(".copy-block"));
  const navToggle = document.querySelector(".nav-toggle");
  const navPanel = document.querySelector(".nav-panel");
  const coverPick = document.querySelector(".cover-pick");
  const coverLabel = document.querySelector(".cover-label");
  const coverDots = document.querySelector(".cover-dots");
  // Zwei Stück: eines auf dem Deckel, eines quer auf dem Rücken.
  const coverLogos = Array.from(document.querySelectorAll(".cover-logo"));
  const coverLogoTexts = Array.from(document.querySelectorAll(".cover-logo-text"));

  /* Scroll-Fahrplan in Pixeln Scrollstrecke (max. 8200, siehe
     .cinema-scroll in styles.css). */
  const TOTAL = 5900;
  /* Der Loop ist der Ruhezustand ganz oben; er läuft nach seiner eigenen Uhr,
     solange die Seite dort steht. Sobald der Scroll den Anfang des Fahrplans
     erreicht, friert er ein: die Stelle, an der er gerade steht, wird zum
     Startpunkt von step1, und von da an führt der Scroll das Video bis ans
     Ende des Abschnitts. Der Nutzer übernimmt das Bild also genau dort, wo er
     es gesehen hat -- steht der Loop bei 2 von 5 Sekunden, scrollt er die
     restlichen 3 ab.
     loop.mp4 ist eine zweite Kodierung derselben Aufnahme wie step1.mp4; an
     gleicher Stelle unterscheiden sich beide nur um 1.3 von 255, der Wechsel
     ist deshalb an keinem Punkt zu sehen. */
  const OUTRO_MS = 260; // Dauer der Überblendung -- beide zeigen dasselbe Bild

  /* Die vier Abschnitte hängen hintereinander an einer gemeinsamen Skala:
     Abschnitt i belegt [i, i+1], das Ende der Strecke ist also 4. Ein
     ganzzahliger Wert ist immer eine Schnittstelle -- und weil die
     Schnittbilder deckungsgleich sind, ist es gleichgültig, ob dort das
     letzte Bild des einen oder das erste des nächsten Clips steht.
     Der Vorteil gegenüber Sekunden: die Halte sitzen automatisch genau auf
     den Schnitten, egal wie lang die einzelnen Dateien sind. */
  const CLIP_COUNT = 4;
  // Ersatzwerte, bis die Metadaten geladen sind (24 fps, 121/122 Bilder).
  const CLIP_FALLBACK = [5.0417, 5.0833, 5.0833, 5.0833];
  // Bildmaße der Quellen. Die Videobox übernimmt das Verhältnis des gerade
  // laufenden Abschnitts, sobald die Metadaten da sind.
  const CLIP_RATIO_FALLBACK = [640 / 608, 640 / 608, 672 / 592, 768 / 512];

  /* ===================================================================
     PASSUNG DER ABSCHNITTE ZUEINANDER.
     Die vier Clips sind auf verschiedene Ausschnitte gerendert (640x608,
     640x608, 672x592, 768x512). Damit das Buch über jeden Schnitt hinweg an
     derselben Stelle und in derselben Größe steht, bekommt jeder Abschnitt
     einen eigenen Maßstab und einen eigenen Versatz seiner Boxmitte.
     step4 ist der Bezug (1 / 0 / 0) -- auf sein erstes Bild sind auch die
     Buchflächen weiter unten ausgemessen.
     Ermittelt durch Deckungssuche zwischen dem Schlussbild des einen und dem
     Anfangsbild des nächsten Clips, dann durchgekettet:
       step3 -> step4:  Breite 1.1133 x, Mitte -0.0137 / -0.0137, Rest 7.8
       step2 -> step3:  Breite 0.9286 x, Mitte  0.0000 / +0.0007, Rest 4.3
     (Rest = mittlere Abweichung von 255; ein normaler Bildschritt liegt bei
     etwa 7, die Schnitte fallen also nicht auf.)
     scale  = Breite der Box, als Vielfaches der Bezugsbreite
     cx, cy = Versatz der Boxmitte, ebenfalls in Bezugsbreiten
     fadeY  = weiche Kante oben/unten, in Prozent der Boxhöhe, als Stützstellen
              [Lage im Abschnitt, Prozent]; dazwischen wird linear überblendet.
              Die Werte bleiben unter dem gemessenen Abstand des Motivs zum
              Bildrand, sonst würde die Blende das Buch anknabbern. Gemessen
              über alle Bilder: step1 14.4%, step2 13.5%, step3 16.6%.
              step4 ist der Sonderfall: das stehende Buch reicht anfangs bis
              auf 5.8% an den Rand und um Bild 15 sogar auf 2.2%, deshalb dort
              die Delle. Danach fährt die Kamera in den Raum zurück, das Motiv
              füllt das ganze Bild -- ab da darf die Kante weit auslaufen, und
              genau das nimmt der Bibliotheksaufnahme das harte Rechteck.
     =================================================================== */
  const CLIP_FIT = [
    { scale: 1.0338, cx: -0.0137, cy: -0.0128, fadeY: [[0, 10]] },
    { scale: 1.0338, cx: -0.0137, cy: -0.0128, fadeY: [[0, 10]] },
    { scale: 1.1133, cx: -0.0137, cy: -0.0137, fadeY: [[0, 12]] },
    { scale: 1, cx: 0, cy: 0, fadeY: [[0, 5], [0.12, 2.4], [0.24, 4], [0.34, 13], [1, 15]] },
  ];

  /* Die Abspielposition hängt am Scroll, hält aber an den drei Schnitten an,
     damit der Text links auf den drei Buchmomenten steht: liegend, stehend,
     Bibliothek. */
  /* Die Halte sind auf die Mitte der jeweiligen Textblende gelegt, damit das
     Einrasten auf dem lesbaren Moment landet. Zwischen den Halten liegt nur
     so viel Weg, wie die Kamerabewegung braucht -- vorher lief die Seite auf
     einem Drittel der Strecke leer. */
  const TIMELINE = [
    { from: 400, to: 1375, u0: 0, u1: 2, paced: true }, // step1 und step2 durchscrubben
    { from: 1375, to: 2175, u0: 2, u1: 2, hold: 2 }, // Buch liegt geschlossen
    { from: 2175, to: 2675, u0: 2, u1: 3 }, // step3: es richtet sich auf
    { from: 2675, to: 3475, u0: 3, u1: 3, hold: 3 }, // Buch steht -- Kapitelwahl
    { from: 3475, to: 3975, u0: 3, u1: 4 }, // step4: Kamera fährt in den Raum
    { from: 3975, to: 4775, u0: 4, u1: 4, hold: 4 }, // Bibliothek
    { from: 4775, to: 5900, u0: 4, u1: 4 },
  ];

  // Kurz gehalten: Video und Standbild sind dasselbe Bild, eine lange
  // Blende dazwischen sieht aus wie Stillstand.
  const REVEAL_FADE_START = 4775; // Standbild ein, Video aus
  const REVEAL_FADE_END = 5100;
  const REVEAL_OPEN_START = 5100; // Bild öffnet sich auf volles Format
  const REVEAL_OPEN_END = 5900;

  /* Das Standbild ist das letzte Bild von step4, doppelt aufgelöst. Es deckt
     sich also mit dem Videoausschnitt selbst -- kein Ausschnitt nötig. Beim
     Öffnen füllt es die ganze Bühne (Rest wird beschnitten). */
  const IMG_AR = 768 / 512;
  const CROP_X = 0;
  const CROP_Y = 0;
  const CROP_W = 1;

  const COPY_FADE = 220;
  const COPY_SHIFT = 26;

  // Die Halte aus der Timeline ableiten, damit Marken und Snap automatisch
  // mitwandern, wenn der Fahrplan sich ändert.
  const HOLDS = TIMELINE.filter((seg) => seg.hold).map((seg) => ({
    from: seg.from,
    to: seg.to,
    center: (seg.from + seg.to) / 2,
    unit: seg.hold,
  }));
  // Bis hierher ruht die Seite und der Loop läuft frei; ab hier führt der
  // Scroll das Video.
  const HANDOVER_AT = TIMELINE[0].from;
  const SNAP_DELAY = 170; // ms Ruhe, bevor gefangen wird
  const SNAP_MAX = 420; // weiter als das wird nie gezogen
  const SNAP_MIN = 26; // darunter lohnt es nicht

  /* Logo-Auswahl auf dem Buchdeckel, sichtbar während des Halts am Schnitt
     zwischen step3 und step4 -- dort steht das Buch aufrecht. */
  /* ===================================================================
     LAGE DER FLÄCHEN AUF DEM BUCH -- hier justieren.
     Alle Werte sind Anteile des ersten Bildes von step4 (768 x 512 px):
       x-Anteil = Pixel / 768     y-Anteil = Pixel / 512
     Reihenfolge immer tl = oben links, tr = oben rechts,
     br = unten rechts, bl = unten links.
     Zum Sichtbarmachen die Seite mit #quads aufrufen oder in der Konsole
     yazarQuads() eingeben -- dann werden beide Flächen umrandet.
     =================================================================== */

  // Vorderdeckel: die ganze Lederfläche rechts der Falzrille. Der neue Band
  // hat keine Goldbordüre mehr, die Fläche geht also bis an die Silhouette.
  // Gemessen: 322,86 / 483,44 / 481,407 / 322,476
  const COVER_QUAD = {
    tl: [0.4193, 0.1680],
    tr: [0.6289, 0.0859],
    br: [0.6263, 0.7949],
    bl: [0.4193, 0.9297],
  };

  // Buchrücken, die linke Seitenfläche. Rechts bis an die Falzrille,
  // links an die Silhouette.
  // Gemessen: 256,72 / 322,86 / 322,476 / 260,453
  const COVER_SPINE_QUAD = {
    tl: [0.3333, 0.1406],
    tr: [0.4193, 0.1680],
    br: [0.4193, 0.9297],
    bl: [0.3385, 0.8848],
  };

  /* Feinjustierung. Die Vierecke liegen auf der Kante, und außerhalb davon
     ist jetzt heller Grund statt Schwarz -- ein Überstand würde also sofort
     auffallen. Deshalb keine Aufweitung mehr, sondern eher ein Hauch nach
     innen; die weiche Maske im CSS fängt die gerundeten Ecken ab. */
  const COVER_GROW = 0.99;
  const COVER_SPINE_GROW = 0.97;
  /* Der Rücken liegt im Schatten und ist fast reines Schwarz (gemessen: 5 von
     255, der Deckel liegt bei 50). Die Aufhellung der Ledertöne allein käme
     dort nicht an, deshalb bekommt er einen eigenen Vorfaktor. Viel höher
     als 3 darf er nicht werden -- dann tritt das Rauschen der fast schwarzen
     Fläche als Blockmuster hervor. */
  const COVER_SPINE_LIFT = 3;
  const COVER_U = [0.15, 0.85]; // Anteil der Deckelbreite, den das Logo einnimmt
  const COVER_V = [0.41, 0.59];
  // Dieselbe Angabe für den Rücken: quer über seine Breite und ein Stück
  // seiner Länge. Die Größe der Prägung ergibt sich aus der Breite -- der
  // Rücken ist schmal, das Logo wird darin liegend eingepasst.
  const COVER_SPINE_U = [0.16, 0.84];
  const COVER_SPINE_V = [0.3, 0.7];
  // Leserichtung auf dem Rücken: 1 = von oben nach unten (bei stehendem Buch
  // legt man den Kopf nach rechts), -1 = von unten nach oben.
  const COVER_SPINE_DIR = 1;
  const COVER_ARROW_X = [0.215, 0.755]; // Frameanteil links/rechts vom Buch
  const COVER_ARROW_Y = 0.53;
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
  let snapAnchor = -1;
  let loopDone = false; // Loop hat übergeben, der Scroll führt
  let handoverTime = 0; // Stelle im Loop, an der er übergeben hat
  let fadeStart = 0;
  let activeClip = -1; // welcher der vier Abschnitte gerade sichtbar ist
  let fitIndex = -1; // Abschnitt, auf den die Videobox gerade eingestellt ist

  /* ---------- helpers ---------- */

  const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));

  const smoothstep = (e0, e1, v) => {
    const x = clamp((v - e0) / (e1 - e0));
    return x * x * (3 - 2 * x);
  };

  const lerp = (a, b, t) => a + (b - a) * t;

  // Stützstellen [x, y] linear ablesen; x ist aufsteigend.
  const sample = (points, x) => {
    if (x <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i += 1) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      if (x <= x1) return lerp(y0, y1, (x - x0) / (x1 - x0));
    }
    return points[points.length - 1][1];
  };

  const getScrollDistance = () =>
    clamp(-section.getBoundingClientRect().top, 0, section.offsetHeight - window.innerHeight);

  const clipDuration = (i) => {
    const v = clipVideos[i];
    return v && Number.isFinite(v.duration) && v.duration > 0 ? v.duration : CLIP_FALLBACK[i];
  };

  const clipRatio = (i) => {
    const v = clipVideos[i];
    return v && v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : CLIP_RATIO_FALLBACK[i];
  };

  /* ---------- Abspielposition aus dem Scroll ---------- */

  // Position auf der gemeinsamen Skala: 0 = Anfang step1, 4 = Ende step4.
  function scrubUnit(scroll) {
    if (scroll <= TIMELINE[0].from) return 0;
    for (const seg of TIMELINE) {
      if (scroll < seg.to) {
        if (scroll <= seg.from) return seg.u0;
        const p = (scroll - seg.from) / (seg.to - seg.from);
        return seg.paced ? pacedUnit(seg, p) : lerp(seg.u0, seg.u1, p);
      }
    }
    return CLIP_COUNT;
  }

  /* Verteilt die Strecke einer Etappe nach der Spielzeit der Abschnitte, die
     sie überstreicht, statt nach ihrer Anzahl. Nur die erste Etappe braucht
     das: step1 fängt dort an, wo der Loop übergeben hat, hat also mal mehr
     und mal weniger Rest. Ohne die Gewichtung liefe er bei später Übergabe
     kriechend und step2 danach überstürzt -- am Schnitt wäre ein Sprung in
     der Geschwindigkeit zu sehen. So bleibt das Tempo über beide gleich. */
  function pacedUnit(seg, p) {
    const spans = [];
    let total = 0;
    for (let i = seg.u0; i < seg.u1; i += 1) {
      const d = i === 0 ? clipRest(0) : clipDuration(i);
      spans.push(d);
      total += d;
    }
    const target = p * total;
    let acc = 0;
    for (let i = 0; i < spans.length; i += 1) {
      if (target <= acc + spans[i] || i === spans.length - 1) {
        return seg.u0 + i + (target - acc) / spans[i];
      }
      acc += spans[i];
    }
    return seg.u1;
  }

  // Anfang von step1: dort, wo der Loop übergeben hat. Ein Rest muss bleiben,
  // sonst wäre die Strecke des Abschnitts nicht mehr zu verteilen.
  const clipStart = (i) =>
    i === 0 ? Math.min(Math.max(0, handoverTime), Math.max(0, clipDuration(0) - 0.25)) : 0;
  const clipRest = (i) => Math.max(0.25, clipDuration(i) - clipStart(i));

  /* Skalenwert -> welcher Clip, welche Sekunde. Ein ganzzahliges u gehört
     immer dem folgenden Clip (also seinem ersten Bild); nur ganz am Ende
     bleibt es beim letzten. Achtung beim Schlussbild: es beginnt bei
     (Bilder-1)/fps, die Datei läuft aber ein Bild länger. Ein Abzug von 0.05
     landete im vorletzten Bild, 0.01 liegt sicher im letzten. */
  function resolveClip(u) {
    const index = Math.min(CLIP_COUNT - 1, Math.max(0, Math.floor(u)));
    const local = clamp(u - index);
    const dur = clipDuration(index);
    const time = lerp(clipStart(index), dur, local);
    return { index, local, time: Math.min(time, Math.max(0, dur - 0.01)) };
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

    // Das Schlussbild ist schmaler als die Bühne, deshalb füllend statt
    // einpassend -- sonst blieben links und rechts helle Streifen.
    const wTo = Math.max(s.width, s.height * IMG_AR);
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

  function updateReveal(open, fadeY) {
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
    // Die weichen Kanten verschwinden, während sich das Bild öffnet. Zu
    // Beginn müssen sie denen der Videobox entsprechen, sonst sieht man am
    // Rand, wo das Standbild übernimmt.
    root.style.setProperty("--rv-fade", `${lerp(18, 0, open)}%`);
    root.style.setProperty("--rv-fade-y", `${lerp(fadeY, 0, open)}%`);
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

  // Legt eine Fläche als eigene Abbildung ab: vom Ursprungsrechteck auf das
  // (aufgeweitete) Viereck. Die weiche Kante sitzt im CSS.
  function setTintQuad(name, corners, grow) {
    const cx = (corners[0][0] + corners[1][0] + corners[2][0] + corners[3][0]) / 4;
    const cy = (corners[0][1] + corners[1][1] + corners[2][1] + corners[3][1]) / 4;
    const q = corners.map((p) => [cx + (p[0] - cx) * grow, cy + (p[1] - cy) * grow]);
    const w = Math.max(8, (dist(q[0], q[1]) + dist(q[3], q[2])) / 2);
    const h = Math.max(8, (dist(q[0], q[3]) + dist(q[1], q[2])) / 2);
    const m = solveHomography(
      [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ],
      q
    );
    if (!m) return;
    root.style.setProperty(`--cover-${name}-w`, `${w}px`);
    root.style.setProperty(`--cover-${name}-h`, `${h}px`);
    root.style.setProperty(
      `--cover-${name}-matrix`,
      `matrix3d(${m[0]},${m[3]},0,${m[6]},${m[1]},${m[4]},0,${m[7]},0,0,1,0,${m[2]},${m[5]},0,1)`
    );
  }

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

    // Einfärbbare Flächen: Vorderdeckel und Rücken, jeweils leicht
    // aufgeweitet und als eigene Abbildung.
    const spineQuad = [
      COVER_SPINE_QUAD.tl,
      COVER_SPINE_QUAD.tr,
      COVER_SPINE_QUAD.br,
      COVER_SPINE_QUAD.bl,
    ].map(toStage);
    setTintQuad("front", quad, COVER_GROW);
    setTintQuad("spine", spineQuad, COVER_SPINE_GROW);

    /* Dieselbe Prägung noch einmal auf dem Rücken, um eine Vierteldrehung
       gekippt. Erreicht wird das allein über die Zuordnung der Ecken: die
       Oberkante des Logos wird auf die lange Kante des Rückens gelegt, seine
       Leserichtung läuft dadurch die Länge des Buchs entlang. Die Homographie
       nimmt den Rest -- die Verjüngung des Rückens überträgt sich mit. */
    const hSpine = solveHomography(unit, spineQuad);
    if (hSpine) {
      const [su0, su1] = COVER_SPINE_U;
      const [sv0, sv1] = COVER_SPINE_V;
      const at = (u, v) => applyH(hSpine, u, v);
      // Reihenfolge wie oben: oben links, oben rechts, unten rechts, unten
      // links -- aber gemeint ist das Logo, nicht der Rücken.
      const sc =
        COVER_SPINE_DIR > 0
          ? [at(su1, sv0), at(su1, sv1), at(su0, sv1), at(su0, sv0)]
          : [at(su0, sv1), at(su0, sv0), at(su1, sv0), at(su1, sv1)];
      const sw = Math.max(8, (dist(sc[0], sc[1]) + dist(sc[3], sc[2])) / 2);
      const sh = Math.max(8, (dist(sc[0], sc[3]) + dist(sc[1], sc[2])) / 2);
      const hSpineLogo = solveHomography(
        [
          [0, 0],
          [sw, 0],
          [sw, sh],
          [0, sh],
        ],
        sc
      );
      if (hSpineLogo) {
        root.style.setProperty("--cover-spine-logo-w", `${sw}px`);
        root.style.setProperty("--cover-spine-logo-h", `${sh}px`);
        root.style.setProperty(
          "--cover-spine-logo-matrix",
          `matrix3d(${hSpineLogo[0]},${hSpineLogo[3]},0,${hSpineLogo[6]},${hSpineLogo[1]},${hSpineLogo[4]},0,${hSpineLogo[7]},0,0,1,0,${hSpineLogo[2]},${hSpineLogo[5]},0,1)`
        );
      }
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
    root.style.setProperty(
      "--cover-leather-lift-spine",
      entry.lift === "none" ? "none" : `brightness(${COVER_SPINE_LIFT}) ${entry.lift}`
    );
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
    // "opacity(1)" statt "none", damit sich weitere Filter anhängen lassen.
    root.style.setProperty("--cover-foil-relief", f.relief || "opacity(1)");
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
        for (const el of coverLogoTexts) el.textContent = entry.text;
        for (const el of coverLogos) el.classList.add("is-text");
      } else {
        for (const el of coverLogos) el.classList.remove("is-text");
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

  function syncVideos(mainFade, clip) {
    // Der Loop ist nur der Ruhezustand ganz oben. Sobald der Clipstapel ihn
    // vollständig überdeckt, anhalten -- sonst dekodieren zwei Videos.
    if (loopVideo) {
      // Ab der Übergabe steht der Loop still: sein Bild ist ab da dasselbe,
      // das step1 zeigt, und darf nicht mehr weiterlaufen.
      if (reduceMotion.matches || loopDone) {
        if (!loopVideo.paused) loopVideo.pause();
      } else if (loopVideo.paused) {
        play(loopVideo);
      }
    }

    // Die Abschnitte werden nie abgespielt, sondern nur gesucht. Der Encode
    // ist all-intra, damit jedes Suchen sofort sitzt. Wichtig: der Server muss
    // HTTP-Range beantworten, sonst bleiben die Videos auf 0 stehen.
    const v = clipVideos[clip.index];
    if (v && Number.isFinite(v.duration) && v.duration > 0) {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - clip.time) > 1 / 48) v.currentTime = clip.time;
    }

    if (clip.index === activeClip) return;
    activeClip = clip.index;
    clipVideos.forEach((el, i) => el.style.setProperty("--clip-on", i === clip.index ? "1" : "0"));
    applyFilmFit(clip.index);
  }

  /* Stellt Format, Maßstab und Versatz der Videobox auf einen Abschnitt ein.
     Der Maßstab greift über transform: scale() um die Boxmitte, die Mitte
     bleibt dabei liegen -- egal ob die Box am rechten Rand (Desktop) oder
     mittig (Mobil) verankert ist. Erst danach schiebt der gemessene Versatz
     sie an ihren Platz. */
  function applyFilmFit(index, force) {
    if (!film || index < 0 || (!force && index === fitIndex)) return;
    fitIndex = index;
    const fit = CLIP_FIT[index];
    root.style.setProperty("--film-ratio", String(clipRatio(index)));
    root.style.setProperty("--clip-scale", String(fit.scale));
    // offsetWidth ist die Layoutbreite, also die Bezugsbreite -- der
    // transform-Maßstab geht darin nicht ein.
    const ref = film.offsetWidth;
    root.style.setProperty("--clip-dx", `${fit.cx * ref}px`);
    root.style.setProperty("--clip-dy", `${fit.cy * ref}px`);
    // Standbild und Buchflächen hängen an der Lage der Box.
    updateRevealGeometry();
    updateCoverGeometry();
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
      mark.dataset.unit = String(hold.unit);
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
    // Steht die Seite wirklich still? Läuft noch eine Fahrt (etwa nach einem
    // Klick auf einen Ankerlink), würde das Einrasten sie unterwegs abfangen.
    if (Math.abs(here - snapAnchor) > 2) {
      scheduleSnap();
      return;
    }
    for (const hold of HOLDS) {
      if (here < hold.from || here > hold.to) continue;
      const delta = hold.center - here;
      if (Math.abs(delta) < SNAP_MIN || Math.abs(delta) > SNAP_MAX) return;
      window.scrollTo({ top: window.scrollY + delta, behavior: "smooth" });
      return;
    }
  }

  function scheduleSnap() {
    snapAnchor = getScrollDistance();
    window.clearTimeout(snapTimer);
    snapTimer = window.setTimeout(applySnap, SNAP_DELAY);
  }

  /* ---------- frame loop ---------- */

  // Erkennt die Übergabe und hält fest, an welcher Stelle der Loop steht.
  // Läuft vor der Auflösung der Scrollposition, damit step1 im selben Bild
  // schon von dieser Stelle aus rechnet.
  function armHandover() {
    const led = smoothScroll >= HANDOVER_AT;

    if (led && !loopDone) {
      loopDone = true;
      fadeStart = 0; // erst blenden, wenn step1 wirklich auf der Stelle steht
      handoverTime = loopVideo && Number.isFinite(loopVideo.currentTime) ? loopVideo.currentTime : 0;
      if (loopVideo) loopVideo.loop = false;
    }

    // Zurück in den Ruhezustand: der Loop nimmt seinen Lauf genau dort wieder
    // auf, wo er übergeben hat -- das Bild bleibt dabei stehen.
    if (!led && loopDone) {
      loopDone = false;
      fadeStart = 0;
      if (loopVideo) {
        loopVideo.loop = true;
        if (Number.isFinite(loopVideo.duration)) loopVideo.currentTime = handoverTime;
      }
    }
  }

  // Deckkraft des Clipstapels. Die Blende hängt an der Zeit, nicht am Scroll
  // -- sie kaschiert nur den Wechsel, die Bewegung selbst führt der Scroll.
  function handoverFade(now, clip) {
    if (!loopDone) return 0;
    if (reduceMotion.matches) return 1;

    // Erst blenden, wenn der sichtbare Abschnitt sein Bild wirklich zeigt --
    // sonst mischte die Blende zwei verschiedene Bilder.
    if (!fadeStart) {
      const v = clipVideos[clip.index];
      const ready =
        !v ||
        !Number.isFinite(v.duration) ||
        v.duration <= 0 ||
        Math.abs(v.currentTime - clip.time) <= 1 / 24;
      if (!ready) return 0;
      // Geblendet wird nur die Übergabe an step1: dort zeigen Loop und Clip
      // dasselbe Bild. Wer mitten in die Seite springt, sieht im Loop etwas
      // ganz anderes -- da wird hart umgeschaltet.
      fadeStart = clip.index === 0 ? now : now - OUTRO_MS;
    }

    return clamp((now - fadeStart) / OUTRO_MS);
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

    armHandover();
    const clip = resolveClip(scrubUnit(smoothScroll));
    const mainFade = handoverFade(now, clip);
    const revealFade = smoothstep(REVEAL_FADE_START, REVEAL_FADE_END, smoothScroll);
    const revealOpen = smoothstep(REVEAL_OPEN_START, REVEAL_OPEN_END, smoothScroll);

    // Der Loop verschwindet erst, wenn der Clipstapel ihn praktisch deckt --
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

    // Die weiche Kante oben und unten wandert mit der Lage im Abschnitt.
    const fit = CLIP_FIT[clip.index];
    const fadeY = sample(fit.fadeY, clip.local);
    root.style.setProperty("--film-fade-y", `${fadeY}%`);

    updateReveal(revealOpen, fadeY);
    updateCopy(smoothScroll);
    syncVideos(mainFade, clip);

    // Während des Ausklangs und der Blende kommen keine Scrollereignisse --
    // die Bilder müssen also selbst angefordert werden.
    const waiting = loopDone && mainFade < 1;
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
    // Der Versatz der Box hängt an ihrer Breite, muss also mitwandern.
    applyFilmFit(activeClip, true);
    updateRevealGeometry();
    updateCoverGeometry();
    prepareCopyReveal();
    requestTick();
  });

  for (const v of clipVideos) {
    // Erst mit den Metadaten stehen Dauer und Bildformat fest.
    v.addEventListener("loadedmetadata", () => {
      if (v === clipVideos[activeClip]) applyFilmFit(activeClip, true);
      requestTick();
    });
    v.addEventListener("seeked", requestTick);
  }

  if (clipVideos.length) {
    // Safari/iOS gibt ein nie abgespieltes Video für currentTime nicht immer
    // frei. Einmal kurz anstoßen, sobald der Nutzer die Seite berührt.
    const unlock = () => {
      for (const v of clipVideos) v.play().then(() => v.pause()).catch(() => {});
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

  // Kontrollansicht: Seite mit #quads aufrufen oder yazarQuads() in der
  // Konsole -- umrandet die einfärbbaren Flächen zum Justieren.
  window.yazarQuads = (on = true) => coverPick?.classList.toggle("show-quads", on);
  if (location.hash === "#quads") window.yazarQuads(true);

  buildProgressMarks();
  prepareCopyReveal();
  activeClip = 0;
  applyFilmFit(0, true);
  clipVideos.forEach((el, i) => el.style.setProperty("--clip-on", i === 0 ? "1" : "0"));
  updateRevealGeometry();
  updateCoverGeometry();
  requestTick();
  // Die Bühnenmaße stehen erst nach dem ersten Layout endgültig fest.
  requestAnimationFrame(() => {
    applyFilmFit(activeClip, true);
    updateRevealGeometry();
    updateCoverGeometry();
    requestTick();
  });
})();
