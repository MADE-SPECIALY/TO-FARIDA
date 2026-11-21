/**
 * Private answer inbox for the date invitation.
 *
 * The page POSTs her finished answers to /api/notify and this Worker stores them
 * in D1. Nothing is texted or emailed from here.
 *
 * Only you can read them: open /inbox?key=<INBOX_KEY> where INBOX_KEY is a
 * secret you set on the Worker. Without the right key every visit is a plain
 * 404 - the route is not linked from the invitation page.
 *
 * Environment:
 *   DB         D1 binding (required)
 *   INBOX_KEY  secret key that unlocks /inbox (required)
 *   ALLOWED_ORIGINS  optional, comma separated (defaults to the Pages site)
 */

const MAX_MESSAGE = 600;
const RATE_LIMIT = { max: 6, windowMs: 10 * 60 * 1000 };
const hits = new Map();
let schemaReady = false;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ ok: true, storage: env.DB ? "d1" : "unavailable" }, 200, cors);
    }

    if (url.pathname === "/inbox") {
      return inbox(request, env, url);
    }

    if (url.pathname !== "/api/notify") {
      return notFound();
    }
    if (request.method !== "POST") {
      return json({ ok: false, error: "method not allowed" }, 405, cors);
    }
    if (!originAllowed(origin, env)) {
      return json({ ok: false, error: "origin not allowed" }, 403, cors);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (tooMany(ip)) {
      return json({ ok: false, error: "too many requests" }, 429, {
        ...cors,
        "Retry-After": String(Math.ceil(RATE_LIMIT.windowMs / 1000)),
      });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ ok: false, error: "invalid json" }, 400, cors);
    }

    if (!env.DB) {
      return json({ ok: false, error: "storage not configured" }, 502, cors);
    }

    try {
      await ensureSchema(env);
      const row = cleanPayload(payload);
      const result = await env.DB.prepare(
        "INSERT INTO answers (created_at, name, plan, plan_date, plan_time, attempts, letter) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(
          new Date().toISOString(),
          row.name,
          row.plan,
          row.date,
          row.time,
          row.attempts,
          row.letter,
        )
        .run();
      return json({ ok: true, saved: true, id: result.meta?.last_row_id ?? null }, 200, cors);
    } catch {
      return json({ ok: false, error: "could not save the answers" }, 502, cors);
    }
  },
};

async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS answers (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       created_at TEXT NOT NULL,
       name TEXT,
       plan TEXT,
       plan_date TEXT,
       plan_time TEXT,
       attempts INTEGER,
       letter TEXT
     )`,
  ).run();
  schemaReady = true;
}

function cleanPayload(payload = {}) {
  const { name, date, time, plan, attempts, letter } = payload;
  const tries = Number.isFinite(Number(attempts)) ? Number(attempts) : 0;
  return {
    name: clean(name, 80),
    date: clean(date, 40),
    time: clean(time, 20),
    plan: clean(plan, 160),
    attempts: Math.max(0, Math.min(999, Math.trunc(tries))),
    letter: clean(letter, MAX_MESSAGE),
  };
}

async function inbox(request, env, url) {
  if (!env.INBOX_KEY || url.searchParams.get("key") !== env.INBOX_KEY) {
    return notFound();
  }
  if (!env.DB) {
    return html("<p>Storage is not configured.</p>");
  }
  try {
    await ensureSchema(env);
    const remove = url.searchParams.get("delete");
    if (remove) {
      await env.DB.prepare("DELETE FROM answers WHERE id = ?").bind(Number(remove) || 0).run();
      return new Response(null, {
        status: 303,
        headers: {
          Location: `/inbox?key=${encodeURIComponent(env.INBOX_KEY)}`,
          "Cache-Control": "no-store",
        },
      });
    }
    const { results } = await env.DB.prepare(
      "SELECT id, created_at, name, plan, plan_date, plan_time, attempts, letter FROM answers ORDER BY id DESC LIMIT 200",
    ).all();
    return html(renderInbox(results || [], env.INBOX_KEY));
  } catch {
    return html("<p>Could not read the answers.</p>");
  }
}

function renderInbox(rows, key) {
  if (!rows.length) {
    return "<p class='empty'>No answers yet.</p>";
  }
  const cards = rows
    .map((row) => {
      const when = [row.plan_date, row.plan_time].filter(Boolean).join(" at ");
      return `<article>
      <div class="meta"><span>${esc(row.created_at || "")}</span> <a class="del" href="?key=${encodeURIComponent(key)}&amp;delete=${Number(row.id) || 0}">delete</a></div>
      <dl>
        <dt>Name</dt><dd>${esc(row.name) || "-"}</dd>
        <dt>Date</dt><dd>${esc(when) || "-"}</dd>
        <dt>Plan</dt><dd>${esc(row.plan) || "-"}</dd>
        <dt>Not tonight tries</dt><dd>${Number(row.attempts) || 0}</dd>
        <dt>Letter</dt><dd>${esc(row.letter) || "-"}</dd>
      </dl>
    </article>`;
    })
    .join("\n");
  return `<p class="count">${rows.length} answer${rows.length === 1 ? "" : "s"}</p>\n${cards}`;
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function html(body) {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Inbox</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 24px; font: 16px/1.55 ui-sans-serif, system-ui, sans-serif; background: #0f0d13; color: #f2ecf5; }
  main { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 20px; font-weight: 600; letter-spacing: .01em; margin: 0 0 4px; }
  .count, .meta, .empty { color: #a79bb2; font-size: 13px; }
  .count { margin: 0 0 20px; }
  article { border: 1px solid #302a3a; border-radius: 14px; padding: 16px 18px; margin-bottom: 14px; background: #171420; }
  .meta { margin-bottom: 10px; display: flex; justify-content: space-between; gap: 12px; }
  .del { color: #7d6f8a; text-decoration: none; }
  .del:hover { color: #d98b8b; }
  dl { display: grid; grid-template-columns: 150px 1fr; gap: 6px 14px; margin: 0; }
  dt { color: #a79bb2; font-size: 13px; }
  dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  @media (max-width: 520px) { dl { grid-template-columns: 1fr; } dt { margin-top: 6px; } }
</style>
</head>
<body>
<main>
<h1>Her answers</h1>
${body}
</main>
</body>
</html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}

function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function json(data, status, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function clean(value, max = 120) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function defaultOrigins() {
  return ["https://made-specialy.github.io"];
}

function originAllowed(origin, env) {
  if (!origin) return true; // curl / server-to-server
  const configured = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowed = configured.length ? configured : defaultOrigins();
  if (allowed.includes(origin)) return true;
  try {
    const url = new URL(origin);
    if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
      return true;
    }
  } catch {
    /* not a URL: rejected below */
  }
  return false;
}

function corsHeaders(origin, env) {
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && originAllowed(origin, env)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function tooMany(key) {
  const now = Date.now();
  if (hits.size > 5000) hits.clear();
  const entry = hits.get(key);
  if (!entry || now - entry.start > RATE_LIMIT.windowMs) {
    hits.set(key, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT.max;
}
