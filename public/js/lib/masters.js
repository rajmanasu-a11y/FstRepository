import { api } from './api.js';
import { session } from './state.js';

/** Dropdown masters (departments, categories, purposes, access areas, ID types), cached per session. */
export async function getMasters({ refresh = false } = {}) {
  if (!session.masters || refresh) session.masters = await api('/masters');
  return session.masters;
}

export function invalidateMasters() { session.masters = null; }
