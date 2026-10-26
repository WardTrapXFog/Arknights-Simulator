// SI 静态服务的监听地址与日志配置。
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_BIND_HOST = '::';
export const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

export function listenAddress(opts = {}) {
  const port = opts.port ?? (process.env.PORT != null && process.env.PORT !== '' ? Number(process.env.PORT) : 3100);
  const host = (opts.host || process.env.HOST) || DEFAULT_BIND_HOST;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError(`invalid PORT ${port}`);
  return { port, host };
}

export function bindCandidates(host) {
  return host === DEFAULT_BIND_HOST ? [DEFAULT_BIND_HOST, '0.0.0.0'] : [host];
}

export function makeLogger(quiet) {
  if (quiet) return noopLog;
  return {
    info: (...args) => console.log(...args),
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args),
    debug: process.env.DEBUG ? (...args) => console.debug(...args) : () => {},
  };
}
