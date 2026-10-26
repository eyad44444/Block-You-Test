// Small Node server: serves public/index.html and the /api/quizzes API. No dependencies (Node 18+).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeHandler } from "./handler.mjs";
import { makePgStore } from "./pgstore.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(here, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
fs.mkdirSync(DATA_DIR, { recursive: true });

// Tiny key-value store kept in memory and saved to one JSON file.
let db = {};
try { db = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch {}
let timer = null;
function persist() {
  clearTimeout(timer);
  timer = setTimeout(() => { try { fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch (e) { console.error(e); } }, 300);
}
const store = {
  async setJSON(k, v) { db[k] = v; persist(); },
  async get(k) { return db[k] ?? null; },
  async delete(k) { delete db[k]; persist(); },
  async list({ prefix }) { return { blobs: Object.keys(db).filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; },
};
// With DATABASE_URL (Render Postgres) data is kept in the database; otherwise in a local file.
let activeStore = store;
if (process.env.DATABASE_URL) {
  const { default: pg } = await import("pg");
  const url = process.env.DATABASE_URL;
  const pool = new pg.Pool({ connectionString: url, ssl: /\.render\.com|sslmode=require/.test(url) ? { rejectUnauthorized: false } : false });
  activeStore = await makePgStore(pool);
}
console.log("storage:", process.env.DATABASE_URL ? "postgres" : "local file (temporary on Render free)");
const handle = makeHandler(activeStore);
const page = fs.readFileSync(path.join(here, "public", "index.html"));

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/quizzes")) {
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > 20000) { res.writeHead(413).end(); return; } chunks.push(c); }
      const hasBody = !["GET", "HEAD", "DELETE"].includes(req.method);
      const r = await handle(new Request(url, {
        method: req.method,
        headers: { "content-type": "application/json", "x-owner-token": req.headers["x-owner-token"] || "" },
        body: hasBody ? Buffer.concat(chunks) : undefined,
      }));
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page);
  } catch (e) {
    console.error(e);
    res.writeHead(500).end();
  }
}).listen(PORT, () => console.log("listening on " + PORT));
