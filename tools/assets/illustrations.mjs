// Download only the registered full illustrations from pinned AKDP image ZIPs.
// HTTP ranges avoid downloading the entire character/skin archive for a small roster.
import { readFile, mkdir, writeFile, rename, open, stat, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { cachedJson } from './cache.mjs';
import { isCompletePng } from './formats.mjs';
import { guardDefaultFetch } from './env-proxy.mjs';
import { OPERATOR_ILLUSTRATIONS } from '../../public/sandbox/js/generated-illustrations.js';

const RELEASES = 'https://github.com/3aKHP/arknights-data-pipeline/releases/download/';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// A source without Range support can still supply the complete archive. Cache it
// on disk, then seek within it; do not hold a character archive in memory.
async function archiveFile(url, network) {
  const { root, mirrorPolicy, log, onBytes, offline } = network;
  const file = join(root, '.cache/asset-archives', `${hash(url).slice(0, 16)}.zip`);
  try { if ((await stat(file)).size >= 22) return file; } catch { /* not cached */ }
  if (offline) throw Error('image archive is not cached; run npm run assets online');
  await mkdir(dirname(file), { recursive: true });
  let failure;
  for (const source of mirrorPolicy.urls(url)) {
    if (mirrorPolicy.skip(source)) continue;
    const temp = `${file}.${randomUUID()}.part`;
    let handle, reader;
    try {
      log('[illustrations] Range unavailable; downloading and caching the full image ZIP');
      const response = await mirrorPolicy.request(source, guardDefaultFetch(globalThis.fetch), {}, 3600000);
      if (!response.ok || response.status === 206 || !response.body) {
        await response.body?.cancel();
        throw Error(`image archive HTTP ${response.status}`);
      }
      const expected = Number(response.headers.get('content-length')) || 0;
      if (expected > 2 * 1024 ** 3) { await response.body.cancel(); throw Error('image archive exceeds 2 GiB'); }
      handle = await open(temp, 'wx');
      reader = response.body.getReader();
      let size = 0;
      while (true) {
        let timer;
        const next = await Promise.race([
          reader.read(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(Error('image archive download stalled')), 60000); }),
        ]).finally(() => clearTimeout(timer));
        if (next.done) break;
        size += next.value.length;
        if (size > 2 * 1024 ** 3) throw Error('image archive exceeds 2 GiB');
        const chunk = Buffer.from(next.value);
        for (let written = 0; written < chunk.length;) {
          written += (await handle.write(chunk, written, chunk.length - written)).bytesWritten;
        }
        onBytes?.(chunk.length);
      }
      if (size < 22 || expected && size !== expected) throw Error('incomplete image archive');
      const tail = Buffer.alloc(Math.min(size, 65557));
      await handle.close();
      handle = await open(temp, 'r');
      await handle.read(tail, 0, tail.length, size - tail.length);
      let valid = false;
      for (let i = tail.length - 22; i >= 0; i--) {
        if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { valid = true; break; }
      }
      if (!valid) throw Error('image archive ZIP directory not found');
      await handle.close(); handle = null;
      await rename(temp, file);
      mirrorPolicy.succeeded(source);
      return file;
    } catch (error) {
      failure = error;
      mirrorPolicy.failed(source);
      try { await reader?.cancel(error); } catch { /* closed */ }
      await handle?.close(); handle = null;
      await rm(temp, { force: true });
      log(`[illustrations] ${error.message}; trying the next source`);
    } finally { reader?.releaseLock(); }
  }
  throw Error(`cannot download image archive: ${failure?.message || 'no available source'}`);
}

async function cachedRange(url, start, end, network, maxBytes) {
  if (!network.archives.has(url)) network.archives.set(url, archiveFile(url, network));
  const file = await network.archives.get(url);
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const offset = start < 0 ? Math.max(0, size + start) : start;
    const length = start < 0 ? size - offset : end - start + 1;
    if (length < 0 || length > maxBytes || offset + length > size) throw Error('invalid cached ZIP range');
    const bytes = Buffer.alloc(length);
    for (let n = 0; n < length;) {
      const got = (await handle.read(bytes, n, length - n, offset + n)).bytesRead;
      if (!got) throw Error('incomplete cached ZIP range');
      n += got;
    }
    return { bytes, offset };
  } finally { await handle.close(); }
}

async function range(url, start, end, network, maxBytes) {
  const { mirrorPolicy, log, onBytes } = network;
  if (network.offline || network.archives.has(url)) return cachedRange(url, start, end, network, maxBytes);
  let failure;
  for (const source of mirrorPolicy.urls(url)) {
    if (mirrorPolicy.skip(source)) continue;
    try {
      const response = await mirrorPolicy.request(source, guardDefaultFetch(globalThis.fetch), {
        headers: { Range: start < 0 ? `bytes=${start}` : `bytes=${start}-${end}` },
      }, 180000);
      if (response.status !== 206) {
        await response.body?.cancel();
        throw Error(`HTTP ${response.status}: source does not support partial ZIP downloads`);
      }
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
      if (!match || (start >= 0 && (Number(match[1]) !== start || Number(match[2]) !== end))) {
        await response.body?.cancel();
        throw Error('source returned a different ZIP range');
      }
      const bytes = await mirrorPolicy.readBody(source, response, maxBytes);
      if (bytes.length !== Number(match[2]) - Number(match[1]) + 1) throw Error('incomplete ZIP range');
      onBytes?.(bytes.length);
      mirrorPolicy.succeeded(source);
      return { bytes, offset: Number(match[1]) };
    } catch (error) {
      failure = error;
      mirrorPolicy.failed(source);
      log(`[illustrations] ${error.message}; trying the next source`);
    }
  }
  log(`[illustrations] partial download failed (${failure?.message || 'no available source'}); using the archive cache`);
  return cachedRange(url, start, end, network, maxBytes);
}

