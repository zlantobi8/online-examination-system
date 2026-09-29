const router = require('express').Router();
const { db, now, uid, json, audit, getSetting } = require('../db');
const A = require('../lib/auth');
const E = require('../lib/exam');
const { h, bad, notFound, conflict, forbidden, str } = require('../lib/util');

const student = [A.requireAuth, A.requireRole('student')];
const cur = () => ({ s: getSetting('academic_session'), m: getSetting('semester'), open: getSetting('registration_open') === '1' });
const courseLite = c => ({ id: c.id, code: c.code, title: c.title, level: c.level, department: c.department, status: c.status });

/* ============ course registration (controlled workflow) ============ */
function regState(userId) {
  const { s, m, open } = cur();
  const rows = db.prepare(`SELECT r.*, c.code, c.title, c.level, c.department, c.status cstatus FROM registrations r JOIN courses c ON c.id=r.course_id
    WHERE r.student_id=? AND r.session_label=? AND r.semester=? AND r.status='approved' ORDER BY c.code`).all(userId, s, m);
  return { s, m, open, rows };
}
router.get('/my/registration', student, h((req, res) => {
  const st = regState(req.user.id);
  const have = new Set(st.rows.map(r => r.course_id));
  const available = db.prepare(`SELECT * FROM courses WHERE status='active' AND level=? AND department=? ORDER BY code`).all(req.user.level, req.user.department || '')
    .filter(c => !have.has(c.id)).map(courseLite);
  const lockedCourses = st.rows.filter(r => db.prepare(`SELECT 1 FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.student_id=? AND e.course_id=?`).get(req.user.id, r.course_id)).map(r => r.course_id);
  res.json({
    academicSession: st.s, semester: st.m, registrationOpen: st.open, level: req.user.level, department: req.user.department,
    status: st.rows.length ? 'approved' : 'none', locked: false,
    registered: st.rows.map(r => ({ id: r.id, status: r.status, locked: lockedCourses.includes(r.course_id), course: { id: r.course_id, code: r.code, title: r.title, level: r.level, department: r.department } })),
    available
  });
}));

router.post('/registrations', student, h((req, res) => {
  const st = regState(req.user.id);
  if (!st.open) throw conflict('Course registration is closed. Contact the administrator.');
  const c = db.prepare('SELECT * FROM courses WHERE id=?').get(req.body.courseId);
  if (!c || c.status !== 'active') throw notFound('That course is not available.');
  if (c.level !== req.user.level || c.department !== req.user.department) throw forbidden('That course is outside your department or level.');
  const locked = db.prepare(`SELECT 1 FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.student_id=? AND e.course_id=?`).get(req.user.id, c.id);
  if (locked) throw conflict('You have already started or sat an exam for this course, so its registration is locked.');
  const existing = db.prepare('SELECT * FROM registrations WHERE student_id=? AND course_id=? AND session_label=? AND semester=?').get(req.user.id, c.id, st.s, st.m);
  if (existing && existing.status === 'approved') return res.json({ ok: true, alreadyRegistered: true });
  db.prepare(`INSERT INTO registrations(id,student_id,course_id,session_label,semester,status,created_at,submitted_at,approved_at) VALUES(?,?,?,?,?, 'approved',?,?,?)
    ON CONFLICT (student_id,course_id,session_label,semester) DO UPDATE SET status='approved', submitted_at=excluded.submitted_at, approved_at=excluded.approved_at, withdrawn_at=NULL`)
    .run(uid('reg'), req.user.id, c.id, st.s, st.m, now(), now(), now());
  E.syncCandidate(c.id, req.user.id, true);
  audit(req.user.id, 'REGISTRATION_COURSE_ADDED', 'course', c.id);
  res.status(201).json({ ok: true });
}));

router.delete('/registrations/:courseId', student, h((req, res) => {
  const st = regState(req.user.id);
  if (!st.open) throw conflict('Course registration is closed. Contact the administrator.');
  const r = st.rows.find(x => x.course_id === req.params.courseId);
  if (!r) throw notFound('You are not registered for that course.');
  if (db.prepare(`SELECT 1 FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.student_id=? AND e.course_id=?`).get(req.user.id, r.course_id))
    throw conflict('You have already started or sat an exam for this course, so it cannot be dropped.');
  db.prepare(`UPDATE registrations SET status='withdrawn', withdrawn_at=? WHERE id=?`).run(now(), r.id);
  E.syncCandidate(r.course_id, req.user.id, false);
  audit(req.user.id, 'REGISTRATION_COURSE_DROPPED', 'course', r.course_id);
  res.json({ ok: true });
}));

