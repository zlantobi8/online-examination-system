const router = require('express').Router();
const multer = require('multer');
const XLSX = require('xlsx');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const { db, now, uid, json, audit, getSetting } = require('../db');
const A = require('../lib/auth');
const E = require('../lib/exam');
const { h, bad, notFound, conflict, forbidden, str } = require('../lib/util');

const staff = [A.requireAuth, A.requireRole('lecturer', 'admin')];
const teaches = (uidv, courseId) => !!db.prepare('SELECT 1 FROM course_lecturers WHERE course_id=? AND lecturer_id=?').get(courseId, uidv);

/* ============ question bank ============ */
function validateQuestion(b) {
  const type = b.type;
  if (!['mcq', 'truefalse', 'short', 'essay'].includes(type)) throw bad('Unknown question type.');
  const text = str(b.text, 4000);
  if (!text) throw bad('Question text is required.');
  const marks = parseInt(b.marks, 10);
  if (!(marks >= 1 && marks <= 100)) throw bad('Marks must be between 1 and 100.');
  const difficulty = ['easy', 'medium', 'hard'].includes(b.difficulty) ? b.difficulty : 'medium';
  let options = [], correct = null, accepted = [], grading = 'normalized';
  if (type === 'mcq') {
    options = (Array.isArray(b.options) ? b.options : []).map(o => ({ id: str(o.id, 4), text: str(o.text, 500) }));
    if (options.length < 2 || options.length > 6) throw bad('A multiple-choice question needs 2 to 6 options.');
    if (options.some(o => !o.text)) throw bad('Every option needs text.');
    if (new Set(options.map(o => o.id)).size !== options.length) throw bad('Duplicate option ids.');
    correct = b.correctOptionId;
    if (!options.some(o => o.id === correct)) throw bad('Select the correct option.');
  } else if (type === 'truefalse') {
    options = [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }];
    correct = b.correctOptionId;
    if (!['true', 'false'].includes(correct)) throw bad('Select whether the statement is true or false.');
  } else if (type === 'short') {
    accepted = (Array.isArray(b.acceptedAnswers) ? b.acceptedAnswers : []).map(a => str(a, 300)).filter(Boolean);
    if (!accepted.length) throw bad('Give at least one accepted answer.');
    grading = ['exact', 'case', 'normalized'].includes(b.grading) ? b.grading : 'normalized';
  }
  return { type, text, marks, difficulty, topic: str(b.topic, 100), options, correct, accepted, grading };
}
function assertCourseAccess(user, courseId) {
  const c = db.prepare('SELECT * FROM courses WHERE id=?').get(courseId);
  if (!c) throw notFound('Course not found.');
  if (user.role === 'lecturer' && !teaches(user.id, courseId)) throw forbidden('You do not teach this course.');
  return c;
}

router.get('/courses/:id/questions', staff, h((req, res) => {
  assertCourseAccess(req.user, req.params.id);
  // Each lecturer sees only their own bank on a co-taught course; admins see all.
  const rows = req.user.role === 'admin'
    ? db.prepare(`SELECT * FROM questions WHERE course_id=? AND status='active' ORDER BY created_at DESC`).all(req.params.id)
    : db.prepare(`SELECT * FROM questions WHERE course_id=? AND created_by=? AND status='active' ORDER BY created_at DESC`).all(req.params.id, req.user.id);
  res.json(rows.map(r => E.rowToQuestion(r, true)));
}));

router.post('/questions', A.requireAuth, A.requireRole('lecturer'), h((req, res) => {
  const c = assertCourseAccess(req.user, req.body.courseId);
  if (c.status !== 'active') throw bad('This course is not active.');
  const q = validateQuestion(req.body); const id = uid('q');
  db.prepare(`INSERT INTO questions(id,course_id,type,text,topic,difficulty,marks,options,correct,accepted,grading,created_by,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'active',?)`)
    .run(id, c.id, q.type, q.text, q.topic, q.difficulty, q.marks, JSON.stringify(q.options), q.correct, JSON.stringify(q.accepted), q.grading, req.user.id, now());
  audit(req.user.id, 'QUESTION_CREATED', 'question', id);
  res.status(201).json(E.rowToQuestion(db.prepare('SELECT * FROM questions WHERE id=?').get(id), true));
}));

