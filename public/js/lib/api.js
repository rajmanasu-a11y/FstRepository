import { session } from './state.js';

export const GENERIC_ERROR = 'Unable to complete the request. Please try again or contact the system administrator.';

export class ApiError extends Error {
  constructor(status, { code, message, fields, details, reference } = {}) {
    super(message || GENERIC_ERROR);
    this.status = status;
    this.code = code;
    this.fields = fields || null;
    this.details = details || null;
    this.reference = reference || null;
  }
}

let onUnauthenticated = () => {};
export function setUnauthenticatedHandler(fn) { onUnauthenticated = fn; }

function buildUrl(path, query) {
  const url = new URL(`/api${path}`, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
      url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
  }
  return url;
}

/**
 * JSON API call. Throws ApiError with a user-facing message; technical
 * details never reach the UI.
 */
export async function api(path, { method = 'GET', body, query, signal, form } = {}) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET' && session.csrfToken) headers['X-CSRF-Token'] = session.csrfToken;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(buildUrl(path, query), { method, headers, body: payload, signal, credentials: 'same-origin' });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, { code: 'NETWORK', message: 'Unable to reach the server. Please check the network connection and try again.' });
  }
  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error || { message: GENERIC_ERROR });
    if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthenticated(err);
    if (data?.visit) err.visit = data.visit;
    throw err;
  }
  return data;
}

/** Download a server-generated file (exports) while keeping error handling. */
export async function download(path, query) {
  const res = await fetch(buildUrl(path, query), { credentials: 'same-origin' });
  if (!res.ok) {
    let info = {};
    try { info = (await res.json()).error || {}; } catch { /* ignore */ }
    if (res.status === 401) onUnauthenticated(new ApiError(401, info));
    throw new ApiError(res.status, info);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] || 'download';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return name;
}

export const apiUrl = (path, query) => buildUrl(path, query).toString();