// Kept for compatibility with older clients: registration is now automatic, so this simply confirms the current selections.
router.post('/registrations/submit', student, h((req, res) => {
  const st = regState(req.user.id);
  if (!st.open) throw conflict('Course registration is closed.');
  res.json({ ok: true, submitted: st.rows.length, automatic: true });
}));

/* ============ dashboard ============ */
function myAttempt(examId, studentId) { return db.prepare('SELECT * FROM attempts WHERE exam_id=? AND student_id=?').get(examId, studentId); }

router.get('/my/exams', student, h((req, res) => {
  E.reapExpired();
  const { s, m } = cur();
  const courses = db.prepare(`SELECT c.* FROM registrations r JOIN courses c ON c.id=r.course_id WHERE r.student_id=? AND r.status='approved' AND r.session_label=? AND r.semester=? ORDER BY c.code`)
    .all(req.user.id, s, m).map(courseLite);
  const reg = regState(req.user.id);
  const exams = db.prepare(`SELECT e.* FROM exams e JOIN registrations r ON r.course_id=e.course_id
    WHERE r.student_id=? AND r.status='approved' AND r.session_label=? AND r.semester=? AND e.status IN ('published','closed') ORDER BY e.created_at DESC`).all(req.user.id, s, m)
    .map(e => {
      const a = myAttempt(e.id, req.user.id);
      const c = db.prepare('SELECT code,title FROM courses WHERE id=?').get(e.course_id);
      return { ...E.examDto(e), course: c, attempt: a ? { id: a.id, status: a.status } : null };
    })
    // A closed exam the student never sat is just noise on the dashboard.
    .filter(e => e.status === 'published' || e.attempt);
  res.json({ courses, exams, registrationStatus: reg.rows.length ? (reg.rows.every(r => r.status === 'approved') ? 'approved' : 'pending') : 'none', registrationOpen: reg.open });
}));

/* ============ taking an exam ============ */
function assertCandidate(examId, studentId) {
  const e = db.prepare('SELECT course_id FROM exams WHERE id=?').get(examId);
  const attempt = db.prepare('SELECT 1 FROM attempts WHERE exam_id=? AND student_id=?').get(examId, studentId);
  if (attempt) return;
  const reg = db.prepare(`SELECT 1 FROM registrations r JOIN exams e ON e.course_id=r.course_id
    WHERE e.id=? AND r.student_id=? AND r.status='approved' AND r.session_label=? AND r.semester=?`).get(examId, studentId, getSetting('academic_session'), getSetting('semester'));
  if (!reg) throw forbidden('You are not registered for this exam course.');
  // Keep the frozen candidate list for compatibility, but registration is the source of truth.
  E.syncCandidate(e.course_id, studentId, true);
}
function loadExam(id) {
  const e = db.prepare('SELECT * FROM exams WHERE id=?').get(id);
  if (!e) throw notFound('This exam does not exist.');
  return e;
}

router.get('/exams/:id/gate', student, h((req, res) => {
  E.reapExpired();
  const e = loadExam(req.params.id);
  assertCandidate(e.id, req.user.id);
  const a = myAttempt(e.id, req.user.id);
  const course = db.prepare('SELECT code,title FROM courses WHERE id=?').get(e.course_id);
  res.json({ exam: E.examDto(e), course, attempt: a ? { id: a.id, status: a.status } : null });
}));

function attemptPayload(a, e) {
  const snap = json(e.snapshot, []);
  const optOrder = json(a.option_order, {});
  const questions = json(a.question_order, []).map(id => snap.find(q => q.id === id)).filter(Boolean).map(q => {
    let opts = q.options || [];
    if (optOrder[q.id]) opts = optOrder[q.id].map(oid => opts.find(o => o.id === oid)).filter(Boolean);
    // NOTE: correct answers / accepted answers are deliberately never sent.
    return { id: q.id, type: q.type, text: q.text, marks: q.marks, options: opts.map(o => ({ id: o.id, text: o.text })) };
  });
  return { id: a.id, examId: e.id, startedAt: a.started_at, deadline: a.deadline, serverNow: now(),
    answers: json(a.answers, {}), questions,
    exam: { title: e.title, durationMinutes: e.duration_minutes, requireFullscreen: !!e.require_fullscreen, maxViolations: e.max_violations } };
}