function ownQuestion(req) {
  const r = db.prepare('SELECT * FROM questions WHERE id=?').get(req.params.id);
  if (!r) throw notFound('Question not found.');
  if (r.created_by !== req.user.id) throw forbidden('This question belongs to a colleague.');
  return r;
}
// Editing the bank never changes a published exam: exams hold their own frozen snapshot.
router.put('/questions/:id', A.requireAuth, A.requireRole('lecturer'), h((req, res) => {
  const r = ownQuestion(req);
  const q = validateQuestion(req.body);
  db.prepare(`UPDATE questions SET type=?,text=?,topic=?,difficulty=?,marks=?,options=?,correct=?,accepted=?,grading=? WHERE id=?`)
    .run(q.type, q.text, q.topic, q.difficulty, q.marks, JSON.stringify(q.options), q.correct, JSON.stringify(q.accepted), q.grading, r.id);
  audit(req.user.id, 'QUESTION_EDITED', 'question', r.id);
  res.json(E.rowToQuestion(db.prepare('SELECT * FROM questions WHERE id=?').get(r.id), true));
}));
router.delete('/questions/:id', A.requireAuth, A.requireRole('lecturer'), h((req, res) => {
  const r = ownQuestion(req);
  const inPublished = db.prepare(`SELECT id, snapshot FROM exams WHERE course_id=? AND snapshot IS NOT NULL`).all(r.course_id)
    .some(e => json(e.snapshot, []).some(q => q.id === r.id));
  db.transaction(() => {
    // Remove from any draft exam's selection.
    db.prepare(`SELECT id, question_ids FROM exams WHERE course_id=? AND status='draft'`).all(r.course_id).forEach(e => {
      const ids = json(e.question_ids, []);
      if (ids.includes(r.id)) db.prepare('UPDATE exams SET question_ids=? WHERE id=?').run(JSON.stringify(ids.filter(x => x !== r.id)), e.id);
    });
    if (inPublished) db.prepare(`UPDATE questions SET status='archived' WHERE id=?`).run(r.id); // history kept
    else db.prepare('DELETE FROM questions WHERE id=?').run(r.id);
  })();
  audit(req.user.id, inPublished ? 'QUESTION_ARCHIVED' : 'QUESTION_DELETED', 'question', r.id);
  res.json({ ok: true, archived: inPublished });
}));


/* ============ question bank import ============ */
function questionBankImportPayload(req) {
  let pkg = req.body;
  if (req.file) pkg = parseExcelImport(req);
  const sourceQuestions = Array.isArray(pkg) ? pkg : (Array.isArray(pkg?.questions) ? pkg.questions : []);
  if (!sourceQuestions.length) throw bad('The import package contains no questions.');
  return sourceQuestions.map((raw, i) => {
    const q = importQuestionShape(raw);
    const validated = validateQuestion({
      type: q.type, text: q.text, topic: q.topic, difficulty: q.difficulty,
      marks: q.marks, options: q.options, correctOptionId: q.correctOptionId,
      acceptedAnswers: q.acceptedAnswers, grading: q.grading
    });
    return { ...validated, sourceId: q.id || ('import-' + (i + 1)) };
  });
}

function importQuestionBank(req, res) {
  const courseId = req.body.courseId || req.params.id;
  const c = assertCourseAccess(req.user, courseId);
  if (c.status !== 'active') throw bad('This course is not active.');
  const imported = questionBankImportPayload(req);
  const created = db.transaction(() => imported.map(q => {
    const id = uid('q');
    db.prepare(`INSERT INTO questions(id,course_id,type,text,topic,difficulty,marks,options,correct,accepted,grading,created_by,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'active',?)`)
      .run(id, c.id, q.type, q.text, q.topic, q.difficulty, q.marks, JSON.stringify(q.options), q.correct, JSON.stringify(q.accepted), q.grading, req.user.id, now());
    return id;
  }))();
  audit(req.user.id, 'QUESTION_BANK_IMPORTED', 'course', c.id, { questionCount: created.length, source: req.file ? 'xlsx' : 'json' });
  res.status(201).json({ ok: true, courseId: c.id, importedQuestions: created.length });
}

router.post('/courses/:id/questions/import', A.requireAuth, A.requireRole('lecturer'), h(importQuestionBank));
router.post('/courses/:id/questions/import.xlsx', A.requireAuth, A.requireRole('lecturer'), upload.single('file'), h(importQuestionBank));

/* ============ exams ============ */
function examAccess(req, id) {
  const e = db.prepare('SELECT * FROM exams WHERE id=?').get(id || req.params.id);
  if (!e) throw notFound('Exam not found.');
  if (req.user.role === 'lecturer') {
    if (!teaches(req.user.id, e.course_id)) throw forbidden('You do not teach this course.');
    if (e.created_by !== req.user.id) throw forbidden('This exam belongs to a colleague.');
  }
  return e;
}
const attemptCount = id => db.prepare('SELECT COUNT(*) n FROM attempts WHERE exam_id=?').get(id).n;

router.get('/exams', staff, h((req, res) => {
  const rows = req.user.role === 'admin'
    ? db.prepare('SELECT * FROM exams ORDER BY created_at DESC').all()
    : db.prepare('SELECT * FROM exams WHERE created_by=? ORDER BY created_at DESC').all(req.user.id);
  res.json(rows.map(r => ({ ...E.examDto(r, { staff: true }), summary: summary(r.id) })));
}));
router.get('/exams/:id', staff, h((req, res) => res.json(E.examDto(examAccess(req), { staff: true }))));

