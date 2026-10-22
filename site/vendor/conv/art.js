// Art port (converter/Neo3dsConverter.Core/Art.cs).
// HOME icon 48x48 + banner 256x128. Browser: Canvas 2D. Node (test): pure-JS
// PNG writer (no fonts — geometry checks only; pixels are eyeball-compared).
// Per #31 decision 10: pixel-parity waived, spec (48x48, 256x128 PNG) + eyeball only.
// #75: a user picture goes through the same cover crop as C# Art.Fit.
import { crc32Bytes } from './job.js';

export const ICON_SIZE = 48, BANNER_W = 256, BANNER_H = 128;
const TOP = [20, 24, 40], BOTTOM = [120, 16, 24], GOLD = [232, 190, 80];

export function splitTitle(title) {
  const i = title.indexOf(' - ');
  if (i < 0) return [title, null];
  return [title.slice(0, i), title.slice(i + 3)];
}

const NUMBER_WORD = /^('?\d+|\d+(st|nd|rd|th)|[IVX]+|EX|DX|R|SP)$/i;
const SKIP_WORDS = new Set(['the', 'a', 'an']);

export function abbreviate(title) {
  const words = title.split(/\s+/).filter(Boolean);
  let numIdx = words.findIndex((w) => NUMBER_WORD.test(w.replace(/[.,:;!?'"]/g, '')));
  let number = null;
  let main = words;
  if (numIdx >= 0) {
    number = words[numIdx].replace(/^'/, '');
    main = words.slice(0, numIdx);
  }
  main = main.filter((w) => !SKIP_WORDS.has(w.toLowerCase()));
  let abbr = main.map((w) => w[0].toUpperCase()).join('');
  if (abbr.length < 3 && main.length > 0) {
    const last = main[main.length - 1].toUpperCase().replace(/[^A-Z]/g, '');
    abbr = (abbr + last).slice(0, 3);
  }
  return [abbr.slice(0, 3) || 'NEO', number];
}

function pngChunk(type, data) {
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, data.length);
  const td = new TextEncoder().encode(type);
  const crc = new Uint8Array(4);
  const both = new Uint8Array(td.length + data.length);
  both.set(td); both.set(data, td.length);
  new DataView(crc.buffer).setUint32(0, crc32Bytes(both));
  const out = new Uint8Array(12 + data.length);
  out.set(len); out.set(td, 4); out.set(data, 8); out.set(crc, 8 + data.length);
  return out;
}

// Minimal PNG encoder: 8-bit RGB, no filter, no compression (stored deflate blocks).
export function encodePng(w, h, rgb) {
  const stride = w * 3 + 1;
  const raw = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * stride + 1);
  }
  // zlib header + stored blocks (max 65535) + adler32
  const blocks = [];
  let s = 0;
  const adler = (() => {
    let a = 1, b = 0;
    for (let i = 0; i < raw.length; i++) { a = (a + raw[i]) % 65521; b = (b + a) % 65521; }
    return ((b << 16) | a) >>> 0;
  })();
  blocks.push(0x78, 0x01);
  for (let i = 0; i < raw.length; i += 65535) {
    const n = Math.min(65535, raw.length - i);
    const last = i + n >= raw.length ? 1 : 0;
    blocks.push(last, n & 0xFF, (n >> 8) & 0xFF, (~n) & 0xFF, ((~n) >> 8) & 0xFF);
    for (let k = 0; k < n; k++) blocks.push(raw[i + k]);
  }
  blocks.push((adler >> 24) & 0xFF, (adler >> 16) & 0xFF, (adler >> 8) & 0xFF, adler & 0xFF);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = 2;
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', new Uint8Array(blocks)), pngChunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return typeof Buffer !== "undefined" ? Buffer.from(out) : out;
}

function gradient(w, h, border, drawText) {
  // Shared pixel layout; browser draws text on canvas, node returns gradient+border only.
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const f = h <= 1 ? 0 : y / (h - 1);
    const r = Math.round(TOP[0] + (BOTTOM[0] - TOP[0]) * f);
    const g = Math.round(TOP[1] + (BOTTOM[1] - TOP[1]) * f);
    const b = Math.round(TOP[2] + (BOTTOM[2] - TOP[2]) * f);
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b;
    }
  }
  // Gold border (stroke width = border, centered like Skia DrawRect)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const bx = Math.min(x, w - 1 - x), by = Math.min(y, h - 1 - y);
      if (Math.min(bx, by) < border) {
        const o = (y * w + x) * 3;
        rgb[o] = GOLD[0]; rgb[o + 1] = GOLD[1]; rgb[o + 2] = GOLD[2];
      }
    }
  }
  return rgb;
}