router.post('/exams/:id/start', student, h((req, res) => {
  E.reapExpired();
  const e = loadExam(req.params.id);
  assertCandidate(e.id, req.user.id);
  const existing = myAttempt(e.id, req.user.id);
  if (existing && existing.status === 'in-progress') return res.json(attemptPayload(existing, e));
  if (existing) return res.status(409).json({ error: 'You have already sat this exam.', attemptId: existing.id });
  const state = E.windowState(e);
  if (state === 'unpublished') throw bad('This exam is not published.');
  if (state === 'scheduled') throw bad('This exam has not opened yet.');
  if (state === 'closed') throw bad('This exam has closed.');
  const course = db.prepare('SELECT status FROM courses WHERE id=?').get(e.course_id);
  if (course.status !== 'active') throw bad('This course is no longer active.');

  const snap = json(e.snapshot, []);
  if (!snap.length) throw bad('This exam has no questions.');
  let pool = snap;
  if (e.selection_mode === 'random') pool = E.shuffled(snap).slice(0, Math.min(e.random_count, snap.length));
  const order = e.shuffle_questions ? E.shuffled(pool) : pool;
  const optionOrder = {};
  order.forEach(q => {
    if (q.options && q.options.length)
      optionOrder[q.id] = (e.shuffle_options && q.type === 'mcq') ? E.shuffled(q.options).map(o => o.id) : q.options.map(o => o.id);
  });
  const t0 = Date.now();
  let deadline = t0 + e.duration_minutes * 60000;
  if (e.closes_at) deadline = Math.min(deadline, new Date(e.closes_at).getTime());
  const id = uid('att');
  try {
    db.prepare(`INSERT INTO attempts(id,exam_id,student_id,started_at,deadline,question_order,option_order) VALUES(?,?,?,?,?,?,?)`)
      .run(id, e.id, req.user.id, new Date(t0).toISOString(), new Date(deadline).toISOString(), JSON.stringify(order.map(q => q.id)), JSON.stringify(optionOrder));
  } catch (err) { // UNIQUE(exam_id, student_id): two tabs racing to start
    const again = myAttempt(e.id, req.user.id);
    if (again) return res.json(attemptPayload(again, e));
    throw err;
  }
  audit(req.user.id, 'ATTEMPT_STARTED', 'attempt', id, { examId: e.id });
  res.json(attemptPayload(db.prepare('SELECT * FROM attempts WHERE id=?').get(id), e));
}));

function ownAttempt(req) {
  const a = db.prepare('SELECT * FROM attempts WHERE id=?').get(req.params.id);
  if (!a || a.student_id !== req.user.id) throw notFound('Attempt not found.');
  return a;
}
// The server, not the browser, decides whether time has run out.
function liveAttempt(req) {
  let a = ownAttempt(req);
  if (a.status === 'in-progress' && Date.now() > new Date(a.deadline).getTime() + E.GRACE_MS) {
    E.finalizeAttempt(a.id, 'Auto-submitted: time ran out.');
    a = ownAttempt(req);
  }
  return a;
}

router.put('/attempts/:id/answers/:qid', student, h((req, res) => {
  const a = liveAttempt(req);
  if (a.status !== 'in-progress') return res.status(409).json({ error: 'This paper has already been submitted.', finished: true, attemptId: a.id });
  const e = loadExam(a.exam_id);
  const q = json(e.snapshot, []).find(x => x.id === req.params.qid);
  if (!q || !json(a.question_order, []).includes(q.id)) throw bad('That question is not on your paper.');
  let v = req.body.value;
  const answers = json(a.answers, {});
  if (v === '' || v === null || v === undefined) delete answers[q.id];
  else {
    if (q.type === 'mcq' || q.type === 'truefalse') { if (!q.options.some(o => o.id === v)) throw bad('Invalid option.'); }
    else { v = String(v).slice(0, q.type === 'essay' ? 20000 : 500); }
    answers[q.id] = v;
  }
  db.prepare('UPDATE attempts SET answers=? WHERE id=?').run(JSON.stringify(answers), a.id);
  res.json({ ok: true, serverNow: now() });
}));