function readExamBody(b, isNew) {
  const title = str(b.title, 200);
  if (!title) throw bad('Exam title is required.');
  const dur = parseInt(b.durationMinutes, 10);
  if (!(dur >= 1 && dur <= 600)) throw bad('Duration must be between 1 and 600 minutes.');
  const opens = b.opensAt ? new Date(b.opensAt) : null, closes = b.closesAt ? new Date(b.closesAt) : null;
  if ((opens && isNaN(opens)) || (closes && isNaN(closes))) throw bad('Invalid date.');
  if (opens && closes && closes <= opens) throw bad('The closing time must be after the opening time.');
  const pct = v => Math.max(0, Math.min(100, parseInt(v, 10) || 0));
  return {
    title, instructions: str(b.instructions, 4000), duration_minutes: dur,
    opens_at: opens ? opens.toISOString() : null, closes_at: closes ? closes.toISOString() : null,
    shuffle_questions: b.shuffleQuestions ? 1 : 0, shuffle_options: b.shuffleOptions ? 1 : 0,
    require_fullscreen: b.requireFullscreen ? 1 : 0,
    max_violations: Math.max(0, Math.min(50, parseInt(b.maxViolations, 10) || 0)),
    penalty_major: pct(b.penaltyPerMajorViolation), penalty_minor: pct(b.penaltyPerMinorViolation),
    selection_mode: b.selectionMode === 'random' ? 'random' : 'fixed',
    question_ids: JSON.stringify(Array.isArray(b.questionIds) ? b.questionIds.map(String) : []),
    random_count: Math.max(1, parseInt(b.randomCount, 10) || 1),
    random_difficulty: ['any', 'easy', 'medium', 'hard'].includes(b.randomDifficulty) ? b.randomDifficulty : 'any',
    show_answers: ['never', 'after_release'].includes(b.showAnswers) ? b.showAnswers : 'after_release'
  };
}

router.post('/exams', A.requireAuth, A.requireRole('lecturer'), h((req, res) => {
  const c = assertCourseAccess(req.user, req.body.courseId);
  if (c.status !== 'active') throw bad('This course is not active.');
  const f = readExamBody({ title: 'Untitled exam', durationMinutes: 30, shuffleQuestions: true, shuffleOptions: true, maxViolations: 3, ...req.body });
  const id = uid('exm');
  db.prepare(`INSERT INTO exams(id,course_id,title,instructions,duration_minutes,status,opens_at,closes_at,shuffle_questions,shuffle_options,require_fullscreen,max_violations,penalty_major,penalty_minor,selection_mode,question_ids,random_count,random_difficulty,show_answers,created_by,created_at)
    VALUES(@id,@course_id,@title,@instructions,@duration_minutes,'draft',@opens_at,@closes_at,@shuffle_questions,@shuffle_options,@require_fullscreen,@max_violations,@penalty_major,@penalty_minor,@selection_mode,@question_ids,@random_count,@random_difficulty,@show_answers,@created_by,@created_at)`)
    .run({ ...f, id, course_id: c.id, created_by: req.user.id, created_at: now() });
  audit(req.user.id, 'EXAM_CREATED', 'exam', id);
  res.status(201).json(E.examDto(db.prepare('SELECT * FROM exams WHERE id=?').get(id), { staff: true }));
}));

// Content of an exam is editable ONLY while it is a draft. After publish it is frozen.
router.put('/exams/:id', A.requireAuth, A.requireRole('lecturer'), h((req, res) => {
  const e = examAccess(req);
  if (e.status !== 'draft') throw conflict('A published exam is frozen. Unpublish it (only possible before anyone has started) or duplicate it as a new version.');
  const f = readExamBody(req.body);
  const c = assertCourseAccess(req.user, req.body.courseId || e.course_id);
  const ids = JSON.parse(f.question_ids).filter(id =>
    db.prepare(`SELECT 1 FROM questions WHERE id=? AND course_id=? AND created_by=? AND status='active'`).get(id, c.id, req.user.id));
  db.prepare(`UPDATE exams SET course_id=@course_id,title=@title,instructions=@instructions,duration_minutes=@duration_minutes,opens_at=@opens_at,closes_at=@closes_at,shuffle_questions=@shuffle_questions,shuffle_options=@shuffle_options,require_fullscreen=@require_fullscreen,max_violations=@max_violations,penalty_major=@penalty_major,penalty_minor=@penalty_minor,selection_mode=@selection_mode,question_ids=@question_ids,random_count=@random_count,random_difficulty=@random_difficulty,show_answers=@show_answers WHERE id=@id`)
    .run({ ...f, question_ids: JSON.stringify(ids), course_id: c.id, id: e.id });
  audit(req.user.id, 'EXAM_EDITED', 'exam', e.id);
  res.json(E.examDto(db.prepare('SELECT * FROM exams WHERE id=?').get(e.id), { staff: true }));
}));

