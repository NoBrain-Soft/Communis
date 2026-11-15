// Small fetch wrapper: timeouts, size limits and readable error messages.
const UA = 'Mozilla/5.0 (compatible; Communis-OSINT/0.1)';

export class HttpError extends Error {
  constructor(status, url) {
    super(`${new URL(url).host} answered HTTP ${status}`);
    this.status = status;
  }
}

async function readLimited(res, max) {
  if (!res.body) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size >= max) { await reader.cancel().catch(() => {}); break; }
  }
  return Buffer.concat(chunks).subarray(0, max);
}

export const http = {
  /** Returns { status, headers, url, buf }. Throws HttpError unless the status is 2xx or listed in okStatuses. */
  async raw(url, opts = {}) {
    const host = new URL(url).host;
    let res;
    try {
      res = await fetch(url, {
        method: opts.method || 'GET',
        body: opts.body,
        redirect: 'follow',
        headers: { 'user-agent': UA, accept: '*/*', ...opts.headers },
        signal: AbortSignal.timeout(opts.timeout || 15000),
      });
    } catch (e) {
      if (e.name === 'TimeoutError') throw new Error(`Timed out contacting ${host}`);
      throw new Error(`Could not reach ${host} (${e.cause?.code || e.cause?.message || e.message})`);
    }
    if (!res.ok && !opts.okStatuses?.includes(res.status)) {
      await res.body?.cancel().catch(() => {});
      throw new HttpError(res.status, url);
    }
    let buf;
    try { buf = await readLimited(res, opts.maxBytes || 2_000_000); }
    catch { throw new Error(`Connection to ${host} was interrupted`); }
    return { status: res.status, headers: res.headers, url: res.url, buf };
  },

  async text(url, opts) {
    return (await this.raw(url, opts)).buf.toString('utf8');
  },

  /** Parsed JSON, or null when the status is a tolerated error status (e.g. okStatuses: [404]). */
  async json(url, opts = {}) {
    const r = await this.raw(url, { ...opts, headers: { accept: 'application/json', ...opts.headers } });
    if (r.status >= 400) return null;
    try { return JSON.parse(r.buf.toString('utf8')); }
    catch { throw new Error(`Unexpected (non-JSON) reply from ${new URL(url).host}`); }
  },
};
