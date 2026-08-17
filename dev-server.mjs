// Winziger statischer Server MIT HTTP-Range-Unterstützung.
// python3 -m http.server kann das nicht -> Video-Seeking funktioniert dort nicht.
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = process.argv[2] || process.cwd();
const PORT = Number(process.argv[3] || 8732);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webm": "video/webm",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const file = join(ROOT, normalize(urlPath === "/" ? "/index.html" : urlPath));
  let stat;
  try {
    stat = statSync(file);
  } catch {
    res.writeHead(404).end("not found");
    return;
  }
  const type = TYPES[extname(file).toLowerCase()] || "application/octet-stream";
  const range = req.headers.range;

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
    res.writeHead(206, {
      "Content-Type": type,
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
    });
    createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { "Content-Type": type, "Content-Length": stat.size, "Accept-Ranges": "bytes" });
    createReadStream(file).pipe(res);
  }
}).listen(PORT, () => console.log("serving " + ROOT + " on " + PORT));