router.post('/exams/:id/publish', A.requireAuth, A.requireRole('lecturer'), h((req, res) => {
  const e = examAccess(req);
  if (e.status !== 'draft') throw bad('Only a draft can be published.');
  const c = db.prepare('SELECT * FROM courses WHERE id=?').get(e.course_id);
  if (c.status !== 'active') throw bad('This course is not active.');
  const snap = E.buildSnapshot(e);
  if (snap.length === 0) throw bad('Add at least one question before publishing.');
  if (e.selection_mode === 'random' && snap.length < e.random_count)
    throw bad(`The random pool has only ${snap.length} question${snap.length === 1 ? '' : 's'} but the exam draws ${e.random_count}. Add questions or lower the count.`);
  db.transaction(() => {
    db.prepare(`UPDATE exams SET status='published', snapshot=?, published_at=? WHERE id=?`).run(JSON.stringify(snap), now(), e.id);
    E.syncCandidatesForExam({ ...e });
  })();
  audit(req.user.id, 'EXAM_PUBLISHED', 'exam', e.id, { questions: snap.length });
  res.json(E.examDto(db.prepare('SELECT * FROM exams WHERE id=?').get(e.id), { staff: true }));
}));
router.post('/exams/:id/unpublish', A.requireAuth, A.requireRole('lecturer'), h((req, res) => {
  const e = examAccess(req);
  if (e.status !== 'published') throw bad('This exam is not published.');
  if (attemptCount(e.id) > 0) throw conflict('Candidates have already started this exam, so it cannot be unpublished. Close it instead.');
  db.transaction(() => {
    db.prepare(`UPDATE exams SET status='draft', snapshot=NULL, published_at=NULL WHERE id=?`).run(e.id);
    db.prepare('DELETE FROM exam_candidates WHERE exam_id=?').run(e.id);
  })();
  audit(req.user.id, 'EXAM_UNPUBLISHED', 'exam', e.id);
  res.json({ ok: true });
}));
router.post('/exams/:id/close', staff, h((req, res) => {
  const e = examAccess(req);
  if (e.status !== 'published') throw bad('Only a published exam can be closed.');
  db.prepare(`UPDATE exams SET status='closed' WHERE id=?`).run(e.id);
  E.reapExpired();
  // Anyone still writing when the exam is closed keeps their deadline; nothing is cut short silently.
  audit(req.user.id, 'EXAM_CLOSED', 'exam', e.id);
  res.json({ ok: true });
}));
router.post('/exams/:id/archive', staff, h((req, res) => {
  const e = examAccess(req);
  if (!['closed', 'draft'].includes(e.status)) throw bad('Close the exam before archiving it.');
  db.prepare(`UPDATE exams SET status='archived' WHERE id=?`).run(e.id);
  audit(req.user.id, 'EXAM_ARCHIVED', 'exam', e.id);
  res.json({ ok: true });
}));
router.delete('/exams/:id', A.requireAuth, A.requireRole('lecturer'), h((req, res) => {
  const e = examAccess(req);
  if (e.status !== 'draft' || attemptCount(e.id) > 0) throw conflict('Only unpublished drafts with no submissions can be deleted. Archive this exam instead \u2014 its results are kept.');
  db.prepare('DELETE FROM exam_candidates WHERE exam_id=?').run(e.id);
  db.prepare('DELETE FROM exams WHERE id=?').run(e.id);
  audit(req.user.id, 'EXAM_DELETED', 'exam', e.id);
  res.json({ ok: true });
}));
router.post('/exams/:id/duplicate', A.requireAuth, A.requireRole('lecturer'), h((req, res) => {
  const e = examAccess(req); const id = uid('exm');
  db.prepare(`INSERT INTO exams(id,course_id,title,instructions,duration_minutes,status,opens_at,closes_at,shuffle_questions,shuffle_options,require_fullscreen,max_violations,penalty_major,penalty_minor,selection_mode,question_ids,random_count,random_difficulty,show_answers,created_by,created_at)
    SELECT ?,course_id,title||' (copy)',instructions,duration_minutes,'draft',NULL,NULL,shuffle_questions,shuffle_options,require_fullscreen,max_violations,penalty_major,penalty_minor,selection_mode,question_ids,random_count,random_difficulty,show_answers,?,? FROM exams WHERE id=?`)
    .run(id, req.user.id, now(), e.id);
  audit(req.user.id, 'EXAM_DUPLICATED', 'exam', id, { from: e.id });
  res.status(201).json({ id });
}));
router.post('/exams/:id/release-results', staff, h((req, res) => {
  const e = examAccess(req);
  const release = req.body.release !== false;
  db.prepare('UPDATE exams SET results_released=? WHERE id=?').run(release ? 1 : 0, e.id);
  audit(req.user.id, release ? 'RESULTS_RELEASED' : 'RESULTS_WITHHELD', 'exam', e.id);
  res.json({ ok: true, released: release });
}));


/* ============ exam import / export ============ */
function importQuestionShape(q) {
  return validateQuestion({
    type: q.type, text: q.text, marks: q.marks, difficulty: q.difficulty, topic: q.topic,
    options: q.options, correctOptionId: q.correctOptionId, acceptedAnswers: q.acceptedAnswers, grading: q.grading
  });
}

router.get('/exams/:id/export', A.requireAuth, A.requireRole('lecturer'), h((req, res) => {
  const e = examAccess(req);
  const c = db.prepare('SELECT id,code,title FROM courses WHERE id=?').get(e.course_id);
  res.json(exportExamPackage(e, c));
}));

