const router = require('express').Router();
const { db, now, uid, json, audit, getSetting, setSetting } = require('../db');
const A = require('../lib/auth');
const E = require('../lib/exam');
const { h, bad, notFound, conflict, forbidden, str } = require('../lib/util');
const { checkPassword, LEVELS, MATRIC_RE, EMAIL_RE } = require('./auth');

const admin = [A.requireAuth, A.requireRole('admin')];

/* ============ settings (academic session / registration window) ============ */
const settingsDto = () => ({
  academicSession: getSetting('academic_session'), semester: getSetting('semester'),
  registrationOpen: getSetting('registration_open') === '1'
});
router.get('/settings', A.requireAuth, h((req, res) => res.json(settingsDto())));
router.put('/settings', admin, h((req, res) => {
  const s = str(req.body.academicSession, 20), sem = str(req.body.semester, 30);
  if (!/^\d{4}\/\d{4}$/.test(s)) throw bad('Academic session must look like 2026/2027.');
  if (!['First Semester', 'Second Semester'].includes(sem)) throw bad('Choose a semester.');
  setSetting('academic_session', s); setSetting('semester', sem);
  setSetting('registration_open', req.body.registrationOpen ? '1' : '0');
  audit(req.user.id, 'SETTINGS_CHANGED', 'settings', null, settingsDto());
  res.json(settingsDto());
}));

/* ============ departments ============ */
router.get('/departments', admin, h((req, res) => {
  res.json(db.prepare('SELECT id,name,status,created_at createdAt FROM departments ORDER BY name').all());
}));
router.post('/departments', admin, h((req, res) => {
  const name = str(req.body.name, 120).replace(/\s+/g, ' ').trim();
  if (name.length < 2) throw bad('Enter a department name.');
  const existing = db.prepare('SELECT * FROM departments WHERE name=?').get(name);
  if (existing) {
    if (existing.status === 'active') throw conflict('That department already exists.');
    db.prepare("UPDATE departments SET status='active' WHERE id=?").run(existing.id);
    return res.json({ id: existing.id, name: existing.name, status: 'active' });
  }
  const id = uid('dept');
  db.prepare("INSERT INTO departments(id,name,status,created_at) VALUES(?,?, 'active',?)").run(id, name, now());
  audit(req.user.id, 'DEPARTMENT_CREATED', 'department', id, { name });
  res.status(201).json({ id, name, status: 'active' });
}));
router.post('/departments/:id/status', admin, h((req, res) => {
  const d = db.prepare('SELECT * FROM departments WHERE id=?').get(req.params.id);
  if (!d) throw notFound('Department not found.');
  if (!['active','inactive'].includes(req.body.status)) throw bad('Invalid department status.');
  if (req.body.status === 'inactive') {
    const used = db.prepare('SELECT 1 FROM users WHERE department=? UNION SELECT 1 FROM courses WHERE department=? LIMIT 1').get(d.name, d.name);
    if (used) throw conflict('This department is still assigned to students or courses. Add/move them first.');
  }
  db.prepare('UPDATE departments SET status=? WHERE id=?').run(req.body.status, d.id);
  audit(req.user.id, 'DEPARTMENT_STATUS_CHANGED', 'department', d.id, { status: req.body.status });
  res.json({ ok: true });
}));

/* ============ users ============ */
const userRow = u => ({
  id: u.id, name: u.name, email: u.email, role: u.role, matric: u.matric, staffId: u.staff_id,
  level: u.level, department: u.department, status: u.status, createdAt: u.created_at
});
function courseCountFor(u) {
  const cur = { s: getSetting('academic_session'), m: getSetting('semester') };
  if (u.role === 'student') return db.prepare(`SELECT COUNT(*) c FROM registrations WHERE student_id=? AND status='approved' AND session_label=? AND semester=?`).get(u.id, cur.s, cur.m).c;
  if (u.role === 'lecturer') return db.prepare('SELECT COUNT(*) c FROM course_lecturers WHERE lecturer_id=?').get(u.id).c;
  return null;
}
router.get('/users', admin, h((req, res) => {
  res.json(db.prepare('SELECT * FROM users ORDER BY name').all().map(u => ({ ...userRow(u), courseCount: courseCountFor(u) })));
}));

