// Express 5 forwards rejected promises to the error handler automatically;
// this helper is kept for explicitness in route modules.
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