function exportExamPackage(e, c) {
  let questions = [];
  if (e.snapshot) {
    questions = json(e.snapshot, []);
  } else {
    const ids = json(e.question_ids, []);
    let rows;
    if (e.selection_mode === 'random') {
      rows = db.prepare(`SELECT * FROM questions WHERE course_id=? AND created_by=? AND status='active'`).all(e.course_id, e.created_by);
      if (e.random_difficulty && e.random_difficulty !== 'any') rows = rows.filter(r => r.difficulty === e.random_difficulty);
      rows = rows.filter(r => r.type !== 'essay');
    } else rows = ids.map(id => db.prepare('SELECT * FROM questions WHERE id=? AND course_id=? AND created_by=?').get(id, e.course_id, e.created_by)).filter(Boolean);
    questions = rows.map(r => E.rowToQuestion(r, true));
  }
  return {
    format: 'ExamSuite exam package', version: 1, exportedAt: now(),
    exam: { title: e.title, instructions: e.instructions, durationMinutes: e.duration_minutes,
      opensAt: e.opens_at, closesAt: e.closes_at, shuffleQuestions: !!e.shuffle_questions,
      shuffleOptions: !!e.shuffle_options, requireFullscreen: !!e.require_fullscreen, maxViolations: e.max_violations,
      penaltyPerMajorViolation: e.penalty_major, penaltyPerMinorViolation: e.penalty_minor,
      selectionMode: e.selection_mode, randomCount: e.random_count, randomDifficulty: e.random_difficulty,
      showAnswers: e.show_answers },
    course: c, questions
  };
}

function questionToExcelRow(q, i) {
  const opts = Array.isArray(q.options) ? q.options : [];
  const row = {
    No: i + 1, Type: q.type, Question: q.text, Topic: q.topic || '', Difficulty: q.difficulty || 'medium', Marks: q.marks,
    'Option A': opts[0]?.text || '', 'Option B': opts[1]?.text || '', 'Option C': opts[2]?.text || '', 'Option D': opts[3]?.text || '',
    'Option E': opts[4]?.text || '', 'Option F': opts[5]?.text || '', 'Correct Answer': q.correctOptionId || '',
    'Accepted Answers': Array.isArray(q.acceptedAnswers) ? q.acceptedAnswers.join(' | ') : '', Grading: q.grading || 'normalized'
  };
  if (q.type === 'truefalse') row['Correct Answer'] = q.correctOptionId === 'true' ? 'True' : q.correctOptionId === 'false' ? 'False' : q.correctOptionId;
  return row;
}

router.get('/exams/excel-template', A.requireAuth, A.requireRole('lecturer'), h((req, res) => {
  const wb = XLSX.utils.book_new();
  const info = [['ExamSuite Excel Package', 'Version', 1], ['Title', 'Imported Exam'], ['Instructions', ''], ['Duration Minutes', 30], ['Shuffle Questions', 'Yes'], ['Shuffle Options', 'Yes'], ['Require Fullscreen', 'No'], ['Max Violations', 3], ['Penalty Major (%)', 0], ['Penalty Minor (%)', 0], ['Selection Mode', 'fixed'], ['Random Count', ''], ['Random Difficulty', 'any'], ['Show Answers', 'No']];
  const questions = [{ No: 1, Type: 'mcq', Question: 'Example question — replace this row', Topic: '', Difficulty: 'medium', Marks: 1, 'Option A': 'First option', 'Option B': 'Second option', 'Option C': '', 'Option D': '', 'Option E': '', 'Option F': '', 'Correct Answer': 'A', 'Accepted Answers': '', Grading: 'normalized' }];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(info), 'Exam Info');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(questions), 'Questions');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', 'attachment; filename="exam-import-template.xlsx"');
  res.send(buf);
}));

router.get('/exams/:id/export.xlsx', A.requireAuth, A.requireRole('lecturer'), h((req, res) => {
  const e = examAccess(req);
  const c = db.prepare('SELECT id,code,title FROM courses WHERE id=?').get(e.course_id);
  const pkg = exportExamPackage(e, c);
  const wb = XLSX.utils.book_new();
  const info = [
    ['ExamSuite Excel Package', 'Version', 1],
    ['Title', pkg.exam.title], ['Instructions', pkg.exam.instructions || ''], ['Duration Minutes', pkg.exam.durationMinutes],
    ['Shuffle Questions', pkg.exam.shuffleQuestions ? 'Yes' : 'No'], ['Shuffle Options', pkg.exam.shuffleOptions ? 'Yes' : 'No'],
    ['Require Fullscreen', pkg.exam.requireFullscreen ? 'Yes' : 'No'], ['Max Violations', pkg.exam.maxViolations],
    ['Penalty Major (%)', pkg.exam.penaltyPerMajorViolation], ['Penalty Minor (%)', pkg.exam.penaltyPerMinorViolation],
    ['Selection Mode', pkg.exam.selectionMode], ['Random Count', pkg.exam.randomCount || ''], ['Random Difficulty', pkg.exam.randomDifficulty || 'any'],
    ['Show Answers', pkg.exam.showAnswers ? 'Yes' : 'No'], ['Course Code', c?.code || ''], ['Course Title', c?.title || '']
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(info), 'Exam Info');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pkg.questions.map(questionToExcelRow)), 'Questions');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = (pkg.exam.title || 'exam').replace(/[^a-z0-9_-]+/gi, '-').replace(/-+/g, '-') + '-exam.xlsx';
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
}));

