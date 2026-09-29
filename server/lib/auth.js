const crypto = require('crypto');
const { db, now, uid } = require('../db');

/* ---- password hashing: scrypt (built-in, memory-hard) ---- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return 's1$' + salt.toString('base64') + '$' + hash.toString('base64');
}
function verifyPassword(pw, stored) {
  try {
    const [v, s, h] = stored.split('$');
    if (v !== 's1') return false;
    const expected = Buffer.from(h, 'base64');
    const got = crypto.scryptSync(pw, Buffer.from(s, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(got, expected);
  } catch (e) { return false; }
}
// Constant-time dummy check so "no such user" costs the same as "wrong password".
const DUMMY = hashPassword('dummy-password-for-timing');

/* ---- sessions: random token in an HttpOnly cookie, only its hash stored ---- */
const COOKIE = 'oes_sid';
const IDLE_MS = 2 * 60 * 60 * 1000;          // 2h idle
const ABS_MS = { student: 12, lecturer: 12, admin: 8 }; // hours, absolute
const sha = t => crypto.createHash('sha256').update(t).digest('hex');

function createSession(res, user) {
  const token = crypto.randomBytes(32).toString('base64url');
  const abs = (ABS_MS[user.role] || 8) * 3600 * 1000;
  db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,last_seen,expires_at) VALUES(?,?,?,?,?)')
    .run(sha(token), user.id, now(), now(), new Date(Date.now() + abs).toISOString());
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: abs, path: '/'
  });
}
function destroySession(req, res) {
  const t = req.cookies && req.cookies[COOKIE];
  if (t) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(t));
  res.clearCookie(COOKIE, { path: '/' });
}
function destroyUserSessions(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
}

/* ---- middleware ---- */
function loadUser(req, res, next) {
  const t = req.cookies && req.cookies[COOKIE];
  req.user = null;
  if (!t) return next();
  const s = db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(sha(t));
  if (!s) return next();
  const t0 = Date.now();
  if (new Date(s.expires_at).getTime() < t0 || new Date(s.last_seen).getTime() + IDLE_MS < t0) {
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(s.token_hash);
    return next();
  }
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id);
  if (!u || u.status !== 'active') return next();
  db.prepare('UPDATE sessions SET last_seen=? WHERE token_hash=?').run(now(), s.token_hash);
  req.user = u;
  next();
}
const requireAuth = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: 'Please log in.' });
const requireRole = (...roles) => (req, res, next) =>
  !req.user ? res.status(401).json({ error: 'Please log in.' })
  : roles.includes(req.user.role) ? next()
  : res.status(403).json({ error: 'You do not have permission to do that.' });

// CSRF: cookies are SameSite=Strict; additionally every state-changing request
// must carry a custom header (which cross-site forms cannot set) and, if an
// Origin header is present, it must match the host.
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'oes') return res.status(403).json({ error: 'Blocked (missing CSRF header).' });
  const origin = req.get('origin');
  if (origin) {
    try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Blocked (bad origin).' }); }
    catch (e) { return res.status(403).json({ error: 'Blocked (bad origin).' }); }
  }
  next();
}

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, matric: u.matric, staffId: u.staff_id, level: u.level, department: u.department, status: u.status };
}

module.exports = { hashPassword, verifyPassword, DUMMY, createSession, destroySession, destroyUserSessions,
  loadUser, requireAuth, requireRole, csrfGuard, publicUser };