function validateUserFields(b, role, existingId) {
  const name = str(b.name, 120), email = str(b.email, 200).toLowerCase();
  if (name.length < 3) throw bad('Enter the full name.');
  if (!EMAIL_RE.test(email)) throw bad('Enter a valid email address.');
  const clash = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (clash && clash.id !== existingId) throw bad('That email is already in use.');
  let matric = null, staffId = null, level = null, department = null;
  if (role === 'student') {
    matric = str(b.matric, 40).toUpperCase();
    if (!MATRIC_RE.test(matric)) throw bad('Matriculation number is not in the expected format.');
    const c = db.prepare('SELECT id FROM users WHERE matric=?').get(matric);
    if (c && c.id !== existingId) throw bad('That matriculation number is already registered.');
    level = str(b.level, 20);
    if (!LEVELS.includes(level)) throw bad('Select the student\u2019s level.');
    department = str(b.department, 100);
    if (department.length < 2) throw bad('Select the student\u2019s department.');
    if (!db.prepare("SELECT 1 FROM departments WHERE name=? AND status='active'").get(department)) throw bad('Choose a department from the list.');
  } else {
    staffId = str(b.staffId, 40).toUpperCase();
    if (staffId.length < 3) throw bad('Enter the staff ID.');
    const c = db.prepare('SELECT id FROM users WHERE staff_id=?').get(staffId);
    if (c && c.id !== existingId) throw bad('That staff ID is already registered.');
  }
  return { name, email, matric, staffId, level, department };
}

router.post('/users', admin, h((req, res) => {
  const role = req.body.role;
  if (!['student', 'lecturer', 'admin'].includes(role)) throw bad('Choose a role.');
  const f = validateUserFields(req.body, role, null);
  checkPassword(req.body.password);
  const id = uid('usr');
  db.prepare(`INSERT INTO users(id,name,email,password_hash,role,matric,staff_id,level,department,status,created_at) VALUES(?,?,?,?,?,?,?,?,?, 'active',?)`)
    .run(id, f.name, f.email, A.hashPassword(req.body.password), role, f.matric, f.staffId, f.level, f.department, now());
  audit(req.user.id, 'USER_CREATED', 'user', id, { role, email: f.email });
  res.status(201).json(userRow(db.prepare('SELECT * FROM users WHERE id=?').get(id)));
}));

router.patch('/users/:id', admin, h((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) throw notFound('User not found.');
  const f = validateUserFields({ ...userRow(u), ...req.body }, u.role, u.id); // role is immutable
  db.prepare('UPDATE users SET name=?,email=?,matric=?,staff_id=?,level=?,department=? WHERE id=?').run(f.name, f.email, f.matric, f.staffId, f.level, f.department, u.id);
  if (req.body.password) {
    checkPassword(req.body.password);
    db.prepare('UPDATE users SET password_hash=?, failed_logins=0, locked_until=NULL WHERE id=?').run(A.hashPassword(req.body.password), u.id);
    A.destroyUserSessions(u.id);
    audit(req.user.id, 'PASSWORD_RESET_BY_ADMIN', 'user', u.id);
  }
  audit(req.user.id, 'USER_UPDATED', 'user', u.id);
  res.json(userRow(db.prepare('SELECT * FROM users WHERE id=?').get(u.id)));
}));