function parseExcelImport(req) {
  if (!req.file) throw bad('Choose an Excel (.xlsx) file.');
  const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
  const sheet = wb.Sheets['Questions'] || wb.Sheets[wb.SheetNames.find(n => n.toLowerCase() === 'questions') || wb.SheetNames[0]];
  if (!sheet) throw bad('The Excel file has no Questions sheet.');
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (!rows.length) throw bad('The Questions sheet is empty.');
  const infoSheet = wb.Sheets['Exam Info'];
  const infoRows = infoSheet ? XLSX.utils.sheet_to_json(infoSheet, { header: ['key', 'value', 'extra'], defval: '' }) : [];
  const info = {};
  infoRows.forEach(r => { if (r.key) info[String(r.key).trim().toLowerCase()] = r.value; });
  return {
    format: 'ExamSuite exam package', version: 1,
    courseId: req.body.courseId,
    exam: {
      title: info.title || req.body.title || 'Imported exam', instructions: info.instructions || '',
      durationMinutes: Number(info['duration minutes']) || 30,
      shuffleQuestions: /^yes|true|1$/i.test(String(info['shuffle questions'])), shuffleOptions: /^yes|true|1$/i.test(String(info['shuffle options'])),
      requireFullscreen: /^yes|true|1$/i.test(String(info['require fullscreen'])), maxViolations: Number(info['max violations']) || 3,
      penaltyPerMajorViolation: Number(info['penalty major (%)']) || 0, penaltyPerMinorViolation: Number(info['penalty minor (%)']) || 0,
      selectionMode: String(info['selection mode'] || 'fixed').toLowerCase() === 'random' ? 'random' : 'fixed',
      randomCount: Number(info['random count']) || null, randomDifficulty: info['random difficulty'] || 'any', showAnswers: /^yes|true|1$/i.test(String(info['show answers']))
    },
    questions: rows.map((r, i) => {
      const type = String(r.Type || r.type || 'mcq').trim().toLowerCase();
      const options = ['A','B','C','D','E','F'].map(letter => ({ id: letter.toLowerCase(), text: String(r['Option ' + letter] || '').trim() })).filter(o => o.text);
      let correct = String(r['Correct Answer'] ?? r.correct ?? '').trim();
      if (type === 'truefalse') correct = /^true$/i.test(correct) ? 'true' : /^false$/i.test(correct) ? 'false' : correct.toLowerCase();
      else if (type === 'mcq') { const m = correct.match(/^[A-F]$/i); if (m) correct = m[0].toLowerCase(); else { const hit = options.find(o => o.text.toLowerCase() === correct.toLowerCase()); correct = hit ? hit.id : correct; } }
      const accepted = String(r['Accepted Answers'] ?? r.acceptedAnswers ?? '').split('|').map(x => x.trim()).filter(Boolean);
      return { id: 'excel-' + (i + 1), type, text: String(r.Question ?? r.question ?? '').trim(), topic: String(r.Topic ?? r.topic ?? '').trim(), difficulty: String(r.Difficulty || 'medium').toLowerCase(), marks: Number(r.Marks) || 1, options, correctOptionId: correct, acceptedAnswers: accepted, grading: String(r.Grading || 'normalized').toLowerCase() };
    })
  };
}

function validateImportPackage(req, pkg) {
  if (!pkg || pkg.format !== 'ExamSuite exam package' || pkg.version !== 1) throw bad('Invalid ExamSuite exam package.');
  const c = assertCourseAccess(req.user, pkg.courseId || pkg.course?.id || req.body.targetCourseId);
  if (c.status !== 'active') throw bad('This course is not active.');
  if (!pkg.exam || !Array.isArray(pkg.questions)) throw bad('The package must contain exam settings and questions.');
  const imported = pkg.questions.map(importQuestionShape);
  if (!imported.length) throw bad('The exam package contains no questions.');
  return { c, imported };
}

function importPreview(pkg, req) {
  const { c, imported } = validateImportPackage(req, pkg);
  return {
    course: { id: c.id, code: c.code, title: c.title },
    exam: pkg.exam,
    questionCount: imported.length,
    totalMarks: imported.reduce((sum, q) => sum + q.marks, 0),
    questions: imported.map((q, i) => ({ number: i + 1, type: q.type, text: q.text, marks: q.marks, topic: q.topic, difficulty: q.difficulty }))
  };
}

router.post('/exams/import/preview', A.requireAuth, A.requireRole('lecturer'), h((req, res) => {
  res.json(importPreview(req.body, req));
}));

router.post('/exams/import.xlsx/preview', A.requireAuth, A.requireRole('lecturer'), upload.single('file'), h((req, res) => {
  const pkg = parseExcelImport(req);
  res.json(importPreview(pkg, req));
}));

router.post('/exams/import.xlsx', A.requireAuth, A.requireRole('lecturer'), upload.single('file'), h((req, res) => {
  const pkg = parseExcelImport(req);
  req.body = pkg;
  return importExamPackage(req, res);
}));

