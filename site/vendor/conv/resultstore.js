// Finished results on disk (#387). Chrome caps the total size of the Blobs a
// page holds at ~2 GiB, so keeping one Blob per game meant a 159-game run
// (~7.5 GB) lost every result created after the first 2 GiB — not just the
// "download all" ZIP: the per-game links were unreadable too.
//
// This store writes each finished result into the Origin Private File System
// (OPFS) and hands back a File for it. A File is not a Blob the page allocates,
// so the quota applies to one game at a time, and ObjectURLs for the per-game
// links stay valid for the whole run.
//
// OPFS is available in Chrome, Edge, Firefox and Safari. Where it is missing or
// full, the store degrades to plain Blobs (the old behaviour) so conversion
// itself never fails because of storage.
//
// Pure-ish: takes an async storage root instead of reaching for navigator, so
// Node tests can drive it with an in-memory implementation.
//
// A run gets its own directory and supersedes the previous one, which is
// removed: the browser's quota is per origin, and a cancelled run's files would
// otherwise sit there forever.
const ROOT_DIR = 'neo3ds-results';

export class ResultStore {
  constructor({ root = null, dirName = ROOT_DIR } = {}) {
    this.root = root;
    this.dirName = dirName;
    this.state = { dir: null, files: new Map(), mode: root ? 'disk' : 'memory' };
    // Serializes begin() against put(): a result can arrive while the directory
    // is still being prepared, and the old directory must be gone by then.
    this.ready = Promise.resolve(this);
    this.queue = Promise.resolve();
  }

  get mode() { return this.state.mode; }

  // Starts a fresh run: drops the previous directory and everything tracked.
  begin() {
    this.state.files.clear();
    this.ready = this.#open();
    return this.ready;
  }

  async #open() {
    const root = await this.#root();
    if (!root) { this.state.mode = 'memory'; this.state.dir = null; return this; }
    try {
      await root.removeEntry(this.dirName, { recursive: true });
    } catch { /* nothing to remove */ }
    try {
      this.state.dir = await root.getDirectoryHandle(this.dirName, { create: true });
      this.state.mode = 'disk';
    } catch {
      // No OPFS (older browser), disabled storage, or a private window.
      this.state.dir = null;
      this.state.mode = 'memory';
    }
    return this;
  }

  async #root() {
    if (this.root !== null) return this.root || null;
    try {
      this.root = await navigator.storage?.getDirectory?.() ?? false;
    } catch {
      this.root = false;
    }
    return this.root || null;
  }

  // Keyed by row index: a re-run of the same row overwrites its file. Writes and
  // the directory swap run one at a time, so a slow disk never reorders them.
  async put(index, blob, name) {
    const run = this.queue.then(async () => {
      await this.ready;
      const file = await this.#write(index, blob);
      this.state.files.set(index, { file, name });
      return file;
    });
    this.queue = run.catch(() => {}); // one failure must not block the rest
    return run;
  }

  async #write(index, blob) {
    const dir = this.state.dir;
    if (!dir) return blob;
    try {
      const handle = await dir.getFileHandle(fileName(index), { create: true });
      const writable = await handle.createWritable();
      await blob.stream().pipeTo(writable);
      return await handle.getFile();
    } catch (err) {
      // A full disk must not lose the result the user just waited for: fall back
      // to the Blob the worker posted and record why.
      this.state.mode = 'memory';
      this.state.dir = null;
      this.state.error = String(err?.message ?? err);
      return blob;
    }
  }

  get(index) {
    return this.state.files.get(index) ?? null;
  }

  // Every stored result, in the given order, for the "download all" bundle.
  // `indexes` are row indexes; a row with no stored result is skipped.
  entries(indexes) {
    const out = [];
    for (const index of indexes) {
      const hit = this.get(index);
      if (!hit) continue;
      out.push({ name: hit.name, blob: hit.file });
    }
    return out;
  }

  // Every write has landed: the bundle must not start before the last game's
  // result is on disk.
  async settled() {
    await this.ready;
    await this.queue;
  }
}

// OPFS file names must be safe segments; the row index is all we need and the
// user's zip name never reaches the file system.
function fileName(index) {
  return `result-${String(index).padStart(4, '0')}.bin`;
}

// One store per page; a run starts a fresh directory on it.
export const results = new ResultStore();