router.post('/users/:id/status', admin, h((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) throw notFound('User not found.');
  const status = req.body.status;
  if (!['active', 'suspended', 'inactive', 'graduated', 'withdrawn'].includes(status)) throw bad('Invalid status.');
  if (u.id === req.user.id && status !== 'active') throw bad('You cannot deactivate your own account.');
  db.prepare('UPDATE users SET status=? WHERE id=?').run(status, u.id);
  if (status !== 'active') A.destroyUserSessions(u.id);
  audit(req.user.id, 'USER_STATUS_CHANGED', 'user', u.id, { from: u.status, to: status });
  res.json({ ok: true });
}));

// Hard delete is only for accounts with no academic footprint (e.g. created by mistake).
router.delete('/users/:id', admin, h((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) throw notFound('User not found.');
  if (u.id === req.user.id) throw bad('You cannot delete your own account.');
  const used = db.prepare(`SELECT
      (SELECT COUNT(*) FROM attempts WHERE student_id=@i) + (SELECT COUNT(*) FROM registrations WHERE student_id=@i)
      + (SELECT COUNT(*) FROM exams WHERE created_by=@i) + (SELECT COUNT(*) FROM questions WHERE created_by=@i)
      + (SELECT COUNT(*) FROM course_lecturers WHERE lecturer_id=@i) AS n`).get({ i: u.id }).n;
  if (used > 0) throw conflict('This account has academic records, so it cannot be deleted. Deactivate it instead \u2014 its history is preserved.');
  A.destroyUserSessions(u.id);
  db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  audit(req.user.id, 'USER_DELETED', 'user', u.id, { email: u.email });
  res.json({ ok: true });
}));

/* ============ courses ============ */
function courseDto(c, forAdmin) {
  const lecturers = db.prepare(`SELECT u.id,u.name,u.staff_id FROM course_lecturers cl JOIN users u ON u.id=cl.lecturer_id WHERE cl.course_id=?`).all(c.id);
  const s = getSetting('academic_session'), m = getSetting('semester');
  const d = { id: c.id, code: c.code, title: c.title, level: c.level, department: c.department, status: c.status,
    lecturers: lecturers.map(l => ({ id: l.id, name: l.name, staffId: l.staff_id })) };
  d.studentCount = db.prepare(`SELECT COUNT(*) n FROM registrations WHERE course_id=? AND status='approved' AND session_label=? AND semester=?`).get(c.id, s, m).n;
  if (forAdmin) {
    d.questionCount = db.prepare('SELECT COUNT(*) n FROM questions WHERE course_id=? AND status=\'active\'').get(c.id).n;
    d.examCount = db.prepare('SELECT COUNT(*) n FROM exams WHERE course_id=?').get(c.id).n;
  }
  return d;
}
router.get('/courses', A.requireAuth, A.requireRole('admin', 'lecturer'), h((req, res) => {
  const rows = req.user.role === 'admin'
    ? db.prepare('SELECT * FROM courses ORDER BY code').all()
    : db.prepare(`SELECT c.* FROM courses c JOIN course_lecturers cl ON cl.course_id=c.id WHERE cl.lecturer_id=? ORDER BY c.code`).all(req.user.id);
  res.json(rows.map(c => courseDto(c, req.user.role === 'admin')));
}));