function importExamPackage(req, res) {
  const pkg = req.body;
  const { c, imported } = validateImportPackage(req, pkg);
  const createdQuestions = [];
  const tx = db.transaction(() => {
    for (const q of imported) {
      const id = uid('q');
      db.prepare(`INSERT INTO questions(id,course_id,type,text,topic,difficulty,marks,options,correct,accepted,grading,created_by,status,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'active',?)`)
        .run(id, c.id, q.type, q.text, q.topic, q.difficulty, q.marks, JSON.stringify(q.options), q.correct, JSON.stringify(q.accepted), q.grading, req.user.id, now());
      createdQuestions.push(id);
    }
    const f = readExamBody({ ...pkg.exam, courseId: c.id, questionIds: createdQuestions, selectionMode: pkg.exam.selectionMode === 'random' ? 'random' : 'fixed' });
    const id = uid('exm');
    db.prepare(`INSERT INTO exams(id,course_id,title,instructions,duration_minutes,status,opens_at,closes_at,shuffle_questions,shuffle_options,require_fullscreen,max_violations,penalty_major,penalty_minor,selection_mode,question_ids,random_count,random_difficulty,show_answers,created_by,created_at)
      VALUES(@id,@course_id,@title,@instructions,@duration_minutes,'draft',@opens_at,@closes_at,@shuffle_questions,@shuffle_options,@require_fullscreen,@max_violations,@penalty_major,@penalty_minor,@selection_mode,@question_ids,@random_count,@random_difficulty,@show_answers,@created_by,@created_at)`)
      .run({ ...f, id, course_id: c.id, created_by: req.user.id, created_at: now() });
    audit(req.user.id, 'EXAM_IMPORTED', 'exam', id, { questionCount: createdQuestions.length, source: req.file ? 'xlsx' : 'json' });
    return id;
  });
  const id = tx();
  res.status(201).json({ id, title: pkg.exam.title, importedQuestions: createdQuestions.length });
}

router.post('/exams/import', A.requireAuth, A.requireRole('lecturer'), h(importExamPackage));

/* ============ results / analytics ============ */
function summary(examId) {
  const a = db.prepare(`SELECT * FROM attempts WHERE exam_id=? AND status!='in-progress'`).all(examId);
  const pcts = a.map(E.percent);
  return {
    submitted: a.length,
    average: pcts.length ? Math.round(pcts.reduce((s, v) => s + v, 0) / pcts.length) : 0,
    highest: pcts.length ? Math.max(...pcts) : 0, lowest: pcts.length ? Math.min(...pcts) : 0,
    passRate: pcts.length ? Math.round(pcts.filter(p => p >= 50).length / pcts.length * 100) : 0,
    awaitingMarking: a.filter(x => x.status === 'awaiting-marking').length
  };
}
const attemptRow = (a, student) => ({
  id: a.id, studentId: a.student_id, student: student ? { name: student.name, matric: student.matric } : null,
  status: a.status, submittedAt: a.submitted_at, startedAt: a.started_at, totalMarks: a.total_marks,
  autoScore: a.auto_score, rawScore: E.rawScore(a), penalty: E.effectivePenalty(a), penaltyWaived: !!a.penalty_waived,
  rawPenalty: a.integrity_penalty, score: E.finalScore(a), percent: E.percent(a),
  integrityCounts: E.integrityCounts(a), integrityTotal: E.totalEvents(a), integrityMajor: E.majorCount(a),
  autoSubmitReason: a.auto_submit_reason
});

router.get('/exams/:id/results', staff, h((req, res) => {
  E.reapExpired();
  const e = examAccess(req);
  const course = db.prepare('SELECT code,title FROM courses WHERE id=?').get(e.course_id);
  const all = db.prepare('SELECT * FROM attempts WHERE exam_id=?').all(e.id);
  const sub = all.filter(a => a.status !== 'in-progress');
  const users = new Map(db.prepare(`SELECT id,name,matric FROM users WHERE id IN (SELECT student_id FROM attempts WHERE exam_id=?)`).all(e.id).map(u => [u.id, u]));
  // Roster comes from the frozen candidate list, not today's registrations.
  const sat = new Set(all.map(a => a.student_id));
  const absent = db.prepare(`SELECT u.id,u.name,u.matric FROM exam_candidates c JOIN users u ON u.id=c.student_id WHERE c.exam_id=? AND c.status='eligible' ORDER BY u.name`).all(e.id)
    .filter(u => !sat.has(u.id));
  const candidateCount = db.prepare(`SELECT COUNT(*) n FROM exam_candidates WHERE exam_id=? AND status='eligible'`).get(e.id).n;
  const snap = json(e.snapshot, []);
  const stats = snap.map(q => {
    let seen = 0, correct = 0;
    sub.forEach(a => {
      if (!json(a.question_order, []).includes(q.id)) return;
      seen++;
      const earned = q.type === 'essay' ? (json(a.manual_scores, {})[q.id] || 0) : E.gradeObjective(q, json(a.answers, {})[q.id]);
      if (earned === q.marks) correct++;
    });
    return { question: { id: q.id, text: q.text, type: q.type, difficulty: q.difficulty }, seen, correctRate: seen ? Math.round(correct / seen * 100) : 0 };
  }).filter(s => s.seen > 0);
  res.json({
    exam: E.examDto(e, { staff: true }), course, summary: summary(e.id), candidateCount,
    inProgress: all.length - sub.length,
    attempts: sub.map(a => attemptRow(a, users.get(a.student_id))).sort((a, b) => b.percent - a.percent),
    absent, stats
  });
}));

