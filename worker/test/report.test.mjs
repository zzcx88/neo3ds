// Worker contract tests (#188). Pure validation/rendering plus the fetch
// handler with a stubbed GitHub API and a fake KV namespace.
import test from 'node:test';
import assert from 'node:assert/strict';

import { issueBody, issueTitle, validateReport } from '../src/report.js';
import worker from '../src/index.js';
import { GameDb } from '../../site/vendor/conv/gamedb.js';

const ORIGIN = 'https://zzcx88.github.io';

const payload = (extra = {}) => ({
  type: 'convert-fail',
  summary: 'KOF 98 converts but the game hangs on the title screen.',
  game: null,
  mode: 'cia',
  version: '1.3.2',
  failures: [{ set: 'kof98h', title: "KOF '98", code: 'image', stage: 'art' }],
  log: '  1.2s #1 kof98h [1/4] Checking romset',
  error: 'banner failed',
  ...extra,
});

function kv() {
  const map = new Map();
  return {
    async get(key) { return map.get(key) ?? null; },
    async put(key, value) { map.set(key, value); },
    size: () => map.size,
  };
}

function request(body, { origin = ORIGIN, ip = '203.0.113.9', method = 'POST', raw } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin) headers.Origin = origin;
  if (ip) headers['CF-Connecting-IP'] = ip;
  return new Request('https://report.example/', {
    method,
    headers,
    body: method === 'POST' ? (raw ?? JSON.stringify(body)) : undefined,
  });
}

async function withFetch(stub, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try { return await fn(); } finally { globalThis.fetch = original; }
}

const env = (extra = {}) => ({ GITHUB_TOKEN: 'test-token', RATE: kv(), ...extra });

test('validateReport: unknown type is rejected', () => {
  assert.deepEqual(validateReport(payload({ type: 'bogus' })), { ok: false, error: 'type' });
});

test('validateReport: empty summary is rejected', () => {
  assert.deepEqual(validateReport(payload({ summary: '   ' })), { ok: false, error: 'summary' });
});

test('validateReport: keeps catalog names, drops zip names and extras', () => {
  const check = validateReport(payload({
    failures: [
      { set: 'kof98h', title: "KOF '98", code: 'image', stage: 'art', name: 'kof98.zip' },
      { set: 'not a set', title: '', code: 'BAD CODE', stage: 'art' },
      { name: 'only-a-zip.zip' },
    ],
    website: 'bot',
    secret: 'drop me',
  }));
  assert.equal(check.ok, true);
  assert.equal(check.report.website, undefined);
  assert.equal(check.report.secret, undefined);
  assert.equal(check.report.failures.length, 1);
  assert.deepEqual(check.report.failures[0], { set: 'kof98h', title: "KOF '98", code: 'image', stage: 'art' });
});

test('validateReport: truncation keeps the newest log lines', () => {
  const log = 'HEAD\n' + 'x'.repeat(45000) + '\nTAIL';
  const report = validateReport(payload({ log })).report;
  assert.equal(report.log.length, 40000);
  assert.equal(report.log.endsWith('TAIL'), true);
  assert.equal(report.log.includes('HEAD'), false);
});

test('issueTitle: type prefix and one-line summary', () => {
  const title = issueTitle(validateReport(payload()).report);
  assert.equal(title.startsWith('[제보] 변환 실패: '), true);
  assert.equal(title.includes('\n'), false);
});

