const { db, now, json, uid, audit, getSetting } = require('../db');

const MAJOR = ['tab_hidden', 'fullscreen_exit'];
const MINOR = ['contextmenu_blocked', 'copy_blocked', 'cut_blocked', 'paste_blocked', 'devtools_shortcut'];
const GRACE_MS = 5000; // network latency allowance on the server clock

const shuffled = arr => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = require('crypto').randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/* ---------- exam window (server clock is the only clock that counts) ---------- */
function windowState(exam, at) {
  const t = at ? new Date(at) : new Date();
  if (exam.status === 'draft') return 'unpublished';
  if (exam.status === 'closed' || exam.status === 'archived') return 'closed';
  if (exam.opens_at && t < new Date(exam.opens_at)) return 'scheduled';
  if (exam.closes_at && t > new Date(exam.closes_at)) return 'closed';
  return 'open';
}
const isEffectivelyClosed = exam => windowState(exam) === 'closed';

/* ---------- questions ---------- */
function rowToQuestion(r, includeAnswers) {
  const q = {
    id: r.id, courseId: r.course_id, type: r.type, text: r.text, topic: r.topic || '',
    difficulty: r.difficulty, marks: r.marks, options: json(r.options, []),
    createdBy: r.created_by, status: r.status, createdAt: r.created_at, grading: r.grading
  };
  if (includeAnswers) { q.correctOptionId = r.correct; q.acceptedAnswers = json(r.accepted, []); }
  return q;
}

// Frozen copy of every question an exam can use. Later edits/deletes in the
// bank can never change a published exam or its historical results.
function buildSnapshot(exam) {
  let rows;
  if (exam.selection_mode === 'random') {
    rows = db.prepare(`SELECT * FROM questions WHERE course_id=? AND created_by=? AND status='active'`)
      .all(exam.course_id, exam.created_by);
    if (exam.random_difficulty && exam.random_difficulty !== 'any') rows = rows.filter(r => r.difficulty === exam.random_difficulty);
    rows = rows.filter(r => r.type !== 'essay'); // random draws are auto-gradable only
  } else {
    const ids = json(exam.question_ids, []);
    rows = ids.map(id => db.prepare('SELECT * FROM questions WHERE id=? AND course_id=?').get(id, exam.course_id)).filter(Boolean);
  }
  return rows.map(r => rowToQuestion(r, true));
}

const normalize = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();

function gradeObjective(q, answer) {
  if (answer === undefined || answer === null || answer === '') return 0;
  if (q.type === 'mcq' || q.type === 'truefalse') return answer === q.correctOptionId ? q.marks : 0;
  if (q.type === 'short') {
    const g = q.grading || 'normalized';
    const fn = g === 'exact' ? s => String(s).trim()
      : g === 'case' ? s => String(s).trim().toLowerCase()
      : normalize;
    const given = fn(answer);
    return (q.acceptedAnswers || []).some(a => fn(a) === given) ? q.marks : 0;
  }
  return 0; // essay: manual
}

/* ---------- attempts ---------- */
const rawScore = a => (a.auto_score || 0) + Object.values(json(a.manual_scores, {})).reduce((s, v) => s + v, 0);
const effectivePenalty = a => (a.penalty_waived ? 0 : (a.integrity_penalty || 0));
const finalScore = a => Math.max(0, rawScore(a) - effectivePenalty(a));
const percent = a => (a.total_marks ? Math.round((finalScore(a) / a.total_marks) * 100) : 0);
const integrityCounts = a => json(a.integrity, { counts: {}, log: [] }).counts || {};
const majorCount = a => MAJOR.reduce((s, t) => s + (integrityCounts(a)[t] || 0), 0);
const totalEvents = a => Object.values(integrityCounts(a)).reduce((s, n) => s + n, 0);

function finalizeAttempt(attemptId, reason) {
  const tx = db.transaction(() => {
    const a = db.prepare('SELECT * FROM attempts WHERE id=?').get(attemptId);
    if (!a || a.status !== 'in-progress') return a; // idempotent
    const exam = db.prepare('SELECT * FROM exams WHERE id=?').get(a.exam_id);
    const snap = json(exam.snapshot, []);
    const answers = json(a.answers, {});
    let auto = 0, total = 0, hasEssay = false;
    json(a.question_order, []).forEach(qid => {
      const q = snap.find(x => x.id === qid);
      if (!q) return;
      total += q.marks;
      if (q.type === 'essay') hasEssay = true; else auto += gradeObjective(q, answers[qid]);
    });
    // Penalties are opt-in per exam (default 0) and can be waived by the lecturer.
    const major = majorCount(a);
    const minor = Math.max(0, totalEvents(a) - major);
    const pct = major * (exam.penalty_major || 0) + minor * (exam.penalty_minor || 0);
    const penalty = Math.min(total, Math.round(total * pct / 100));
    const nextStatus = hasEssay ? 'awaiting-marking' : 'marked';
    db.prepare(`UPDATE attempts SET auto_score=?, total_marks=?, submitted_at=?, status=?, auto_submit_reason=?, integrity_penalty=? WHERE id=?`)
      .run(auto, total, now(), nextStatus, reason || null, penalty, a.id);
    // Automatically release results when an exam is fully auto-gradable.
    // Essay exams are released automatically once all essay answers are marked.
    if (!hasEssay) {
      db.prepare('UPDATE exams SET results_released=1 WHERE id=?').run(a.exam_id);
    }
    audit(a.student_id, reason ? 'ATTEMPT_AUTO_SUBMITTED' : 'ATTEMPT_SUBMITTED', 'attempt', a.id, { examId: a.exam_id, reason: reason || null });
    return db.prepare('SELECT * FROM attempts WHERE id=?').get(a.id);
  });
  return tx();
}

