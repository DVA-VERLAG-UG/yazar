import { spawn } from "node:child_process";
const CHROME = process.env.HOME + "/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const PORT = 9350, OUT = "/private/tmp/claude-501/-Users-nistanbullu-yazar/26e2c9c0-d7bd-44be-95c5-379e6ce0147b/scratchpad";
spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, "--no-first-run", "--no-sandbox", "--hide-scrollbars", "--force-device-scale-factor=1", "--autoplay-policy=no-user-gesture-required", "--user-data-dir=" + OUT + "/cdp-p17", "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl; for (let i = 0; i < 60 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl; } catch {} if (!wsUrl) await sleep(250); }
const ws = new WebSocket(wsUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const errs = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } else if (m.method === "Runtime.exceptionThrown") errs.push("EXC " + (m.params.exceptionDetails.exception?.description||"").slice(0,160)); else if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errs.push(m.params.entry.text.slice(0,160)); };
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, sessionId })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const S = (m,p) => send(m,p,sessionId);
await S("Page.enable"); await S("Runtime.enable"); await S("Log.enable");
const evalJs = async e2 => { const r = await S("Runtime.evaluate", { expression: e2, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0,400)); return r.result.value; };
const st = `(() => { const r=n=>Math.round(n*100)/100; const v=document.querySelector('.film-video-loop'); const cs=getComputedStyle(document.documentElement);
  return { loopT:r(v.currentTime), buchDeck:r(parseFloat(cs.getPropertyValue('--film-main-opacity'))), buchT:r(document.querySelector('.film-video-main').currentTime) }; })()`;
await S("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await S("Page.navigate", { url: "http://127.0.0.1:8732/index.html" });
await sleep(5000);

console.log("A) Loop am Anfang seines Durchlaufs, dann langsam anscrollen:");
await evalJs(`document.querySelector('.film-video-loop').currentTime = 0.3`); await sleep(300);
await evalJs(`window.scrollTo(0, 200)`);
for (let i = 1; i <= 8; i++) {
  await sleep(700);
  const s = await evalJs(st);
  console.log(`  +${String(i*0.7).padStart(4)}s  loop bei ${String(s.loopT).padStart(5)}/5.04   buch-Deckkraft ${String(s.buchDeck).padStart(4)}  buch bei ${s.buchT}s`);
  if (s.buchDeck === 1) break;
}

console.log("\nB) Notbremse: aus dem Stand weit springen");
await evalJs(`window.scrollTo(0, 0)`); await sleep(1800);
await evalJs(`document.querySelector('.film-video-loop').currentTime = 0.2`); await sleep(300);
await evalJs(`window.scrollTo(0, 4000)`);
for (const w of [250, 250, 250, 400, 700]) {
  await sleep(w);
  const s = await evalJs(st);
  if (s.buchDeck > 0 && s.buchDeck < 1) { console.log(`   waehrend der Blende: buch bei ${s.buchT}s (Loop stand bei ${s.loopT}s)`); }
}
const f = await evalJs(st);
console.log(`   danach: buch-Deckkraft ${f.buchDeck}, buch bei ${f.buchT}s`);
console.log("\nFEHLER:", errs.length ? errs : "keine");
ws.close(); process.exit(0);
