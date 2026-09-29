class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (m) => new ApiError(400, m);
const forbidden = (m) => new ApiError(403, m || 'You do not have permission to do that.');
const notFound = (m) => new ApiError(404, m || 'Not found.');
const conflict = (m) => new ApiError(409, m);
// Wraps a handler so thrown ApiErrors become clean JSON responses.
const h = fn => (req, res, next) => {
  try { const r = fn(req, res, next); if (r && r.catch) r.catch(next); } catch (e) { next(e); }
};
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 500);
module.exports = { ApiError, bad, forbidden, notFound, conflict, h, str };
