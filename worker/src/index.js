// Anonymous report endpoint (#188): site form → GitHub issue.
//
// The site is static, so this worker is the only server-side piece. It is
// deliberately small: CORS allow-list, honeypot, size cap, per-IP rate limit,
// then one issue with the `needs-triage` label. No data is stored here — the
// public issue is the record.
import { MAX_BODY_BYTES, issueBody, issueTitle, validateReport } from './report.js';

const DEFAULT_ORIGINS = 'https://zzcx88.github.io';
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const RATE_LIMIT = 5; // per IP per hour
const DEFAULT_REPO = 'zzcx88/neo3ds';
const DEFAULT_API = 'https://api.github.com';

// Per-isolate fallback when no KV namespace is bound. Approximate by design:
// the KV binding (wrangler.toml) is the durable limit.
const memory = new Map();

function origins(env) {
  return String(env.ALLOWED_ORIGINS ?? DEFAULT_ORIGINS)
    .split(',').map((s) => s.trim()).filter(Boolean);
}

function originAllowed(origin, env) {
  if (!origin) return false;
  return origins(env).includes(origin) || LOCAL_ORIGIN.test(origin);
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function reply(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(origin ? cors(origin) : {}),
    },
  });
}

async function rateKey(ip) {
  const hour = Math.floor(Date.now() / 3600000);
  const bytes = new TextEncoder().encode(`${ip}:${hour}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

// true when the request may proceed. The IP itself is never stored: the KV key
// is a truncated hash of IP + current hour, expiring with the hour.
async function allowRequest(env, ip) {
  const key = await rateKey(ip);
  if (env.RATE?.get && env.RATE?.put) {
    const used = Number(await env.RATE.get(key)) || 0;
    if (used >= RATE_LIMIT) return false;
    await env.RATE.put(key, String(used + 1), { expirationTtl: 3700 });
    return true;
  }
  if (memory.size > 2000) memory.clear();
  const used = memory.get(key) ?? 0;
  if (used >= RATE_LIMIT) return false;
  memory.set(key, used + 1);
  return true;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '';

    if (request.method === 'OPTIONS') {
      return originAllowed(origin, env)
        ? new Response(null, { status: 204, headers: cors(origin) })
        : reply({ error: 'origin' }, 403, null);
    }
    if (request.method !== 'POST') {
      return reply({ error: 'method' }, 405, originAllowed(origin, env) ? origin : null);
    }
    if (!originAllowed(origin, env)) return reply({ error: 'origin' }, 403, null);

    const declared = Number(request.headers.get('Content-Length') ?? 0);
    if (declared > MAX_BODY_BYTES) return reply({ error: 'too large' }, 413, origin);

    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
      return reply({ error: 'too large' }, 413, origin);
    }

    let body;
    try { body = JSON.parse(text); } catch { return reply({ error: 'bad json' }, 400, origin); }

    // Honeypot: a real browser leaves this off-screen field empty.
    if (body && body.website) return reply({ ok: true }, 200, origin);

    const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
    if (!(await allowRequest(env, ip))) return reply({ error: 'rate' }, 429, origin);

    const check = validateReport(body);
    if (!check.ok) return reply({ error: check.error }, 400, origin);

    if (!env.GITHUB_TOKEN) return reply({ error: 'server' }, 500, origin);

    const repo = env.GITHUB_REPO ?? DEFAULT_REPO;
    const api = env.GITHUB_API_BASE ?? DEFAULT_API;
    const issue = {
      title: issueTitle(check.report),
      body: issueBody(check.report, {
        ua: (request.headers.get('User-Agent') ?? '').slice(0, 300),
        origin,
        at: new Date().toISOString(),
      }),
      labels: ['needs-triage'],
    };

    const res = await fetch(`${api}/repos/${repo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'neo3ds-report',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(issue),
    });
    if (!res.ok) return reply({ error: 'github' }, 502, origin);

    const created = await res.json();
    return reply({ ok: true, url: created.html_url, number: created.number }, 200, origin);
  },
};
