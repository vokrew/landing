// Zero-dependency static server for the Vokrew web face.
//
// The bridge only allows the production origin and localhost origins, so open
// the face at http://localhost:<port>/ — not 127.0.0.1, which the bridge's
// CORS check would reject.
//
//   node web/dev-server.js            → http://localhost:7789/
//   PORT=7790 node web/dev-server.js  → http://localhost:7790/

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 7789);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    res.writeHead(400, { "content-type": "text/plain" });
    return res.end("bad request");
  }
  if (pathname === "/" || pathname === "") pathname = "/index.html";
  if (pathname === "/favicon.ico") {
    res.writeHead(204);
    return res.end();
  }

  const file = path.resolve(ROOT, "." + pathname);
  if (!file.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { "content-type": "text/plain" });
    return res.end("forbidden");
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("not found: " + pathname);
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Vokrew web face: http://localhost:${PORT}/`);
  console.log(`Serving ${ROOT}`);
});
