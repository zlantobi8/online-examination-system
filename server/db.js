/* db.js — PostgreSQL adapter.
 *
 * The original application used synchronous better-sqlite3 calls. This module
 * keeps the same tiny prepare().get/all/run API so the application logic does
 * not need a risky, line-by-line async rewrite. SQL is executed by a worker
 * thread using the official pg driver, against DATABASE_URL.
 */
const { Worker } = require('worker_threads');
const path = require('path');

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Add your PostgreSQL connection string before starting the server.');
}

const RESPONSE_BYTES = Number(process.env.DB_WORKER_RESPONSE_BYTES || 8 * 1024 * 1024);
const sab = new SharedArrayBuffer(RESPONSE_BYTES + 8);
const status = new Int32Array(sab, 0, 2);
const buffer = new Uint8Array(sab, 8);
const worker = new Worker(path.join(__dirname, 'db-worker.js'), { workerData: { connectionString } });
let sequence = 0;

function call(op, sql, params) {
  Atomics.store(status, 0, 0);
  Atomics.store(status, 1, 0);
  worker.postMessage({ sab, message: { op, sql, params } });
  Atomics.wait(status, 0, 0);
  const length = Atomics.load(status, 1);
  const payload = JSON.parse(Buffer.from(buffer.subarray(0, length)).toString('utf8'));
  if (!payload.ok) {
    const err = new Error(payload.error.message || 'Database error');
    Object.assign(err, payload.error);
    throw err;
  }
  return payload.result;
}

const statement = sql => ({
  get: (...params) => call('get', sql, params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0]) ? params[0] : params),
  all: (...params) => call('all', sql, params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0]) ? params[0] : params),
  run: (...params) => call('run', sql, params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0]) ? params[0] : params)
});

const db = {
  prepare: statement,
  pragma: () => undefined,
  exec: sql => call('exec', sql, []),
  transaction: fn => () => {
    call('begin', 'BEGIN', []);
    try {
      const result = fn();
      call('commit', 'COMMIT', []);
      return result;
    } catch (e) {
      try { call('rollback', 'ROLLBACK', []); } catch (_) {}
      throw e;
    }
  }
};

