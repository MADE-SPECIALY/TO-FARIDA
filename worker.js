/**
 * SMS relay for the date invitation.
 *
 * The page POSTs her finished answers to /api/notify and this Worker sends them
 * as a text message to your phone (01012712021 by default).
 *
 * Gateway credentials are read from the environment, never from the page:
 *   SMS Misr (Egyptian gateway, best delivery to +20 numbers)
 *     SMSMISR_USERNAME, SMSMISR_PASSWORD, SMSMISR_SENDER
 *     SMSMISR_ENVIRONMENT  optional: 1 = live (default), 2 = test
 *   or Twilio
 *     TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
 *
 * Optional: SMS_TO (defaults to +201012712021), ALLOWED_ORIGINS (comma separated).
 */

const DEFAULT_TO = "+201012712021";
const MAX_MESSAGE = 600;
const RATE_LIMIT = { max: 6, windowMs: 10 * 60 * 1000 };
const hits = new Map();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ ok: true, provider: providerName(env) }, 200, cors);
    }

    if (url.pathname !== "/api/notify") {
      return json({ ok: false, error: "not found" }, 404, cors);
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

    const result = await sendSms(env, buildMessage(payload));
    return json(result, result.ok ? 200 : 502, cors);
  },
};

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
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalizeTo(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("20")) return `+${digits}`;
  if (digits.startsWith("0")) return `+20${digits.slice(1)}`;
  return `+${digits}`;
}

function buildMessage(payload = {}) {
  const { name, date, time, plan, attempts, letter } = payload;
  const tries = Number.isFinite(Number(attempts)) ? Number(attempts) : 0;
  const when = [clean(date, 40), clean(time, 20)].filter(Boolean).join(" at ");
  const lines = [
    "Her answers to the date invitation:",
    `Name: ${clean(name, 60) || "not given"}`,
    `Date: ${when || "not chosen"}`,
    `Plan: ${clean(plan, 100) || "not chosen"}`,
    `"Not tonight" tries: ${tries}`,
  ];
  const note = clean(letter, 260);
  if (note) lines.push(`Letter: ${note}`);
  return lines.join("\n").slice(0, MAX_MESSAGE);
}

function providerName(env) {
  if (env.SMSMISR_USERNAME && env.SMSMISR_PASSWORD && env.SMSMISR_SENDER) return "smsmisr";
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM) return "twilio";
  return "none";
}

async function sendSms(env, message) {
  const to = normalizeTo(env.SMS_TO || DEFAULT_TO);
  switch (providerName(env)) {
    case "smsmisr":
      return sendViaSmsMisr(env, to, message);
    case "twilio":
      return sendViaTwilio(env, to, message);
    default:
      return { ok: false, error: "sms gateway not configured" };
  }
}

async function sendViaSmsMisr(env, to, message) {
  const body = new URLSearchParams({
    environment: env.SMSMISR_ENVIRONMENT || "1",
    username: env.SMSMISR_USERNAME,
    password: env.SMSMISR_PASSWORD,
    sender: env.SMSMISR_SENDER,
    mobile: to.replace(/^\+/, ""),
    language: "1",
    message,
  });
  try {
    const response = await fetch("https://smsmisr.com/api/SMS/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });
    const data = await response.json().catch(() => ({}));
    const code = String(data.code ?? "");
    const ok = response.ok && ["1901", "6000"].includes(code);
    if (!ok) {
      return {
        ok: false,
        provider: "smsmisr",
        error: clean(data.message, 200) || `gateway responded ${response.status}`,
        code,
      };
    }
    return { ok: true, provider: "smsmisr", smsId: data.SMSID ?? null };
  } catch {
    return { ok: false, provider: "smsmisr", error: "gateway unreachable" };
  }
}

async function sendViaTwilio(env, to, message) {
  const sid = env.TWILIO_ACCOUNT_SID;
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${env.TWILIO_AUTH_TOKEN}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: env.TWILIO_FROM, Body: message }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        provider: "twilio",
        error: clean(data.message, 200) || `gateway responded ${response.status}`,
        code: data.code ?? null,
      };
    }
    return { ok: true, provider: "twilio", smsId: data.sid ?? null };
  } catch {
    return { ok: false, provider: "twilio", error: "gateway unreachable" };
  }
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
