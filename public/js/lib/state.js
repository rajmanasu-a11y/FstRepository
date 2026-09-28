/** Session state shared across pages. */
export const session = {
  user: null,
  csrfToken: null,
  settings: null,
  masters: null,
};

export const can = (perm) => Boolean(session.user?.permissions?.includes(perm));
export const canAny = (...perms) => perms.some(can);

export function setSession({ user, csrfToken, settings }) {
  session.user = user;
  session.csrfToken = csrfToken;
  session.settings = settings;
}

export function clearSession() {
  session.user = null;
  session.csrfToken = null;
  session.settings = null;
  session.masters = null;
}

export const org = () => session.settings?.organisation || {};
export const tz = () => org().timezone || 'UTC';
