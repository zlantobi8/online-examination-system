require('dotenv').config();
/* DEVELOPMENT ONLY demo data. Refuses to run in production. */
const { db, now, uid, setSetting, audit } = require('./db');
const { hashPassword } = require('./lib/auth');
const E = require('./lib/exam');

function run() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production.');
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) { console.log('Database not empty; skipping seed.'); return; }
  const mkUser = (name, email, pw, role, extra) => {
    const id = uid('usr');
    db.prepare(`INSERT INTO users(id,name,email,password_hash,role,matric,staff_id,level,department,status,created_at) VALUES(?,?,?,?,?,?,?,?,?, 'active',?)`)
      .run(id, name, email, hashPassword(pw), role, extra.matric || null, extra.staffId || null, extra.level || null, extra.department || null, now());
    return id;
  };
  const admin = mkUser('System Administrator', 'admin@fpa.edu.ng', 'Admin1234', 'admin', { staffId: 'FPA/ADM/001' });
  const lec = mkUser('Dr (Mrs) Faluyi', 'lecturer@fpa.edu.ng', 'Lecturer123', 'lecturer', { staffId: 'FPA/SWD/014' });
  const co = mkUser('Engr. Bello', 'bello@fpa.edu.ng', 'Lecturer123', 'lecturer', { staffId: 'FPA/SWD/021' });
  const studs = [
    ['Omoniyi Waheed Olamilekan', 'student@fpa.edu.ng', 'FPA/CS/24/3-0254'],
    ['Akinfemi Ololade Deborah', 'ololade@fpa.edu.ng', 'FPA/CS/24/3-0091'],
    ['Dada Taiwo Christian', 'taiwo@fpa.edu.ng', 'FPA/CS/24/3-0248']
  ].map(([n, e, m]) => mkUser(n, e, 'Student123', 'student', { matric: m, level: 'HND II', department: 'Computer Science' }));

  setSetting('academic_session', '2026/2027'); setSetting('semester', 'First Semester'); setSetting('registration_open', '0');
  const mkCourse = (code, title, department, lecs) => {
    const id = uid('crs');
    db.prepare(`INSERT INTO courses(id,code,title,department,level,status,created_at) VALUES(?,?,?,?, 'HND II','active',?)`).run(id, code, title, department, now());
    lecs.forEach(l => db.prepare('INSERT INTO course_lecturers VALUES(?,?,?)').run(id, l, now()));
    return id;
  };
  const web = mkCourse('SWD 412', 'Web Application Development', 'Computer Science', [lec]);
  const dbms = mkCourse('SWD 408', 'Database Management Systems', 'Computer Science', [lec]);
  studs.forEach(s => [web, dbms].forEach(c => db.prepare(`INSERT INTO registrations(id,student_id,course_id,session_label,semester,status,created_at,submitted_at,approved_at,approved_by) VALUES(?,?,?,?,?, 'approved',?,?,?,?)`)
    .run(uid('reg'), s, c, '2026/2027', 'First Semester', now(), now(), now(), admin)));

  const addQ = (courseId, by, q) => {
    const id = uid('q');
    let options = q.options || [];
    if (q.type === 'truefalse') options = [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }];
    db.prepare(`INSERT INTO questions(id,course_id,type,text,topic,difficulty,marks,options,correct,accepted,grading,created_by,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?, 'normalized',?, 'active',?)`)
      .run(id, courseId, q.type, q.text, q.topic, q.difficulty, q.marks, JSON.stringify(options), q.correct || null, JSON.stringify(q.accepted || []), by, now());
    return id;
  };
  const mc = (text, topic, difficulty, opts, correct) => ({ type: 'mcq', text, topic, difficulty, marks: 2, options: opts.map((t, i) => ({ id: 'abcd'[i], text: t })), correct: 'abcd'[correct] });
  const tf = (text, topic, difficulty, correct) => ({ type: 'truefalse', text, topic, difficulty, marks: 2, correct: String(correct) });
  const sa = (text, topic, accepted) => ({ type: 'short', text, topic, difficulty: 'easy', marks: 3, accepted });

  const webQs = [
    mc('Which HTML element defines the most important heading on a page?', 'HTML', 'easy', ['<head>', '<h1>', '<title>', '<header>'], 1),
    mc('In the CSS box model, which property sits between the content and the border?', 'CSS', 'easy', ['margin', 'padding', 'outline', 'gap'], 1),
    mc('Which keyword declares a block-scoped variable in JavaScript?', 'JavaScript', 'easy', ['var', 'define', 'let', 'scope'], 2),
    mc('Which HTTP method is normally used to submit new data to a server?', 'HTTP', 'medium', ['GET', 'POST', 'HEAD', 'OPTIONS'], 1),
    mc('Which status code indicates that a requested resource could not be found?', 'HTTP', 'medium', ['200', '301', '404', '500'], 2),
    tf('localStorage data is cleared automatically when the browser tab is closed.', 'Storage', 'medium', false),
    tf('CSS is a case-sensitive language when matching class selectors.', 'CSS', 'hard', true),
    sa('What does the acronym DOM stand for?', 'JavaScript', ['Document Object Model']),
    sa('Which CSS property is used to change the text colour of an element?', 'CSS', ['color', 'colour']),
    { type: 'essay', text: 'Explain the difference between client-side and server-side validation, and why both are needed.', topic: 'Security', difficulty: 'medium', marks: 10 }
  ].map(q => addQ(web, lec, q));
  const coQs = [
    mc('Which HTTP status code range indicates a client error?', 'HTTP', 'medium', ['1xx', '2xx', '4xx', '5xx'], 2),
    tf('A REST API must always return JSON.', 'APIs', 'medium', false),
    sa('What does the acronym API stand for?', 'APIs', ['Application Programming Interface'])
  ].map(q => addQ(web, co, q));
  [
    mc('Which SQL clause is used to filter rows returned by a query?', 'SQL', 'easy', ['ORDER BY', 'WHERE', 'GROUP BY', 'HAVING'], 1),
    mc('A column that uniquely identifies each row in a table is called the:', 'Design', 'easy', ['foreign key', 'candidate row', 'primary key', 'index'], 2),
    tf('A foreign key may reference a primary key in another table.', 'Design', 'easy', true),
    sa('What does the acronym SQL stand for?', 'SQL', ['Structured Query Language']),
    mc('Which normal form removes partial dependency on a composite key?', 'Normalisation', 'medium', ['1NF', '2NF', '3NF', 'BCNF'], 1),
    mc('Which SQL statement removes a table and its data entirely?', 'SQL', 'medium', ['DELETE TABLE', 'REMOVE TABLE', 'DROP TABLE', 'CLEAR TABLE'], 2),
    tf('An index always makes every operation on a table faster.', 'Performance', 'hard', false),
    mc('Which clause groups rows that share a value so aggregates can be applied?', 'SQL', 'medium', ['WHERE', 'ORDER BY', 'GROUP BY', 'JOIN'], 2)
  ].forEach(q => addQ(dbms, lec, q));

  const mkExam = (course, by, title, mode, ids, extra) => {
    const id = uid('exm');
    db.prepare(`INSERT INTO exams(id,course_id,title,instructions,duration_minutes,status,selection_mode,question_ids,random_count,created_by,created_at) VALUES(?,?,?,?,?, 'draft',?,?,?,?,?)`)
      .run(id, course, title, extra.instructions || '', extra.duration, mode, JSON.stringify(ids), extra.count || 10, by, now());
    const e = db.prepare('SELECT * FROM exams WHERE id=?').get(id);
    const snap = E.buildSnapshot(e);
    db.prepare(`UPDATE exams SET status='published', snapshot=?, published_at=? WHERE id=?`).run(JSON.stringify(snap), now(), id);
    E.syncCandidatesForExam(e);
  };
  mkExam(web, lec, 'Web Application Development — Mid-Semester Test', 'fixed', webQs, { duration: 20, instructions: 'Answer all questions. Each question carries the marks shown beside it.' });
  mkExam(dbms, lec, 'Database Management Systems — Continuous Assessment', 'random', [], { duration: 15, count: 4, instructions: 'Four random questions drawn from the course bank.' });
  mkExam(web, co, 'Web Application Development — API Fundamentals Quiz', 'fixed', coQs, { duration: 10 });
  audit(null, 'DEMO_SEEDED', 'system', null);
  console.log('Demo data created (development only).');
}
module.exports = { run };
if (require.main === module) run();
