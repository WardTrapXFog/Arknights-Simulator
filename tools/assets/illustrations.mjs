// Download only the registered full illustrations from pinned AKDP image ZIPs.
// HTTP ranges avoid downloading the entire character/skin archive for a small roster.
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { cachedJson } from './cache.mjs';
import { isCompletePng } from './formats.mjs';
import { guardDefaultFetch } from './env-proxy.mjs';
import { OPERATOR_ILLUSTRATIONS } from '../../public/sandbox/js/generated-illustrations.js';

const RELEASES = 'https://github.com/3aKHP/arknights-data-pipeline/releases/download/';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function range(url, start, end, { mirrorPolicy, log, onBytes }, maxBytes) {
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
  throw Error(`cannot read ${url}: ${failure?.message || 'no available source'}`);
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
    const transfer = { ...network, log, onBytes: n => { result.downloadedBytes += n; } };
    const directories = new Map();
    for (const job of pending) {
      try {
        if (offline) throw Error('not available offline; run npm run assets online to download');
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