// Called on every attempt read/write AND by a background timer, so an
// abandoned paper is graded on time without any browser being involved.
function reapExpired() {
  const rows = db.prepare(`SELECT id, deadline FROM attempts WHERE status='in-progress'`).all();
  const t = Date.now();
  rows.forEach(r => {
    if (t > new Date(r.deadline).getTime() + GRACE_MS) finalizeAttempt(r.id, 'Auto-submitted: time ran out.');
  });
}

/* ---------- candidates (frozen roster) ---------- */
function syncCandidatesForExam(exam) {
  const rows = db.prepare(`SELECT student_id FROM registrations WHERE course_id=? AND status='approved' AND session_label=? AND semester=?`).all(exam.course_id, getSetting('academic_session'), getSetting('semester'));
  const ins = db.prepare(`INSERT OR IGNORE INTO exam_candidates(exam_id,student_id,status,added_at) VALUES(?,?,'eligible',?)`);
  rows.forEach(r => ins.run(exam.id, r.student_id, now()));
}
// Called when an admin approves / withdraws a registration after publish.
function syncCandidate(courseId, studentId, active) {
  const exams = db.prepare(`SELECT id FROM exams WHERE course_id=? AND status IN ('published')`).all(courseId);
  exams.forEach(e => {
    if (active) {
      db.prepare(`INSERT INTO exam_candidates(exam_id,student_id,status,added_at) VALUES(?,?,'eligible',?)
        ON CONFLICT(exam_id,student_id) DO UPDATE SET status='eligible'`).run(e.id, studentId, now());
    } else {
      // Never touch the roster of someone who already sat: their record stands.
      const has = db.prepare('SELECT 1 FROM attempts WHERE exam_id=? AND student_id=?').get(e.id, studentId);
      if (!has) db.prepare(`UPDATE exam_candidates SET status='withdrawn' WHERE exam_id=? AND student_id=?`).run(e.id, studentId);
    }
  });
}

function examDto(r, opts) {
  opts = opts || {};
  const snap = r.snapshot ? json(r.snapshot, []) : null;
  const d = {
    id: r.id, courseId: r.course_id, title: r.title, instructions: r.instructions,
    durationMinutes: r.duration_minutes, status: r.status, windowState: windowState(r),
    opensAt: r.opens_at, closesAt: r.closes_at,
    shuffleQuestions: !!r.shuffle_questions, shuffleOptions: !!r.shuffle_options,
    requireFullscreen: !!r.require_fullscreen, maxViolations: r.max_violations,
    penaltyPerMajorViolation: r.penalty_major, penaltyPerMinorViolation: r.penalty_minor,
    selectionMode: r.selection_mode, randomCount: r.random_count, randomDifficulty: r.random_difficulty,
    showAnswers: r.show_answers, resultsReleased: !!r.results_released,
    createdBy: r.created_by, publishedAt: r.published_at, createdAt: r.created_at,
    frozen: !!snap
  };
  if (opts.staff) {
    d.questionIds = json(r.question_ids, []);
    const poolSize = snap ? snap.length : null;
    d.poolSize = poolSize;
    const n = snap ? (r.selection_mode === 'random' ? Math.min(r.random_count, snap.length) : snap.length)
      : (r.selection_mode === 'random' ? null : d.questionIds.length);
    d.questionCount = n;
    d.attemptCount = db.prepare('SELECT COUNT(*) c FROM attempts WHERE exam_id=?').get(r.id).c;
  } else if (snap) {
    d.questionCount = r.selection_mode === 'random' ? Math.min(r.random_count, snap.length) : snap.length;
  }
  return d;
}

module.exports = { MAJOR, MINOR, GRACE_MS, shuffled, windowState, isEffectivelyClosed, rowToQuestion, buildSnapshot,
  gradeObjective, finalizeAttempt, reapExpired, syncCandidatesForExam, syncCandidate, examDto,
  rawScore, effectivePenalty, finalScore, percent, integrityCounts, majorCount, totalEvents };
