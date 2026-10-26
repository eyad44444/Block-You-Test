// Key-value store on Postgres (Render's free database). One table: kv(k, v).
export async function makePgStore(pool) {
  await pool.query("CREATE TABLE IF NOT EXISTS kv (k text PRIMARY KEY, v jsonb NOT NULL)");
  return {
    async setJSON(k, v) {
      await pool.query("INSERT INTO kv (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v", [k, JSON.stringify(v)]);
    },
    async get(k) {
      const r = await pool.query("SELECT v FROM kv WHERE k = $1", [k]);
      return r.rows[0] ? r.rows[0].v : null;
    },
    async delete(k) {
      await pool.query("DELETE FROM kv WHERE k = $1", [k]);
    },
    async list({ prefix }) {
      const r = await pool.query("SELECT k FROM kv WHERE k LIKE $1", [prefix + "%"]);
      return { blobs: r.rows.map((x) => ({ key: x.k })) };
    },
  };
}
