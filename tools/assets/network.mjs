// Explicit download-source selection and one shared policy per asset invocation.
// Selecting a source never looks up the user's public IP or makes a request.
import { downloadUrls, normalizeProxyPrefix } from './sources.mjs';

export function validateSource(mode) {
  if (!['direct', 'mirror'].includes(mode)) throw new Error(`unknown asset source: ${mode} (direct|mirror)`);
  return mode;
}

export async function selectDownloadSource({ mode = 'direct', offline = false, proxyPrefix, log = console.log, verified = false } = {}) {
  validateSource(mode);
  if (offline) return 'direct';
  const normalizedProxy = mode === 'mirror' ? normalizeProxyPrefix(proxyPrefix) : '';
  log(mode === 'mirror'
    ? `[network] jsDelivr CDN 优先；${normalizedProxy ? `用户配置的 GitHub 代理：${normalizedProxy}` : '未配置通用 GitHub 代理，CDN 不覆盖的下载使用原始源'}；${verified ? '原始文件校验 Git blob。' : '文件按下载流程校验。'}`
    : '[network] 原始源优先，保留 jsDelivr 回退；未开启通用 GitHub 代理');
  return mode;
}

/** Shared by indexes, files, Spine follow-ups and fonts; a tripped mirror stays off. */
export class MirrorPolicy {
  constructor({ source = 'direct', proxyPrefix, failureLimit = 3, timeoutMs = 8000, log = console.log } = {}) {
    this.source = validateSource(source);
    this.proxyPrefix = this.source === 'mirror' ? normalizeProxyPrefix(proxyPrefix) : '';
    this.failureLimit = Math.max(1, Number(failureLimit) || 3);
    this.timeoutMs = Math.max(1, Number(timeoutMs) || 8000);
    this.log = log;
    this.failures = 0;
    this.disabled = false;
    this.hintShown = false;
    this.abortMirror = new AbortController();
  }

  urls(url) {
    return downloadUrls(url, { source: this.disabled ? 'direct' : this.source, proxyPrefix: this.proxyPrefix });
  }

  isProxy(url) {
    return this.source === 'mirror' && !!this.proxyPrefix && url.startsWith(this.proxyPrefix);
  }

  isMirror(url) {
    return this.isProxy(url) || this.source === 'mirror' && url.startsWith('https://cdn.jsdelivr.net/gh/');
  }

  skip(url) { return this.isMirror(url) && this.disabled; }

  async request(url, fetchImpl, options = {}, timeoutMs = 120000) {
    if (!this.isMirror(url)) {
      return fetchImpl(url, { ...options, signal: options.signal ?? AbortSignal.timeout(timeoutMs) });
    }
    const headerDeadline = new AbortController();
    const signal = AbortSignal.any([headerDeadline.signal, this.abortMirror.signal]);
    const timer = setTimeout(() => headerDeadline.abort(new Error('GitHub mirror response headers timed out')), Math.min(timeoutMs, this.timeoutMs));
    try {
      return await fetchImpl(url, { ...options, signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async readBody(url, response, maxBytes = Infinity) {
    if (Number(response.headers?.get('content-length')) > maxBytes) {
      await response.body?.cancel();
      throw new Error(`JSON exceeds ${maxBytes} bytes`);
    }
    if (!this.isMirror(url) && !Number.isFinite(maxBytes)) return Buffer.from(await response.arrayBuffer());
    if (!response.body) return Buffer.alloc(0);
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) { // loop-cap: response EOF, maxBytes for bounded JSON, and body idle deadline
        const { value, done } = this.isMirror(url)
          ? await readChunk(reader, this.timeoutMs, this.abortMirror.signal)
          : await readChunk(reader, this.timeoutMs);
        if (done) break;
        const chunk = Buffer.from(value);
        size += chunk.length;
        if (size > maxBytes) throw new Error(`JSON exceeds ${maxBytes} bytes`);
        chunks.push(chunk);
      }
    } catch (error) {
      try { await reader.cancel(error); } catch { /* ignore */ }
      throw error;
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks, size);
  }

  succeeded(url) {
    // A success from a request already in flight must not reopen a tripped circuit.
    if (this.isMirror(url) && !this.disabled) this.failures = 0;
  }

  failed(url) {
    if (this.isMirror(url)) {
      if (this.disabled || ++this.failures < this.failureLimit) return;
      this.disabled = true;
      this.log(`[network] 下载镜像连续失败 ${this.failures} 次：本次运行停用 CDN 与转发代理，继续使用原始源。`);
      this.abortMirror.abort(new Error('GitHub mirror disabled for this run'));
    }
  }

  directFailureHint() {
    if (this.source !== 'direct' || this.hintShown) return;
    this.hintShown = true;
    this.log('[network] 原始源下载失败；可用 --asset-source=mirror 优先尝试 jsDelivr CDN；CDN 未覆盖的下载需可用的本机代理。');
  }
}

function readChunk(reader, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => { cleanup(); reject(signal.reason ?? new Error('GitHub mirror request aborted')); };
    if (signal?.aborted) return onAbort();
    timer = setTimeout(() => { cleanup(); reject(new Error(`GitHub mirror response body idle for ${timeoutMs} ms`)); }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    reader.read().then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
  });
}