function courseFields(b, id) {
  const code = str(b.code, 20).toUpperCase(), title = str(b.title, 200), level = str(b.level, 20), department = str(b.department, 100);
  if (!code) throw bad('Course code is required.');
  if (!title) throw bad('Course title is required.');
  if (!LEVELS.includes(level)) throw bad('Choose a level.');
  if (department.length < 2) throw bad('Choose a department.');
  if (!db.prepare("SELECT 1 FROM departments WHERE name=? AND status='active'").get(department)) throw bad('Choose a department from the list.');
  const clash = db.prepare('SELECT id FROM courses WHERE code=?').get(code);
  if (clash && clash.id !== id) throw bad('A course with that code already exists.');
  return { code, title, level, department };
}
router.post('/courses', admin, h((req, res) => {
  const f = courseFields(req.body, null); const id = uid('crs');
  db.prepare(`INSERT INTO courses(id,code,title,level,department,status,created_at) VALUES(?,?,?,?,?, 'active',?)`).run(id, f.code, f.title, f.level, f.department, now());
  audit(req.user.id, 'COURSE_CREATED', 'course', id, f);
  res.status(201).json(courseDto(db.prepare('SELECT * FROM courses WHERE id=?').get(id), true));
}));
router.patch('/courses/:id', admin, h((req, res) => {
  const c = db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id);
  if (!c) throw notFound('Course not found.');
  const f = courseFields(req.body, c.id);
  db.prepare('UPDATE courses SET code=?,title=?,level=?,department=? WHERE id=?').run(f.code, f.title, f.level, f.department, c.id);
  audit(req.user.id, 'COURSE_UPDATED', 'course', c.id, f);
  res.json(courseDto(db.prepare('SELECT * FROM courses WHERE id=?').get(c.id), true));
}));
router.post('/courses/:id/status', admin, h((req, res) => {
  const c = db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id);
  if (!c) throw notFound('Course not found.');
  if (!['active', 'closed', 'archived'].includes(req.body.status)) throw bad('Invalid status.');
  db.prepare('UPDATE courses SET status=? WHERE id=?').run(req.body.status, c.id);
  audit(req.user.id, 'COURSE_STATUS_CHANGED', 'course', c.id, { from: c.status, to: req.body.status });
  res.json({ ok: true });
}));
router.delete('/courses/:id', admin, h((req, res) => {
  const c = db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id);
  if (!c) throw notFound('Course not found.');
  const n = db.prepare(`SELECT (SELECT COUNT(*) FROM questions WHERE course_id=@i)+(SELECT COUNT(*) FROM exams WHERE course_id=@i)+(SELECT COUNT(*) FROM registrations WHERE course_id=@i) n`).get({ i: c.id }).n;
  if (n > 0) throw conflict('This course has questions, exams or registrations. Archive it instead \u2014 nothing is deleted.');
  db.prepare('DELETE FROM course_lecturers WHERE course_id=?').run(c.id);
  db.prepare('DELETE FROM courses WHERE id=?').run(c.id);
  audit(req.user.id, 'COURSE_DELETED', 'course', c.id, { code: c.code });
  res.json({ ok: true });
}));
router.put('/courses/:id/lecturers', admin, h((req, res) => {
  const c = db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id);
  if (!c) throw notFound('Course not found.');
  const ids = Array.isArray(req.body.lecturerIds) ? [...new Set(req.body.lecturerIds)] : [];
  if (ids.length > 1) throw bad('Only one lecturer can be assigned to a course.');
  const valid = ids.filter(i => db.prepare(`SELECT 1 FROM users WHERE id=? AND role='lecturer' AND status='active'`).get(i));
  db.transaction(() => {
    db.prepare('DELETE FROM course_lecturers WHERE course_id=?').run(c.id);
    valid.forEach(i => db.prepare('INSERT INTO course_lecturers(course_id,lecturer_id,assigned_at) VALUES(?,?,?)').run(c.id, i, now()));
  })();
  audit(req.user.id, 'COURSE_LECTURERS_SET', 'course', c.id, { lecturerIds: valid });
  res.json(courseDto(c, true));
}));

// Roster of a course for the current session. Admin sees every status; lecturers see approved only.
router.get('/courses/:id/students', A.requireAuth, A.requireRole('admin', 'lecturer'), h((req, res) => {
  const c = db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id);
  if (!c) throw notFound('Course not found.');
  if (req.user.role === 'lecturer' && !db.prepare('SELECT 1 FROM course_lecturers WHERE course_id=? AND lecturer_id=?').get(c.id, req.user.id))
    throw forbidden('You do not teach this course.');
  const s = getSetting('academic_session'), m = getSetting('semester');
  const statuses = req.user.role === 'admin' ? `('draft','submitted','approved')` : `('approved')`;
  const rows = db.prepare(`SELECT r.id rid, r.status, u.id, u.name, u.email, u.matric, u.level FROM registrations r JOIN users u ON u.id=r.student_id
    WHERE r.course_id=? AND r.session_label=? AND r.semester=? AND r.status IN ${statuses} ORDER BY u.name`).all(c.id, s, m);
  res.json(rows.map(r => ({ id: r.id, registrationId: r.rid, status: r.status, name: r.name, email: r.email, matric: r.matric, level: r.level })));
}));

