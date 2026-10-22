// ZIP bundling for the multi-game "download all" button (#81). Pure: no DOM,
// no File APIs, so Node tests can verify the exact entry names and bytes.
//
// The bundled files are finished CIA / .neo3ds outputs, already compressed, so
// they are stored as-is (level 0): deflating them again only costs time.
import { zipSync } from './fflate.js';

// Entry names come from row download names, but the bundler still refuses
// anything that could escape the archive or collide with another entry.
function checkName(name) {
  if (typeof name !== 'string' || name.length === 0)
    throw new Error('zipResults: entry name must be a non-empty string');
  if (name.startsWith('/') || name.startsWith('\\') || /^[A-Za-z]:/.test(name))
    throw new Error(`zipResults: entry name must be relative: ${name}`);
  if (name.includes('\\'))
    throw new Error(`zipResults: entry name must not contain backslashes: ${name}`);
  if (/[\u0000-\u001f]/.test(name))
    throw new Error(`zipResults: entry name must not contain control characters: ${JSON.stringify(name)}`);
  if (name.split('/').some((seg) => seg === '' || seg === '.' || seg === '..'))
    throw new Error(`zipResults: unsafe entry name: ${name}`);
  return name;
}

// entries: [{ name: string, bytes: Uint8Array }] → one ZIP (Uint8Array).
// Rejects an empty list, duplicate names, unsafe names and non-byte payloads.
export function zipResults(entries) {
  if (!Array.isArray(entries) || entries.length === 0)
    throw new Error('zipResults: at least one file is required');
  const files = Object.create(null); // __proto__-safe map for zipSync
  for (const entry of entries) {
    const name = checkName(entry?.name);
    if (Object.prototype.hasOwnProperty.call(files, name))
      throw new Error(`zipResults: duplicate entry name: ${name}`);
    if (!(entry.bytes instanceof Uint8Array))
      throw new Error(`zipResults: ${name} bytes must be a Uint8Array`);
    files[name] = entry.bytes;
  }
  return zipSync(files, { level: 0 });
}