function canCanvas() {
  return typeof document !== 'undefined' || typeof OffscreenCanvas !== 'undefined';
}

function makeCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    return cv;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}

// C# Art.Fit: scale = max(w/srcW, h/srcH), round the scaled size, then centre
// the overflow (dx/dy are negative where the picture is cropped).
export function coverRect(srcW, srcH, dstW, dstH) {
  if (!(srcW > 0 && srcH > 0 && dstW > 0 && dstH > 0))
    throw new RangeError('coverRect: source and target sizes must be positive');
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const dw = Math.round(srcW * scale), dh = Math.round(srcH * scale);
  return { dx: Math.round((dstW - dw) / 2), dy: Math.round((dstH - dh) / 2), dw, dh };
}

// Browser-only: draw a decoded picture (ImageBitmap/canvas) cover-cropped to
// w x h and return a single-IDAT PNG. Throws a clear error off-canvas.
export async function fitPng(source, w, h) {
  const cv = makeCanvas(w, h);
  if (!cv) throw new Error('Custom icon/banner needs a browser canvas (browser-only).');
  const cx = cv.getContext('2d');
  if (!cx) throw new Error('Custom icon/banner needs a 2D canvas (browser-only).');
  const srcW = source?.width, srcH = source?.height;
  if (!(srcW > 0 && srcH > 0)) throw new Error('Cannot decode image: the picture has no pixels.');
  const { dx, dy, dw, dh } = coverRect(srcW, srcH, w, h);
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = 'high';
  try {
    cx.drawImage(source, dx, dy, dw, dh);
  } catch (err) {
    throw new Error(`Cannot draw image: ${err?.message ?? err}`);
  }
  return canvasToBytes(cv);
}

export async function iconPng(title, image = null) {
  if (image) return fitPng(image, ICON_SIZE, ICON_SIZE);
  if (canCanvas()) return canvasIcon(title);
  return encodePng(ICON_SIZE, ICON_SIZE, gradient(ICON_SIZE, ICON_SIZE, 2));
}

export async function bannerPng(title, image = null) {
  if (image) return fitPng(image, BANNER_W, BANNER_H);
  if (canCanvas()) return canvasBanner(title);
  return encodePng(BANNER_W, BANNER_H, gradient(BANNER_W, BANNER_H, 4));
}

function baseCanvas(w, h, border) {
  const cv = makeCanvas(w, h);
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d');
  const grad = cx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, `rgb(${TOP})`);
  grad.addColorStop(1, `rgb(${BOTTOM})`);
  cx.fillStyle = grad;
  cx.fillRect(0, 0, w, h);
  cx.strokeStyle = `rgb(${GOLD})`;
  cx.lineWidth = border;
  cx.strokeRect(border / 2, border / 2, w - border, h - border);
  return [cv, cx];
}

function drawFitted(cx, text, weight, maxSize, x, y, w, h, color, maxLines) {
  for (let size = maxSize; ; size -= 0.5) {
    cx.font = `${weight} ${size}px Arial, sans-serif`;
    let lines = [text];
    if (maxLines > 1) {
      lines = [];
      for (const word of text.split(' ')) {
        const last = lines[lines.length - 1];
        if (last !== undefined && cx.measureText(last + ' ' + word).width <= w) lines[lines.length - 1] = last + ' ' + word;
        else lines.push(word);
      }
    }
    const lh = size * 1.2;
    const fits = lines.every((l) => cx.measureText(l).width <= w) && lines.length * lh <= h && lines.length <= maxLines;
    if (fits || size <= 6) {
      cx.fillStyle = color;
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      const sy = y + h / 2 - ((lines.length - 1) * lh) / 2;
      lines.forEach((l, i) => {
        cx.fillStyle = 'rgba(0,0,0,0.63)';
        cx.fillText(l, x + w / 2 + 1, sy + i * lh + 1);
        cx.fillStyle = color;
        cx.fillText(l, x + w / 2, sy + i * lh);
      });
      return;
    }
  }
}