router.post('/attempts/:id/waive-penalty', staff, h((req, res) => {
  const a = db.prepare('SELECT * FROM attempts WHERE id=?').get(req.params.id);
  if (!a) throw notFound();
  examAccess(req, a.exam_id);
  const waive = req.body.waive !== false;
  db.prepare('UPDATE attempts SET penalty_waived=? WHERE id=?').run(waive ? 1 : 0, a.id);
  audit(req.user.id, waive ? 'PENALTY_WAIVED' : 'PENALTY_REINSTATED', 'attempt', a.id, { penalty: a.integrity_penalty, reason: str(req.body.reason, 300) });
  res.json({ ok: true });
}));

/* ============ marking (essay questions) ============ */
router.get('/marking', staff, h((req, res) => {
  const exams = (req.user.role === 'admin' ? db.prepare('SELECT * FROM exams').all()
    : db.prepare('SELECT * FROM exams WHERE created_by=?').all(req.user.id))
    .filter(e => !req.query.exam || e.id === req.query.exam);
  const out = [];
  exams.forEach(e => {
    const snap = json(e.snapshot, []);
    db.prepare(`SELECT * FROM attempts WHERE exam_id=? AND status='awaiting-marking' ORDER BY submitted_at`).all(e.id).forEach(a => {
      const st = db.prepare('SELECT name,matric FROM users WHERE id=?').get(a.student_id);
      const answers = json(a.answers, {}), manual = json(a.manual_scores, {});
      const essays = json(a.question_order, []).map(id => snap.find(q => q.id === id)).filter(q => q && q.type === 'essay')
        .map(q => ({ id: q.id, text: q.text, marks: q.marks, answer: answers[q.id] || '', current: manual[q.id] === undefined ? null : manual[q.id] }));
      out.push({ attemptId: a.id, exam: { id: e.id, title: e.title }, course: db.prepare('SELECT code FROM courses WHERE id=?').get(e.course_id),
        student: st, submittedAt: a.submitted_at, autoScore: a.auto_score, totalMarks: a.total_marks, essays });
    });
  });
  res.json(out);
}));
router.put('/attempts/:id/marks', staff, h((req, res) => {
  const a = db.prepare('SELECT * FROM attempts WHERE id=?').get(req.params.id);
  if (!a) throw notFound();
  const e = examAccess(req, a.exam_id);
  if (a.status === 'in-progress') throw bad('This paper has not been submitted yet.');
  const snap = json(e.snapshot, []);
  const essayIds = json(a.question_order, []).filter(id => (snap.find(q => q.id === id) || {}).type === 'essay');
  const manual = json(a.manual_scores, {}); const changes = [];
  Object.entries(req.body.marks || {}).forEach(([qid, v]) => {
    if (!essayIds.includes(qid)) return;
    const q = snap.find(x => x.id === qid); const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > q.marks) throw bad(`Marks for an essay must be between 0 and ${q.marks}.`);
    if (manual[qid] !== n) changes.push({ questionId: qid, old: manual[qid] === undefined ? null : manual[qid], new: n });
    manual[qid] = n;
  });
  const done = essayIds.every(id => manual[id] !== undefined);
  db.prepare('UPDATE attempts SET manual_scores=?, status=? WHERE id=?').run(JSON.stringify(manual), done ? 'marked' : 'awaiting-marking', a.id);
  // No lecturer release step: once every essay on this attempt has been marked,
  // the result is released automatically to the student.
  if (done) {
    db.prepare('UPDATE exams SET results_released=1 WHERE id=?').run(a.exam_id);
  }
  audit(req.user.id, 'RESULT_MARK_CHANGED', 'attempt', a.id, { changes, reason: str(req.body.reason, 300) || null });
  res.json({ ok: true, complete: done });
}));

/* ============ lecturer dashboard ============ */
router.get('/lecturer/dashboard', A.requireAuth, A.requireRole('lecturer'), h((req, res) => {
  const { courseDto } = require('./admin');
  const courses = db.prepare(`SELECT c.* FROM courses c JOIN course_lecturers cl ON cl.course_id=c.id WHERE cl.lecturer_id=? ORDER BY c.code`).all(req.user.id)
    .map(c => ({ ...courseDto(c, false), questionCount: db.prepare(`SELECT COUNT(*) n FROM questions WHERE course_id=? AND created_by=? AND status='active'`).get(c.id, req.user.id).n,
      examCount: db.prepare('SELECT COUNT(*) n FROM exams WHERE course_id=? AND created_by=?').get(c.id, req.user.id).n }));
  const exams = db.prepare('SELECT * FROM exams WHERE created_by=? ORDER BY created_at DESC').all(req.user.id);
  const dtos = exams.map(r => ({ ...E.examDto(r, { staff: true }), summary: summary(r.id) }));
  res.json({ courses, exams: dtos,
    bankTotal: courses.reduce((s, c) => s + c.questionCount, 0),
    awaiting: dtos.reduce((s, e) => s + e.summary.awaitingMarking, 0),
    submitted: dtos.reduce((s, e) => s + e.summary.submitted, 0),
    liveNow: dtos.filter(e => e.windowState === 'open').length });
}));

module.exports = { router, summary };