router.post('/attempts/:id/integrity', student, h((req, res) => {
  const a = liveAttempt(req);
  if (a.status !== 'in-progress') return res.json({ autoSubmitted: a.status !== 'in-progress', attemptId: a.id });
  const type = String(req.body.type || '');
  if (![...E.MAJOR, ...E.MINOR].includes(type)) throw bad('Unknown event.');
  const integ = json(a.integrity, { counts: {}, log: [] });
  integ.counts[type] = (integ.counts[type] || 0) + 1;
  integ.log.push({ type, at: now() });
  if (integ.log.length > 40) integ.log = integ.log.slice(-40);
  db.prepare('UPDATE attempts SET integrity=? WHERE id=?').run(JSON.stringify(integ), a.id);
  const fresh = db.prepare('SELECT * FROM attempts WHERE id=?').get(a.id);
  const e = loadExam(a.exam_id);
  const major = E.majorCount(fresh);
  if (e.max_violations > 0 && major >= e.max_violations) {
    E.finalizeAttempt(a.id, `Auto-submitted: exceeded ${e.max_violations} tab-switch/full-screen warnings.`);
    return res.json({ autoSubmitted: true, attemptId: a.id, major });
  }
  res.json({ autoSubmitted: false, major, max: e.max_violations });
}));

router.post('/attempts/:id/submit', student, h((req, res) => {
  const a = ownAttempt(req);
  const done = a.status === 'in-progress' ? E.finalizeAttempt(a.id, Date.now() > new Date(a.deadline).getTime() + E.GRACE_MS ? 'Auto-submitted: time ran out.' : null) : a;
  res.json({ ok: true, attemptId: done.id });
}));

/* ============ results (only visible once the lecturer releases them) ============ */
router.get('/attempts/:id', student, h((req, res) => {
  const a = liveAttempt(req);
  const e = loadExam(a.exam_id);
  if (a.status === 'in-progress') return res.json({ inProgress: true, examId: e.id });
  const course = db.prepare('SELECT code,title FROM courses WHERE id=?').get(e.course_id);
  const base = { inProgress: false, examId: e.id, exam: { title: e.title }, course, submittedAt: a.submitted_at,
    status: a.status, autoSubmitReason: a.auto_submit_reason, released: !!e.results_released,
    integrityTotal: E.totalEvents(a) };
  if (!e.results_released) return res.json(base);

  const closed = E.isEffectivelyClosed(e);
  const canReview = closed && e.show_answers !== 'never';
  const snap = json(e.snapshot, []), answers = json(a.answers, {}), manual = json(a.manual_scores, {});
  const review = json(a.question_order, []).map(id => snap.find(q => q.id === id)).filter(Boolean).map(q => {
    const given = answers[q.id];
    const item = { id: q.id, type: q.type, text: q.text, marks: q.marks };
    const opt = id => (q.options || []).find(o => o.id === id);
    item.given = q.type === 'mcq' || q.type === 'truefalse' ? (opt(given) ? opt(given).text : null) : (given || null);
    if (canReview) {
      if (q.type === 'essay') { item.earned = manual[q.id] === undefined ? null : manual[q.id]; }
      else {
        item.earned = E.gradeObjective(q, given);
        if (q.type === 'short') item.accepted = q.acceptedAnswers;
        else item.correctText = opt(q.correctOptionId) ? opt(q.correctOptionId).text : null;
      }
    }
    return item;
  });
  res.json({ ...base, awaiting: a.status === 'awaiting-marking', totalMarks: a.total_marks, score: E.finalScore(a), percent: E.percent(a),
    rawScore: E.rawScore(a), penalty: E.effectivePenalty(a), canReview, review,
    reviewNote: canReview ? null : (e.show_answers === 'never' ? 'Answer review is disabled for this exam.' : 'Correct answers are shown once the exam has closed.') });
}));

router.get('/my/attempts', student, h((req, res) => {
  E.reapExpired();
  const rows = db.prepare(`SELECT a.*, e.title, e.results_released, c.code FROM attempts a JOIN exams e ON e.id=a.exam_id JOIN courses c ON c.id=e.course_id
    WHERE a.student_id=? AND a.status!='in-progress' ORDER BY a.submitted_at DESC`).all(req.user.id);
  res.json(rows.map(a => {
    const o = { id: a.id, exam: a.title, course: a.code, submittedAt: a.submitted_at, released: !!a.results_released, status: a.status };
    if (a.results_released) Object.assign(o, { score: E.finalScore(a), totalMarks: a.total_marks, percent: E.percent(a), awaiting: a.status === 'awaiting-marking' });
    return o;
  }));
}));

module.exports = { router };