// Initialize PostgreSQL-specific schema. citext gives the same case-insensitive
// uniqueness semantics the old SQLite COLLATE NOCASE columns had.
db.exec(`
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email CITEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student','lecturer','admin')),
  matric CITEXT UNIQUE,
  staff_id CITEXT UNIQUE,
  level TEXT,
  department TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','inactive','graduated','withdrawn')),
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_level_allowed') THEN
    ALTER TABLE users ADD CONSTRAINT users_level_allowed CHECK (level IS NULL OR level IN ('ND I','ND II','HND I','HND II'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name CITEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  code CITEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  level TEXT,
  department TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','archived')),
  created_at TEXT NOT NULL
);

ALTER TABLE courses ADD COLUMN IF NOT EXISTS department TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'courses_level_allowed') THEN
    ALTER TABLE courses ADD CONSTRAINT courses_level_allowed CHECK (level IS NULL OR level IN ('ND I','ND II','HND I','HND II'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS course_lecturers (
  course_id TEXT NOT NULL REFERENCES courses(id),
  lecturer_id TEXT NOT NULL REFERENCES users(id),
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (course_id, lecturer_id)
);

CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES users(id),
  course_id TEXT NOT NULL REFERENCES courses(id),
  session_label TEXT NOT NULL,
  semester TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','submitted','approved','withdrawn')),
  created_at TEXT NOT NULL,
  submitted_at TEXT,
  approved_at TEXT,
  approved_by TEXT,
  withdrawn_at TEXT,
  UNIQUE (student_id, course_id, session_label, semester)
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id),
  type TEXT NOT NULL CHECK (type IN ('mcq','truefalse','short','essay')),
  text TEXT NOT NULL,
  topic TEXT,
  difficulty TEXT NOT NULL DEFAULT 'medium',
  marks INTEGER NOT NULL,
  options TEXT NOT NULL DEFAULT '[]',
  correct TEXT,
  accepted TEXT NOT NULL DEFAULT '[]',
  grading TEXT NOT NULL DEFAULT 'normalized',
  created_by TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id),
  title TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  duration_minutes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','closed','archived')),
  opens_at TEXT,
  closes_at TEXT,
  shuffle_questions INTEGER NOT NULL DEFAULT 1,
  shuffle_options INTEGER NOT NULL DEFAULT 1,
  require_fullscreen INTEGER NOT NULL DEFAULT 0,
  max_violations INTEGER NOT NULL DEFAULT 3,
  penalty_major INTEGER NOT NULL DEFAULT 0,
  penalty_minor INTEGER NOT NULL DEFAULT 0,
  selection_mode TEXT NOT NULL DEFAULT 'fixed',
  question_ids TEXT NOT NULL DEFAULT '[]',
  random_count INTEGER NOT NULL DEFAULT 10,
  random_difficulty TEXT NOT NULL DEFAULT 'any',
  show_answers TEXT NOT NULL DEFAULT 'after_release',
  results_released INTEGER NOT NULL DEFAULT 0,
  snapshot TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  published_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exam_candidates (
  exam_id TEXT NOT NULL REFERENCES exams(id),
  student_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'eligible' CHECK (status IN ('eligible','withdrawn')),
  added_at TEXT NOT NULL,
  PRIMARY KEY (exam_id, student_id)
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL REFERENCES exams(id),
  student_id TEXT NOT NULL REFERENCES users(id),
  started_at TEXT NOT NULL,
  deadline TEXT NOT NULL,
  submitted_at TEXT,
  question_order TEXT NOT NULL,
  option_order TEXT NOT NULL,
  answers TEXT NOT NULL DEFAULT '{}',
  auto_score INTEGER,
  manual_scores TEXT NOT NULL DEFAULT '{}',
  total_marks INTEGER,
  status TEXT NOT NULL DEFAULT 'in-progress' CHECK (status IN ('in-progress','awaiting-marking','marked')),
  integrity TEXT NOT NULL DEFAULT '{"counts":{},"log":[]}',
  integrity_penalty INTEGER NOT NULL DEFAULT 0,
  penalty_waived INTEGER NOT NULL DEFAULT 0,
  auto_submit_reason TEXT,
  UNIQUE (exam_id, student_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  at TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_reg_student ON registrations(student_id);
CREATE INDEX IF NOT EXISTS idx_reg_course ON registrations(course_id);
CREATE INDEX IF NOT EXISTS idx_att_exam ON attempts(exam_id);
CREATE INDEX IF NOT EXISTS idx_att_student ON attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_q_course ON questions(course_id);
`);


// Backfill a controlled department list from existing data, plus the institution's
// common demo departments. Future departments are added by administrators.
const departmentSeeds = new Set(['Computer Science', 'Software and Web Development']);
for (const r of db.prepare("SELECT DISTINCT department AS name FROM users WHERE department IS NOT NULL AND TRIM(department) <> ''").all()) departmentSeeds.add(String(r.name).trim());
for (const r of db.prepare("SELECT DISTINCT department AS name FROM courses WHERE department IS NOT NULL AND TRIM(department) <> ''").all()) departmentSeeds.add(String(r.name).trim());
for (const name of departmentSeeds) {
  db.prepare("INSERT INTO departments(id,name,status,created_at) VALUES(?,?, 'active',?) ON CONFLICT (name) DO UPDATE SET status='active'").run('dept_' + require('crypto').randomBytes(9).toString('base64url'), name, new Date().toISOString());
}

const now = () => new Date().toISOString();
const uid = p => p + '_' + require('crypto').randomBytes(9).toString('base64url');
const json = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };

function getSetting(key, fallback) {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return r ? r.value : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}
function audit(actorId, action, entity, entityId, detail) {
  db.prepare('INSERT INTO audit_logs(at,actor_id,action,entity,entity_id,detail) VALUES(?,?,?,?,?,?)')
    .run(now(), actorId || null, action || null, entity || null, entityId || null, detail ? JSON.stringify(detail) : null);
}

if (!getSetting('academic_session')) setSetting('academic_session', '2026/2027');
if (!getSetting('semester')) setSetting('semester', 'First Semester');
if (!getSetting('registration_open')) setSetting('registration_open', '0');

module.exports = { db, now, uid, json, getSetting, setSetting, audit };