async function directory(url, network) {
  const tail = await range(url, -65557, null, network, 65557);
  let eocd = -1;
  for (let i = tail.bytes.length - 22; i >= 0; i--) {
    if (tail.bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.bytes.readUInt16LE(i + 20) === tail.bytes.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw Error('ZIP directory not found');
  const length = tail.bytes.readUInt32LE(eocd + 12), offset = tail.bytes.readUInt32LE(eocd + 16);
  if (length > 16 * 1024 * 1024 || offset === 0xffffffff) throw Error('unsupported image ZIP directory');
  const bytes = offset >= tail.offset ? tail.bytes.subarray(offset - tail.offset, offset - tail.offset + length)
    : (await range(url, offset, offset + length - 1, network, length)).bytes;
  const entries = new Map();
  for (let i = 0; i + 46 <= bytes.length;) {
    if (bytes.readUInt32LE(i) !== 0x02014b50) throw Error('invalid ZIP directory entry');
    const nameLength = bytes.readUInt16LE(i + 28), extraLength = bytes.readUInt16LE(i + 30), commentLength = bytes.readUInt16LE(i + 32);
    const name = bytes.subarray(i + 46, i + 46 + nameLength).toString('utf8').split('/').pop();
    const entry = { method: bytes.readUInt16LE(i + 10), packed: bytes.readUInt32LE(i + 20), size: bytes.readUInt32LE(i + 24), offset: bytes.readUInt32LE(i + 42) };
    const list = entries.get(name) || [];
    list.push(entry);
    entries.set(name, list);
    i += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function imageBytes(url, entry, network) {
  if (entry.packed > 32 * 1024 * 1024 || entry.size > 32 * 1024 * 1024 || ![0, 8].includes(entry.method)) throw Error('unsupported image ZIP entry');
  const header = (await range(url, entry.offset, entry.offset + 29, network, 30)).bytes;
  if (header.readUInt32LE(0) !== 0x04034b50) throw Error('invalid image ZIP header');
  const start = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  const packed = (await range(url, start, start + entry.packed - 1, network, entry.packed)).bytes;
  const bytes = entry.method === 8 ? inflateRawSync(packed, { maxOutputLength: entry.size }) : packed;
  if (bytes.length !== entry.size) throw Error('incomplete image ZIP entry');
  return bytes;
}

/** Uses the committed provenance and framing registry; never regenerates operator or combat data. */
export async function fetchIllustrations(root, { offline = false, keepExisting = false, log = console.log, ...network } = {}) {
  const provenance = JSON.parse(await readFile(join(root, 'art/operator-illustrations.json'), 'utf8'));
  const result = { files: [], chars: {}, errors: [], downloadedBytes: 0 };
  const pending = [];
  for (const [id, source] of Object.entries(provenance.operators)) {
    const url = OPERATOR_ILLUSTRATIONS[id]?.url;
    if (!/^\/assets\/char\/illust\/[a-z0-9_]+\.png$/.test(url || '') || !source.artwork) continue;
    const file = join(root, 'public', url.slice(1));
    try {
      const existing = await readFile(file);
      if (hash(existing) === source.sha256) {
        result.files.push(url.slice('/assets/'.length));
        result.chars[id] = url;
        continue;
      }
      if (keepExisting) {
        result.errors.push(`${id}: existing image differs from provenance; kept because --add-only is enabled`);
        continue;
      }
    } catch { /* The missing image is downloaded below. */ }
    pending.push({ id, source, url, file });
  }
  if (!pending.length) return result;
  log(`[illustrations] ${pending.length} full illustrations to download`);
  try {
    const index = await cachedJson({ ...network, offline, log,
      cacheFile: join(root, '.cache/operator-illustrations/index.json'),
      url: `${RELEASES}images-${provenance.version}/index.json`,
      validate: json => { if (json.currentVersion !== provenance.version || !json.artworks || !json.shards) throw Error('image index version mismatch'); },
    });
    const transfer = { ...network, root, offline, archives: new Map(), log, onBytes: n => { result.downloadedBytes += n; } };
    const directories = new Map();
    for (const job of pending) {
      try {
        const row = index.artworks[job.source.artwork];
        if (row?.large?.file !== job.source.file || row.large.sha256 !== job.source.sha256) throw Error('illustration provenance mismatch');
        const baseline = row.sinceVersion === index.baselineVersion;
        const archive = baseline ? index.shards[`${row.shard}-large`] : `images-delta-${row.sinceVersion}.zip`;
        if (!archive) throw Error('image archive missing from index');
        const url = `${RELEASES}images-${baseline ? 'baseline-' + index.baselineVersion : row.sinceVersion}/${archive}`;
        if (!directories.has(url)) directories.set(url, directory(url, transfer));
        const entries = await directories.get(url);
        const candidates = entries.get(job.source.file) || [];
        let bytes;
        for (const entry of candidates) {
          const candidate = await imageBytes(url, entry, transfer);
          if (hash(candidate) === job.source.sha256 && isCompletePng(candidate)) { bytes = candidate; break; }
        }
        if (!bytes) throw Error('image missing or SHA-256 mismatch');
        await mkdir(dirname(job.file), { recursive: true });
        const temp = `${job.file}.${randomUUID()}.tmp`;
        await writeFile(temp, bytes);
        await rename(temp, job.file);
        result.files.push(job.url.slice('/assets/'.length));
        result.chars[job.id] = job.url;
        log(`[illustrations] ${job.id}`);
      } catch (error) { result.errors.push(`${job.id}: ${error.message}`); }
    }
  } catch (error) { result.errors.push(error.message); }
  return result;
}