async function canvasToBytes(cv) {
  const b = cv.convertToBlob
    ? await cv.convertToBlob({ type: 'image/png' })
    : await new Promise((resolve) => cv.toBlob(resolve, 'image/png'));
  return mergeIdat(new Uint8Array(await b.arrayBuffer()));
}

// Canvas toBlob emits split IDAT chunks, which the WASM stb_image in bannertool
// misreads (icon renders without text). Merge into a single IDAT.
export function mergeIdat(png) {
  const dv = new DataView(png.buffer, png.byteOffset, png.length);
  const td = new TextEncoder();
  const chunks = [];
  let o = 8;
  while (o + 8 <= png.length) {
    const len = dv.getUint32(o);
    const type = String.fromCharCode(png[o + 4], png[o + 5], png[o + 6], png[o + 7]);
    chunks.push({ type, data: png.subarray(o + 8, o + 8 + len) });
    o += 12 + len;
    if (type === 'IEND') break;
  }
  const idat = [];
  let idatLen = 0;
  for (const c of chunks) {
    if (c.type !== 'IDAT') continue;
    idat.push(c.data);
    idatLen += c.data.length;
  }
  if (idat.length <= 1) return png;
  const merged = new Uint8Array(idatLen);
  let w = 0;
  for (const d of idat) { merged.set(d, w); w += d.length; }
  const mk = (type, data) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    out.set(td.encode(type), 4);
    out.set(data, 8);
    const both = new Uint8Array(4 + data.length);
    both.set(td.encode(type));
    both.set(data, 4);
    v.setUint32(8 + data.length, crc32Bytes(both));
    return out;
  };
  const parts = [png.subarray(0, 8)];
  for (const c of chunks) {
    if (c.type === 'IDAT' || c.type === 'IEND') continue;
    parts.push(mk(c.type, c.data));
  }
  parts.push(mk('IDAT', merged));
  parts.push(mk('IEND', new Uint8Array(0)));
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let q = 0;
  for (const p of parts) { out.set(p, q); q += p.length; }
  return typeof Buffer !== 'undefined' ? Buffer.from(out) : out;
}

async function canvasIcon(title) {
  const [cv, cx] = baseCanvas(ICON_SIZE, ICON_SIZE, 2);
  const [abbr, number] = abbreviate(title);
  if (number == null) drawFitted(cx, abbr, 900, 22, 6, 6, 36, 36, '#fff', 1);
  else {
    drawFitted(cx, abbr, 900, 20, 5, 4, 38, 21, '#fff', 1);
    drawFitted(cx, number, 900, 20, 5, 24, 38, 20, `rgb(${GOLD})`, 1);
  }
  return canvasToBytes(cv);
}

async function canvasBanner(title) {
  const [cv, cx] = baseCanvas(BANNER_W, BANNER_H, 4);
  cx.font = '900 14px Arial, sans-serif';
  cx.fillStyle = `rgb(${GOLD})`;
  cx.textAlign = 'left';
  cx.fillText('NEO·GEO', 10, 8 + 11);
  const [main, sub] = splitTitle(title);
  let areaY = 30, areaH = BANNER_H - 40;
  if (sub != null) {
    drawFitted(cx, sub, 700, 16, 12, BANNER_H - 10 - 22, BANNER_W - 24, 22, `rgb(${GOLD})`, 1);
    areaH -= 24;
  }
  drawFitted(cx, main, 700, 40, 12, areaY, BANNER_W - 24, areaH, '#fff', 2);
  return canvasToBytes(cv);
}

export function silentWav() {
  // 0.5s 16-bit mono 22050Hz silence (Art.SaveSilentWav).
  const rate = 22050, n = rate >> 1;
  const buf = new Uint8Array(44 + n * 2);
  const dv = new DataView(buf.buffer);
  const ascii = (o, s) => { for (let i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i); };
  ascii(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  ascii(36, 'data'); dv.setUint32(40, n * 2, true);
  return typeof Buffer !== "undefined" ? Buffer.from(buf) : buf;
}