/* ============ registrations (admin side) ============ */
function approveReg(reg, actor) {
  db.prepare(`UPDATE registrations SET status='approved', approved_at=?, approved_by=? WHERE id=?`).run(now(), actor, reg.id);
  E.syncCandidate(reg.course_id, reg.student_id, true);
}
router.get('/admin/registrations', admin, h((req, res) => {
  const s = getSetting('academic_session'), m = getSetting('semester');
  const rows = db.prepare(`SELECT r.id, r.status, r.submitted_at, r.approved_at, u.id sid, u.name, u.matric, u.level, c.id cid, c.code, c.title
    FROM registrations r JOIN users u ON u.id=r.student_id JOIN courses c ON c.id=r.course_id
    WHERE r.session_label=? AND r.semester=? AND r.status IN ('submitted','approved','draft') ORDER BY u.name, c.code`).all(s, m);
  res.json(rows.map(r => ({ id: r.id, status: r.status, submittedAt: r.submitted_at, approvedAt: r.approved_at,
    student: { id: r.sid, name: r.name, matric: r.matric, level: r.level }, course: { id: r.cid, code: r.code, title: r.title } })));
}));
router.post('/admin/registrations', admin, h((req, res) => {
  const c = db.prepare('SELECT * FROM courses WHERE id=?').get(req.body.courseId);
  const st = db.prepare(`SELECT * FROM users WHERE id=? AND role='student'`).get(req.body.studentId);
  if (!c || !st) throw notFound('Course or student not found.');
  if (c.status !== 'active') throw bad('This course is not active.');
  const s = getSetting('academic_session'), m = getSetting('semester');
  const ex = db.prepare('SELECT * FROM registrations WHERE student_id=? AND course_id=? AND session_label=? AND semester=?').get(st.id, c.id, s, m);
  db.transaction(() => {
    if (ex) {
      db.prepare(`UPDATE registrations SET status='approved', approved_at=?, approved_by=?, withdrawn_at=NULL WHERE id=?`).run(now(), req.user.id, ex.id);
      E.syncCandidate(c.id, st.id, true);
    } else {
      const id = uid('reg');
      db.prepare(`INSERT INTO registrations(id,student_id,course_id,session_label,semester,status,created_at,submitted_at,approved_at,approved_by) VALUES(?,?,?,?,?, 'approved',?,?,?,?)`)
        .run(id, st.id, c.id, s, m, now(), now(), now(), req.user.id);
      E.syncCandidate(c.id, st.id, true);
    }
  })();
  audit(req.user.id, 'REGISTRATION_ADMIN_ENROLLED', 'registration', null, { studentId: st.id, courseId: c.id });
  res.status(201).json({ ok: true });
}));
router.post('/admin/registrations/:id/approve', admin, h((req, res) => {
  const r = db.prepare('SELECT * FROM registrations WHERE id=?').get(req.params.id);
  if (!r) throw notFound();
  if (r.status !== 'submitted') throw bad('Only submitted registrations can be approved.');
  approveReg(r, req.user.id);
  audit(req.user.id, 'REGISTRATION_APPROVED', 'registration', r.id, { studentId: r.student_id, courseId: r.course_id });
  res.json({ ok: true });
}));
router.post('/admin/students/:id/approve-all', admin, h((req, res) => {
  const s = getSetting('academic_session'), m = getSetting('semester');
  const rows = db.prepare(`SELECT * FROM registrations WHERE student_id=? AND status='submitted' AND session_label=? AND semester=?`).all(req.params.id, s, m);
  db.transaction(() => rows.forEach(r => approveReg(r, req.user.id)))();
  audit(req.user.id, 'REGISTRATION_APPROVED_ALL', 'user', req.params.id, { count: rows.length });
  res.json({ approved: rows.length });
}));
// Send back to the student for changes — refused once they have sat an exam on that course.
router.post('/admin/registrations/:id/reopen', admin, h((req, res) => {
  const r = db.prepare('SELECT * FROM registrations WHERE id=?').get(req.params.id);
  if (!r) throw notFound();
  const sat = db.prepare(`SELECT 1 FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.student_id=? AND e.course_id=?`).get(r.student_id, r.course_id);
  if (sat) throw conflict('This student has already sat an exam on this course, so the registration cannot be reopened.');
  db.prepare(`UPDATE registrations SET status='draft', submitted_at=NULL, approved_at=NULL, approved_by=NULL WHERE id=?`).run(r.id);
  E.syncCandidate(r.course_id, r.student_id, false);
  audit(req.user.id, 'REGISTRATION_REOPENED', 'registration', r.id);
  res.json({ ok: true });
}));
// Admin removal keeps the row (status=withdrawn) and never touches submitted attempts.
router.post('/admin/registrations/:id/withdraw', admin, h((req, res) => {
  const r = db.prepare('SELECT * FROM registrations WHERE id=?').get(req.params.id);
  if (!r) throw notFound();
  db.prepare(`UPDATE registrations SET status='withdrawn', withdrawn_at=? WHERE id=?`).run(now(), r.id);
  E.syncCandidate(r.course_id, r.student_id, false);
  audit(req.user.id, 'REGISTRATION_WITHDRAWN', 'registration', r.id, { studentId: r.student_id, courseId: r.course_id });
  res.json({ ok: true });
}));

