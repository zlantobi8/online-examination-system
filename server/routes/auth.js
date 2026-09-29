const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { db, now, uid, audit } = require('../db');
const A = require('../lib/auth');
const { h, bad, str } = require('../lib/util');

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' } });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many sign-ups from this address. Try again later.' } });

// Institution-specific format; override with MATRIC_PATTERN in the environment.
const MATRIC_RE = new RegExp(process.env.MATRIC_PATTERN || '^[A-Z]{2,6}/[A-Z]{1,6}/\\d{2}/\\d-\\d{3,5}$', 'i');
const LEVELS = ['ND I', 'ND II', 'HND I', 'HND II'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw bad('Password must be at least 8 characters.');
  if (pw.length > 200) throw bad('Password is too long.');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw bad('Password must contain both letters and numbers.');
}

router.post('/login', loginLimiter, h((req, res) => {
  const email = str(req.body.email, 200).toLowerCase();
  const password = String(req.body.password || '');
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!u) { A.verifyPassword(password, A.DUMMY); return res.status(401).json({ error: 'Incorrect email or password.' }); }
  if (u.locked_until && new Date(u.locked_until) > new Date())
    return res.status(429).json({ error: 'Account temporarily locked after repeated failures. Try again later.' });
  if (!A.verifyPassword(password, u.password_hash)) {
    const n = u.failed_logins + 1;
    const lock = n >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
    db.prepare('UPDATE users SET failed_logins=?, locked_until=? WHERE id=?').run(lock ? 0 : n, lock, u.id);
    if (lock) audit(u.id, 'ACCOUNT_LOCKED', 'user', u.id);
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  if (u.status !== 'active') return res.status(403).json({ error: 'This account is not active. Contact the administrator.' });
  db.prepare('UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=?').run(u.id);
  A.createSession(res, u);
  audit(u.id, 'LOGIN', 'user', u.id);
  res.json({ user: A.publicUser(u) });
}));

router.post('/logout', h((req, res) => { A.destroySession(req, res); res.json({ ok: true }); }));

router.get('/departments', h((req, res) => {
  res.json(db.prepare("SELECT id,name FROM departments WHERE status='active' ORDER BY name").all());
}));

router.get('/me', h((req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in.' });
  res.json({ user: A.publicUser(req.user) });
}));

// Public sign-up creates a STUDENT account only. No course selection here —
// course registration is a separate, controlled workflow.
router.post('/register', registerLimiter, h((req, res) => {
  const name = str(req.body.name, 120), email = str(req.body.email, 200).toLowerCase();
  const matric = str(req.body.matric, 40).toUpperCase(), level = str(req.body.level, 20), department = str(req.body.department, 100);
  if (name.length < 3) throw bad('Enter your full name.');
  if (!EMAIL_RE.test(email)) throw bad('Enter a valid email address.');
  if (!MATRIC_RE.test(matric)) throw bad('Matriculation number is not in the expected format (e.g. FPA/CS/24/3-0254).');
  if (!LEVELS.includes(level)) throw bad('Select your level.');
  if (department.length < 2) throw bad('Select your department.');
  if (!db.prepare("SELECT 1 FROM departments WHERE name=? AND status='active'").get(department)) throw bad('Choose a department from the list.');
  checkPassword(req.body.password);
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw bad('An account with that email already exists.');
  if (db.prepare('SELECT 1 FROM users WHERE matric=?').get(matric)) throw bad('That matriculation number is already registered.');
  const id = uid('usr');
  db.prepare(`INSERT INTO users(id,name,email,password_hash,role,matric,level,department,status,created_at) VALUES(?,?,?,?, 'student',?,?,?, 'active',?)`)
    .run(id, name, email, A.hashPassword(req.body.password), matric, level, department, now());
  audit(id, 'STUDENT_REGISTERED', 'user', id);
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  A.createSession(res, u);
  res.status(201).json({ user: A.publicUser(u) });
}));

router.post('/change-password', A.requireAuth, h((req, res) => {
  if (!A.verifyPassword(String(req.body.current || ''), req.user.password_hash)) throw bad('Current password is incorrect.');
  checkPassword(req.body.next);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(A.hashPassword(req.body.next), req.user.id);
  A.destroyUserSessions(req.user.id);
  A.createSession(res, req.user);
  audit(req.user.id, 'PASSWORD_CHANGED', 'user', req.user.id);
  res.json({ ok: true });
}));

module.exports = { router, checkPassword, LEVELS, MATRIC_RE, EMAIL_RE };