test('issueBody: failure table, fences and request metadata', () => {
  const report = validateReport(payload({ log: 'a ~~~ b' })).report;
  const body = issueBody(report, { ua: 'Mozilla/5.0', origin: ORIGIN, at: '2026-10-30T00:00:00Z' });
  assert.match(body, /\| kof98h \| image \| art \| KOF '98 \|/);
  assert.match(body, /브라우저: Mozilla\/5\.0/);
  assert.match(body, /보낸 페이지: https:\/\/zzcx88\.github\.io/);
  assert.equal(body.includes('~~~ b'), false, 'user text must not close the log fence');
});

test('issueBody: every failed game keeps its own reason', () => {
  const report = validateReport(payload({
    failures: [
      { set: 'mslug', title: 'Metal Slug', code: 'bios', stage: 'load' },
      { set: 'svc', title: 'SVC Chaos', code: 'oom', stage: 'romfs' },
      { set: 'kof98h', title: "KOF '98", code: 'crash', stage: 'worker' },
    ],
  })).report;
  const body = issueBody(report, {});
  assert.match(body, /## 실패한 게임 \(3\)/);
  assert.match(body, /\| mslug \| bios \| load \| Metal Slug \|/);
  assert.match(body, /\| svc \| oom \| romfs \| SVC Chaos \|/);
  assert.match(body, /\| kof98h \| crash \| worker \| KOF '98 \|/);
});

test('validateReport: BIOS keeps known slots and drops unknown names', () => {
  const check = validateReport(payload({
    bios: {
      present: true,
      error: null,
      aes: [{ name: 'neo-epo.bin', region: 'Europe/Asia' }, { name: 'kof98.zip', region: 'Europe/Asia' }],
      mvs: [{ name: 'sp-s2.sp1', region: '<script>' }, { name: 'sp-s2.sp1', region: 'Japan' }],
      sfix: 'nope',
      lo: 'ok',
      secret: 'drop me',
    },
  }));
  assert.equal(check.ok, true);
  assert.deepEqual(check.report.bios, {
    present: true,
    error: null,
    aes: [{ name: 'neo-epo.bin', region: 'Europe/Asia' }],
    mvs: [{ name: 'sp-s2.sp1', region: 'Japan' }],
    sfix: 'missing',
    lo: 'ok',
  });
  assert.equal(check.report.secret, undefined);
});

test('validateReport: BIOS absent and unreadable keep only their state', () => {
  const none = validateReport(payload({ bios: { present: false, aes: [{ name: 'neo-epo.bin', region: 'Japan' }] } }));
  assert.deepEqual(none.report.bios, { present: false });
  const bad = validateReport(payload({ bios: { present: true, error: 'zip', mvs: [{ name: 'sp-s2.sp1', region: 'Japan' }] } }));
  assert.deepEqual(bad.report.bios, { present: true, error: 'zip' });
});

test('validateReport: BIOS allow-list covers every GameDb chip', () => {
  for (const chip of GameDb.BIOS) {
    const check = validateReport(payload({
      bios: { present: true, error: null, aes: [{ name: chip.name, region: 'Europe/Asia' }], mvs: [], sfix: 'ok', lo: 'ok' },
    }));
    assert.equal(check.report.bios.aes.length, 1, chip.name);
  }
});

test('issueBody: BIOS table shows AES/MVS and sfix/lo', () => {
  const report = validateReport(payload({
    bios: {
      present: true,
      error: null,
      aes: [{ name: 'neo-epo.bin', region: 'Europe/Asia' }],
      mvs: [{ name: 'sp-s2.sp1', region: 'Japan' }],
      sfix: 'missing',
      lo: 'ok',
    },
  })).report;
  const body = issueBody(report, {});
  assert.match(body, /## BIOS \(neogeo\.zip\)/);
  assert.match(body, /\| AES \| neo-epo\.bin \(Europe\/Asia\) \|/);
  assert.match(body, /\| MVS \| sp-s2\.sp1 \(Japan\) \|/);
  assert.match(body, /\| sfix\.sfix \| missing \|/);
  assert.match(body, /\| 000-lo\.lo \| ok \|/);
});

test('issueBody: BIOS not dropped and unreadable are one line', () => {
  const none = issueBody(validateReport(payload({ bios: { present: false } })).report, {});
  assert.match(none, /- BIOS: not dropped/);
  const bad = issueBody(validateReport(payload({ bios: { present: true, error: 'zip' } })).report, {});
  assert.match(bad, /- BIOS: unreadable/);
});

test('handler: foreign origin is rejected', async () => {
  const res = await worker.fetch(request(payload(), { origin: 'https://evil.example' }), env());
  assert.equal(res.status, 403);
});

test('handler: preflight from an allowed origin succeeds', async () => {
  const res = await worker.fetch(request(null, { method: 'OPTIONS' }), env());
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('handler: honeypot is a silent 200 and files nothing', async () => {
  let calls = 0;
  await withFetch(async () => { calls++; return new Response('{}'); }, async () => {
    const res = await worker.fetch(request(payload({ website: 'http://spam' }), { ip: '198.51.100.1' }), env());
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });
  assert.equal(calls, 0);
});

test('handler: oversized body is rejected', async () => {
  const res = await worker.fetch(request(null, { raw: 'x'.repeat(70 * 1024), ip: '198.51.100.2' }), env());
  assert.equal(res.status, 413);
});

test('handler: sixth request from one IP in an hour is limited', async () => {
  const e = env();
  const ip = '198.51.100.3';
  await withFetch(async () => new Response(JSON.stringify({ html_url: 'u', number: 1 }), { status: 201 }), async () => {
    for (let i = 0; i < 5; i++) {
      const res = await worker.fetch(request(payload(), { ip }), e);
      assert.equal(res.status, 200, `request ${i + 1}`);
    }
    const res = await worker.fetch(request(payload(), { ip }), e);
    assert.equal(res.status, 429);
  });
});

test('handler: creates one needs-triage issue and returns its URL', async () => {
  let seen = null;
  const e = env();
  await withFetch(async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({ html_url: 'https://github.com/zzcx88/neo3ds/issues/999', number: 999 }), { status: 201 });
  }, async () => {
    const res = await worker.fetch(request(payload(), { ip: '198.51.100.4' }), e);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, url: 'https://github.com/zzcx88/neo3ds/issues/999', number: 999 });
  });
  assert.equal(seen.url, 'https://api.github.com/repos/zzcx88/neo3ds/issues');
  assert.equal(seen.init.headers.Authorization, 'Bearer test-token');
  const sent = JSON.parse(seen.init.body);
  assert.deepEqual(sent.labels, ['needs-triage']);
  assert.match(sent.title, /^\[제보\] 변환 실패: /);
  assert.match(sent.body, /\| kof98h \| image \| art \|/);
});

test('handler: GitHub failure becomes 502 without leaking the token', async () => {
  const e = env();
  await withFetch(async () => new Response('nope', { status: 500 }), async () => {
    const res = await worker.fetch(request(payload(), { ip: '198.51.100.5' }), e);
    assert.equal(res.status, 502);
    const body = await res.text();
    assert.equal(body.includes('test-token'), false);
  });
});

test('handler: missing token is a server error, not a filed issue', async () => {
  let calls = 0;
  await withFetch(async () => { calls++; return new Response('{}'); }, async () => {
    const res = await worker.fetch(request(payload(), { ip: '198.51.100.6' }), { RATE: kv() });
    assert.equal(res.status, 500);
  });
  assert.equal(calls, 0);
});
