// Landing-page report form (#189). The converter page links here and hands the
// failed run over in sessionStorage; the payload builder and the zip-name
// redaction stay in vendor/conv/report.js, shared with the converter page.
import { buildReport, fitPayload, PENDING_KEY } from './vendor/conv/report.js';
import { submitEvent, send as sendEvent } from './vendor/conv/analytics.js';

const $ = (id) => document.getElementById(id);
const isEn = () => document.documentElement.lang === 'en';
const t = (ko, en) => (isEn() ? en : ko);
const ENDPOINT = (document.querySelector('meta[name="neo3ds-report-endpoint"]')?.content ?? '').trim();
const form = $('reportForm');

async function converterVersion() {
  try {
    const mod = await import('./vendor/conv/version.js');
    return mod.CONVERTER_VERSION ?? null;
  } catch { return null; } // build product absent in local dev
}

if (form) {
  const typeSel = $('reportType');
  const msg = $('reportMsg');
  const sendBtn = $('reportSend');
  const link = $('reportLink');
  const text = $('reportText');
  let sending = false;
  let pending = null;

  // A failed conversion on the converter page left its (already redacted)
  // context here. Read once, then clear so a later visit starts clean.
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (raw) {
      pending = JSON.parse(raw);
      sessionStorage.removeItem(PENDING_KEY);
    }
  } catch { /* storage can be blocked */ }
  if (pending) {
    $('reportPending').classList.remove('hidden');
    typeSel.value = 'convert-fail';
  } else {
    typeSel.value = 'site-bug'; // the landing form is general feedback by default
  }
  text.placeholder = t('기대한 동작과 실제로 일어난 일을 적어 주세요.', 'What you expected, and what happened.');
  $('reportGame').placeholder = t('예: mslug', 'e.g. mslug');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending) return;
    const summary = text.value.trim();
    if (!summary) {
      msg.textContent = t('증상을 한 줄 이상 적어 주세요.', 'Describe the problem first.');
      text.focus();
      return;
    }
    if (!ENDPOINT) {
      msg.textContent = t('지금은 제보를 받을 수 없습니다.', 'Reporting is not available right now.');
      return;
    }
    // Guard before the first await: the version import may hit the network,
    // and a double click must not file two issues (#189).
    sending = true;
    sendBtn.disabled = true;
    link.classList.add('hidden');
    msg.textContent = t('보내는 중…', 'Sending…');
    try {
      const type = typeSel.value;
      const version = await converterVersion();
      const report = fitPayload(buildReport({
        type,
        summary,
        game: $('reportGame').value,
        mode: pending?.mode ?? null,
        version,
        failures: type === 'convert-fail' ? pending?.failures ?? [] : [],
        log: pending?.log ?? '',
        error: pending?.error ?? null,
        website: $('reportTrap').value,
      }));
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) throw new Error(data?.error ?? `HTTP ${res.status}`);
      sendEvent(window.umami, submitEvent());
      msg.textContent = t('접수되었습니다.', 'Sent.');
      link.href = data.url;
      link.textContent = `${t('이슈', 'issue')} #${data.number}`;
      link.classList.remove('hidden');
      text.value = '';
      $('reportPending').classList.add('hidden');
      pending = null;
    } catch (err) {
      msg.textContent = t(`보내지 못했습니다: ${err?.message ?? err}`, `Could not send: ${err?.message ?? err}`);
    } finally {
      sending = false;
      sendBtn.disabled = false;
    }
  });
}
