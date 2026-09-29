require('dotenv').config();
process.env.NODE_ENV = 'test';
const assert = require('assert');
const { db, setSetting } = require('./db');
require('./seed').run();
const { createApp } = require('./server');

let pass = 0, failN = 0;
const check = async (name, fn) => {
  try { await fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { failN++; console.log('FAIL  ' + name + '\n      ' + e.message); }
};

const server = createApp().listen(0);
const base = 'http://127.0.0.1:' + server.address().port;

function client() {
  let cookie = '';
  const call = async (method, url, body, opts) => {
    const headers = { 'Content-Type': 'application/json' };
    if (!(opts && opts.noCsrf)) headers['X-Requested-With'] = 'oes';
    if (cookie) headers.Cookie = cookie;
    const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    let data = null; try { data = await r.json(); } catch (e) {}
    return { status: r.status, data };
  };
  return { get: (u) => call('GET', u), post: (u, b, o) => call('POST', u, b || {}, o), put: (u, b) => call('PUT', u, b || {}),
    del: (u) => call('DELETE', u), patch: (u, b) => call('PATCH', u, b || {}) };
}
async function login(email, pw) { const c = client(); const r = await c.post('/api/auth/login', { email, password: pw }); assert.strictEqual(r.status, 200, 'login ' + email); return c; }

(async () => {
  const admin = await login('admin@fpa.edu.ng', 'Admin1234');
  const lec = await login('lecturer@fpa.edu.ng', 'Lecturer123');
  const co = await login('bello@fpa.edu.ng', 'Lecturer123');
  const stu = await login('student@fpa.edu.ng', 'Student123');
  const stu2 = await login('ololade@fpa.edu.ng', 'Student123');

  console.log('\nAuthentication & authorisation');
  await check('passwords are stored hashed, never plaintext', () => {
    const rows = db.prepare('SELECT password_hash FROM users').all();
    assert(rows.every(r => r.password_hash.startsWith('s1$') && !/Student123|Admin1234|Lecturer123/.test(r.password_hash)));
  });
  await check('wrong password rejected; unknown email gives same message', async () => {
    const c = client();
    const a = await c.post('/api/auth/login', { email: 'student@fpa.edu.ng', password: 'nope' });
    const b = await c.post('/api/auth/login', { email: 'ghost@x.com', password: 'nope' });
    assert.strictEqual(a.status, 401); assert.strictEqual(b.status, 401); assert.strictEqual(a.data.error, b.data.error);
  });
  await check('state-changing request without CSRF header is blocked', async () => {
    const r = await client().post('/api/auth/login', { email: 'x@x.com', password: 'y' }, { noCsrf: true });
    assert.strictEqual(r.status, 403);
  });
  await check('no session -> 401', async () => assert.strictEqual((await client().get('/api/my/exams')).status, 401));
  await check('student cannot reach admin or lecturer endpoints', async () => {
    assert.strictEqual((await stu.get('/api/users')).status, 403);
    assert.strictEqual((await stu.post('/api/users', { role: 'admin' })).status, 403);
    assert.strictEqual((await stu.get('/api/exams')).status, 403);
  });
  await check('lecturer cannot create users or change roles', async () => {
    assert.strictEqual((await lec.post('/api/users', { role: 'lecturer' })).status, 403);
  });
  await check('public sign-up can only create a student, and takes no courses', async () => {
    const c = client();
    const r = await c.post('/api/auth/register', { name: 'Test Person', email: 'new@x.com', matric: 'FPA/CS/24/3-0999', level: 'HND II', password: 'Passw0rd1', role: 'admin', courseIds: ['x'] });
    assert.strictEqual(r.status, 201); assert.strictEqual(r.data.user.role, 'student');
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM registrations WHERE student_id=?').get(r.data.user.id).n, 0);
  });
  await check('duplicate matric / weak password / bad matric rejected', async () => {
    const c = client();
    const base = { name: 'Test Person', email: 'n2@x.com', matric: 'FPA/CS/24/3-0254', level: 'HND II', password: 'Passw0rd1' };
    assert.strictEqual((await c.post('/api/auth/register', base)).status, 400);
    assert.strictEqual((await c.post('/api/auth/register', { ...base, matric: 'FPA/CS/24/3-0777', password: 'short' })).status, 400);
    assert.strictEqual((await c.post('/api/auth/register', { ...base, matric: 'nonsense' })).status, 400);
  });
  await check('account locks after 5 failed logins', async () => {
    const c = client();
    for (let i = 0; i < 5; i++) await c.post('/api/auth/login', { email: 'taiwo@fpa.edu.ng', password: 'bad' });
    const r = await c.post('/api/auth/login', { email: 'taiwo@fpa.edu.ng', password: 'Student123' });
    assert.strictEqual(r.status, 429);
  });

  console.log('\nCourse registration rules');
  const newStu = client();
  const reg = await newStu.post('/api/auth/login', { email: 'new@x.com', password: 'Passw0rd1' });
  await check('registration closed -> student cannot add courses', async () => {
    const av = await newStu.get('/api/my/registration');
    assert.strictEqual(av.data.registrationOpen, false);
    const r = await newStu.post('/api/registrations', { courseId: av.data.available[0].id });
    assert.strictEqual(r.status, 409);
  });
  setSetting('registration_open', '1');
  let courseId;
  await check('open window: add course, wrong-level course refused', async () => {
    const av = await newStu.get('/api/my/registration');
    courseId = av.data.available[0].id;
    assert.strictEqual((await newStu.post('/api/registrations', { courseId })).status, 201);
    const c = await admin.post('/api/courses', { code: 'ND 101', title: 'Other level', level: 'ND I' });
    assert.strictEqual((await newStu.post('/api/registrations', { courseId: c.data.id })).status, 400);
  });
  await check('draft can be dropped; after submit it is LOCKED', async () => {
    assert.strictEqual((await newStu.del('/api/registrations/' + courseId)).status, 200);
    assert.strictEqual((await newStu.post('/api/registrations', { courseId })).status, 201);
    assert.strictEqual((await newStu.post('/api/registrations/submit')).status, 200);
    assert.strictEqual((await newStu.del('/api/registrations/' + courseId)).status, 409);
    const av = await newStu.get('/api/my/registration');
    assert.strictEqual((await newStu.post('/api/registrations', { courseId: (av.data.available[0] || {}).id })).status, 409);
  });
  await check('submitted-but-unapproved student is not an exam candidate', async () => {
    const r = await newStu.get('/api/my/exams');
    assert.strictEqual(r.data.exams.length, 0);
  });
  await check('admin approval makes them a candidate of already-published exams', async () => {
    const list = await admin.get('/api/admin/registrations');
    const mine = list.data.find(x => x.student.matric === 'FPA/CS/24/3-0999' && x.status === 'submitted');
    assert((await admin.post('/api/admin/registrations/' + mine.id + '/approve')).status === 200);
    const r = await newStu.get('/api/my/exams');
    assert(r.data.exams.length >= 1);
  });

  console.log('\nExam integrity');
  const exams = (await lec.get('/api/exams')).data;
  const webExam = exams.find(e => e.title.startsWith('Web Application'));
  let att;
  await check('a student cannot start an exam they are not a candidate for', async () => {
    const outsider = client(); await outsider.post('/api/auth/register', { name: 'Out Sider', email: 'o@x.com', matric: 'FPA/CS/24/3-0555', level: 'HND II', password: 'Passw0rd1' });
    assert.strictEqual((await outsider.post('/api/exams/' + webExam.id + '/start')).status, 403);
  });
  await check('paper sent to browser contains NO answers', async () => {
    const r = await stu.post('/api/exams/' + webExam.id + '/start');
    assert.strictEqual(r.status, 200); att = r.data;
    const s = JSON.stringify(r.data);
    assert(!/correctOptionId|acceptedAnswers|"correct"|Document Object Model/.test(s), 'answer leaked');
    assert(att.questions.length === 10);
  });
  await check('timer is server-owned: deadline is set by the server', () => {
    const ms = new Date(att.deadline) - new Date(att.startedAt);
    assert.strictEqual(ms, 20 * 60000);
  });
  await check('cannot answer a question with an option that does not exist', async () => {
    const q = att.questions.find(q => q.type === 'mcq');
    assert.strictEqual((await stu.put(`/api/attempts/${att.id}/answers/${q.id}`, { value: 'zzz' })).status, 400);
  });
  await check("another student cannot read or write someone's attempt", async () => {
    assert.strictEqual((await stu2.get('/api/attempts/' + att.id)).status, 404);
    assert.strictEqual((await stu2.put(`/api/attempts/${att.id}/answers/${att.questions[0].id}`, { value: 'a' })).status, 404);
  });
  // answer everything correctly using the DB (server knowledge) to prove server-side scoring
  const snap = JSON.parse(db.prepare('SELECT snapshot FROM exams WHERE id=?').get(webExam.id).snapshot);
  await check('score is computed by the server from the frozen snapshot', async () => {
    for (const q of att.questions) {
      const sq = snap.find(x => x.id === q.id);
      let v = sq.type === 'short' ? sq.acceptedAnswers[0] : sq.type === 'essay' ? 'Client validation is for UX; server validation is for security.' : sq.correctOptionId;
      if (sq.id === att.questions[0].id) v = sq.type === 'short' ? 'wrong' : (sq.options.find(o => o.id !== sq.correctOptionId) || {}).id || v;
      assert.strictEqual((await stu.put(`/api/attempts/${att.id}/answers/${q.id}`, { value: v })).status, 200);
    }
    const r = await stu.post(`/api/attempts/${att.id}/submit`);
    assert.strictEqual(r.status, 200);
    const row = db.prepare('SELECT * FROM attempts WHERE id=?').get(att.id);
    assert.strictEqual(row.status, 'awaiting-marking'); // essay present
    assert(row.auto_score > 0 && row.auto_score < row.total_marks);
  });
  await check('cannot answer or restart after submission', async () => {
    assert.strictEqual((await stu.put(`/api/attempts/${att.id}/answers/${att.questions[1].id}`, { value: 'a' })).status, 409);
    assert.strictEqual((await stu.post('/api/exams/' + webExam.id + '/start')).status, 409);
  });
  await check('result hidden until lecturer releases; then score visible; answers held back until exam closes', async () => {
    let r = await stu.get('/api/attempts/' + att.id);
    assert.strictEqual(r.data.released, false); assert.strictEqual(r.data.score, undefined);
    assert.strictEqual((await lec.post(`/api/exams/${webExam.id}/release-results`)).status, 200);
    r = await stu.get('/api/attempts/' + att.id);
    assert.strictEqual(r.data.released, true); assert(r.data.score >= 0); assert.strictEqual(r.data.canReview, false);
    assert(!JSON.stringify(r.data).includes('correctText') && !JSON.stringify(r.data).includes('accepted'));
  });
  await check('lecturer marks essay; change is written to the audit log with old/new values', async () => {
    const q = await lec.get('/api/marking');
    const item = q.data.find(x => x.attemptId === att.id);
    assert(item && item.essays.length === 1);
    assert.strictEqual((await lec.put(`/api/attempts/${att.id}/marks`, { marks: { [item.essays[0].id]: 999 } })).status, 400);
    assert.strictEqual((await lec.put(`/api/attempts/${att.id}/marks`, { marks: { [item.essays[0].id]: 7 }, reason: 'first mark' })).status, 200);
    assert.strictEqual((await lec.put(`/api/attempts/${att.id}/marks`, { marks: { [item.essays[0].id]: 8 }, reason: 're-mark' })).status, 200);
    const log = db.prepare(`SELECT detail FROM audit_logs WHERE action='RESULT_MARK_CHANGED' ORDER BY id DESC LIMIT 1`).get();
    assert(/"old":7/.test(log.detail) && /"new":8/.test(log.detail));
    assert.strictEqual(db.prepare('SELECT status FROM attempts WHERE id=?').get(att.id).status, 'marked');
  });
  await check('co-lecturer cannot see or mark a colleague\u2019s exam', async () => {
    assert.strictEqual((await co.get('/api/exams/' + webExam.id)).status, 403);
    assert.strictEqual((await co.put(`/api/attempts/${att.id}/marks`, { marks: {} })).status, 403);
  });

  console.log('\nTimer enforced by server');
  const dbmsExam = exams.find(e => e.title.startsWith('Database'));
  await check('answers after the server deadline are refused and the paper is auto-submitted', async () => {
    const r = await stu2.post('/api/exams/' + dbmsExam.id + '/start');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.questions.length, 4);
    const q = r.data.questions[0];
    assert.strictEqual((await stu2.put(`/api/attempts/${r.data.id}/answers/${q.id}`, { value: q.options[0].id })).status, 200);
    db.prepare('UPDATE attempts SET deadline=? WHERE id=?').run(new Date(Date.now() - 60000).toISOString(), r.data.id);
    const late = await stu2.put(`/api/attempts/${r.data.id}/answers/${q.id}`, { value: q.options[1].id });
    assert.strictEqual(late.status, 409);
    const row = db.prepare('SELECT * FROM attempts WHERE id=?').get(r.data.id);
    assert(row.status !== 'in-progress' && /time ran out/.test(row.auto_submit_reason));
  });
  await check('abandoned paper is graded by the background sweep, not by a browser', async () => {
    const s3 = await login('student@fpa.edu.ng', 'Student123');
    const co2 = exams.find(e => e.title.startsWith('Web Application') && false);
    const coExam = (await co.get('/api/exams')).data[0];
    const r = await s3.post('/api/exams/' + coExam.id + '/start'); assert.strictEqual(r.status, 200);
    db.prepare('UPDATE attempts SET deadline=? WHERE id=?').run(new Date(Date.now() - 60000).toISOString(), r.data.id);
    require('./lib/exam').reapExpired();
    assert.notStrictEqual(db.prepare('SELECT status FROM attempts WHERE id=?').get(r.data.id).status, 'in-progress');
  });
  await check('tab-switch events are counted server-side and auto-submit at the threshold', async () => {
    const s = await login('new@x.com', 'Passw0rd1');
    const list = (await s.get('/api/my/exams')).data.exams;
    const ex = list.find(e => e.title.startsWith('Database'));
    const r = await s.post('/api/exams/' + ex.id + '/start'); assert.strictEqual(r.status, 200);
    assert.strictEqual((await s.post(`/api/attempts/${r.data.id}/integrity`, { type: 'bogus' })).status, 400);
    await s.post(`/api/attempts/${r.data.id}/integrity`, { type: 'tab_hidden' });
    await s.post(`/api/attempts/${r.data.id}/integrity`, { type: 'tab_hidden' });
    const last = await s.post(`/api/attempts/${r.data.id}/integrity`, { type: 'tab_hidden' });
    assert.strictEqual(last.data.autoSubmitted, true);
    const row = db.prepare('SELECT * FROM attempts WHERE id=?').get(r.data.id);
    assert.strictEqual(row.integrity_penalty, 0, 'no automatic mark penalty unless the exam opts in');
  });

  console.log('\nData integrity (nothing academic is destroyed)');
  await check('cannot edit, unpublish or delete an exam that has attempts', async () => {
    assert.strictEqual((await lec.put('/api/exams/' + webExam.id, { title: 'changed', durationMinutes: 5 })).status, 409);
    assert.strictEqual((await lec.post(`/api/exams/${webExam.id}/unpublish`)).status, 409);
    assert.strictEqual((await lec.del('/api/exams/' + webExam.id)).status, 409);
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM attempts WHERE exam_id=?').get(webExam.id).n >= 1, true);
  });
  await check('editing/deleting a bank question does not alter a published exam or its results', async () => {
    const qs = (await lec.get(`/api/courses/${webExam.courseId}/questions`)).data;
    const target = qs.find(q => q.type === 'mcq');
    const before = db.prepare('SELECT auto_score FROM attempts WHERE id=?').get(att.id).auto_score;
    await lec.put('/api/questions/' + target.id, { ...target, text: 'EDITED', correctOptionId: target.options.find(o => o.id !== target.correctOptionId).id });
    const d = await lec.del('/api/questions/' + target.id);
    assert.strictEqual(d.data.archived, true);
    const snapNow = JSON.parse(db.prepare('SELECT snapshot FROM exams WHERE id=?').get(webExam.id).snapshot);
    assert(snapNow.some(q => q.id === target.id && q.text !== 'EDITED'));
    assert.strictEqual(db.prepare('SELECT auto_score FROM attempts WHERE id=?').get(att.id).auto_score, before);
  });
  await check('admin withdrawing a registration after the exam keeps the student on the results roster', async () => {
    const reg = db.prepare(`SELECT r.id FROM registrations r JOIN users u ON u.id=r.student_id WHERE u.email='student@fpa.edu.ng' AND r.course_id=?`).get(webExam.courseId);
    assert.strictEqual((await admin.post(`/api/admin/registrations/${reg.id}/reopen`)).status, 409); // has sat an exam
    assert.strictEqual((await admin.post(`/api/admin/registrations/${reg.id}/withdraw`)).status, 200);
    const res = (await lec.get(`/api/exams/${webExam.id}/results`)).data;
    assert(res.attempts.some(a => a.student.matric === 'FPA/CS/24/3-0254'), 'result lost');
    assert(!res.absent.some(a => a.matric === 'FPA/CS/24/3-0254'));
  });
  await check('a student who has sat an exam cannot drop the course', async () => {
    // (registration for student2 was approved by admin; drop endpoint only touches drafts / locked -> 409)
    const c = (await stu2.get('/api/my/registration')).data;
    const r = await stu2.del('/api/registrations/' + c.registered[0].course.id);
    assert.strictEqual(r.status, 409);
  });
  await check('users and courses with history cannot be hard-deleted', async () => {
    const u = db.prepare(`SELECT id FROM users WHERE email='student@fpa.edu.ng'`).get();
    assert.strictEqual((await admin.del('/api/users/' + u.id)).status, 409);
    assert.strictEqual((await admin.del('/api/courses/' + webExam.courseId)).status, 409);
    assert.strictEqual((await admin.post('/api/users/' + u.id + '/status', { status: 'inactive' })).status, 200);
    assert.strictEqual((await client().post('/api/auth/login', { email: 'student@fpa.edu.ng', password: 'Student123' })).status, 403);
    assert.strictEqual((await stu.get('/api/my/exams')).status, 401, 'deactivation kills live sessions');
  });
  await check('only an admin can create lecturers', async () => {
    const r = await admin.post('/api/users', { role: 'lecturer', name: 'New Lecturer', email: 'nl@x.com', staffId: 'FPA/SWD/099', password: 'Lecturer99' });
    assert.strictEqual(r.status, 201); assert.strictEqual(r.data.role, 'lecturer');
  });
  await check('audit log recorded key actions', async () => {
    const r = await admin.get('/api/admin/audit?limit=200');
    const acts = new Set(r.data.map(x => x.action));
    ['LOGIN', 'REGISTRATION_SUBMITTED', 'REGISTRATION_APPROVED', 'ATTEMPT_SUBMITTED', 'RESULT_MARK_CHANGED', 'RESULTS_RELEASED', 'QUESTION_ARCHIVED', 'USER_STATUS_CHANGED'].forEach(a => assert(acts.has(a), 'missing ' + a));
  });

  console.log(`\n${pass} passed, ${failN} failed`);
  server.close();
  process.exit(failN ? 1 : 0);
})();