/* ============ dashboard + audit ============ */
router.get('/admin/stats', admin, h((req, res) => {
  const c = sql => db.prepare(sql).get().n;
  const s = getSetting('academic_session'), m = getSetting('semester');
  const courses = db.prepare(`SELECT * FROM courses WHERE status='active' ORDER BY code`).all().map(x => courseDto(x, true));
  const examRows = db.prepare('SELECT * FROM exams').all();
  res.json({
    settings: settingsDto(),
    students: c(`SELECT COUNT(*) n FROM users WHERE role='student' AND status='active'`),
    lecturers: c(`SELECT COUNT(*) n FROM users WHERE role='lecturer' AND status='active'`),
    courses: courses.length,
    questions: c(`SELECT COUNT(*) n FROM questions WHERE status='active'`),
    exams: examRows.length,
    openNow: examRows.filter(e => E.windowState(e) === 'open').length,
    scriptsSubmitted: c(`SELECT COUNT(*) n FROM attempts WHERE status!='in-progress'`),
    pendingRegistrations: db.prepare(`SELECT COUNT(*) n FROM registrations WHERE status='submitted' AND session_label=? AND semester=?`).get(s, m).n,
    unassigned: courses.filter(x => x.lecturers.length === 0).map(x => x.code),
    studentsWithoutCourses: db.prepare(`SELECT COUNT(*) n FROM users u WHERE role='student' AND status='active' AND NOT EXISTS
      (SELECT 1 FROM registrations r WHERE r.student_id=u.id AND r.status IN ('draft','submitted','approved') AND r.session_label=? AND r.semester=?)`).get(s, m).n,
    courseList: courses
  });
}));
router.get('/admin/audit', admin, h((req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = db.prepare(`SELECT a.*, u.name actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT ?`).all(limit);
  res.json(rows.map(r => ({ id: r.id, at: r.at, actor: r.actor || 'system', action: r.action, entity: r.entity, entityId: r.entity_id, detail: json(r.detail, null) })));
}));

module.exports = { router, courseDto };
