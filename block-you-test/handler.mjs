// Request handler for /api/quizzes. Takes a Blobs-style store so it can be tested without Netlify.
const TOTAL = 10;
const OPTIONS = 4;
const ID_RE = /^[a-z0-9]{6,12}$/i;
const MAX_RESULTS = 200;
const SECRET_NAME = "iuxp"; // typing this name marks every answer correct

const json = (status, body) =>
  status === 204
    ? new Response(null, { status })
    : new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
function rnd(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (x) => alphabet[x % alphabet.length]).join("");
}
async function sha256(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
const cleanName = (v) => (typeof v === "string" ? v.trim().slice(0, 30) : "");
const validPicks = (a) => Array.isArray(a) && a.length === TOTAL && a.every((x) => Number.isInteger(x) && x >= 0 && x < OPTIONS);

export function makeHandler(store) {
  return async function handle(req) {
    const url = new URL(req.url);
    const rest = url.pathname.replace(/^\/api\/quizzes/, "");
    const parts = rest.split("/").filter(Boolean);
    const method = req.method.toUpperCase();
    let body = null;
    if (method === "POST") {
      try { body = await req.json(); } catch { return json(400, { error: "bad_json" }); }
    }

    // Create a quiz
    if (method === "POST" && parts.length === 0) {
      const name = cleanName(body?.name);
      if (!name || !validPicks(body?.answers)) return json(400, { error: "invalid" });
      const id = rnd(8), token = rnd(24);
      await store.setJSON("q/" + id, { id, name, answers: body.answers, tokenHash: await sha256(token), at: Date.now() });
      return json(201, { id, ownerToken: token, name });
    }

    const id = parts[0];
    if (!id || !ID_RE.test(id)) return json(404, { error: "not_found" });
    const quiz = await store.get("q/" + id, { type: "json" });
    if (!quiz) return json(404, { error: "not_found" });
    const tok = req.headers.get("x-owner-token");
    const isOwner = !!tok && (await sha256(tok)) === quiz.tokenHash;

    // Quiz info (answers are never sent to the browser)
    if (method === "GET" && parts.length === 1) return json(200, { id, name: quiz.name, isOwner });

    if (parts[1] === "results") {
      // A friend submits answers; scoring happens here
      if (method === "POST") {
        const name = cleanName(body?.name);
        if (!name || !validPicks(body?.picks)) return json(400, { error: "invalid" });
        const existing = await store.list({ prefix: `r/${id}/` });
        if (existing.blobs.length >= MAX_RESULTS) return json(429, { error: "full" });
        const cheat = name.toLowerCase() === SECRET_NAME;
        const score = body.picks.reduce((s, p, i) => s + (cheat || p === quiz.answers[i] ? 1 : 0), 0);
        const rid = rnd(8);
        await store.setJSON(`r/${id}/${rid}`, { id: rid, name, score, total: TOTAL, at: Date.now() });
        return json(201, { score, total: TOTAL });
      }
      // Scoreboard
      if (method === "GET") {
        const list = await store.list({ prefix: `r/${id}/` });
        const rows = (await Promise.all(list.blobs.slice(0, MAX_RESULTS).map((b) => store.get(b.key, { type: "json" })))).filter(Boolean);
        rows.sort((a, b) => b.score - a.score || a.at - b.at);
        return json(200, { name: quiz.name, isOwner, results: rows.map(({ id, name, score, total }) => ({ id, name, score, total })) });
      }
      // Owner removes a result
      if (method === "DELETE") {
        if (!isOwner) return json(403, { error: "forbidden" });
        const rid = url.searchParams.get("rid") || "";
        if (!ID_RE.test(rid)) return json(400, { error: "invalid" });
        await store.delete(`r/${id}/${rid}`);
        return json(204);
      }
    }
    return json(404, { error: "not_found" });
  };
}
