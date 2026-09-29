(async function () {
  const session = await requireRole('admin');
  if (!session) return;
  let term = '';
  renderShell('admin-courses.html', { searchPlaceholder: 'Search courses…', onSearch: t => { term = t; renderList(); } });
  const content = document.getElementById('content');
  let courses = [], lecturers = [], departments = [], editing = null, managing = null;
  const LEVELS = ['ND I', 'ND II', 'HND I', 'HND II'];

  content.innerHTML = `<div class="page-head"><div><h1>Courses</h1><p>Create courses and assign lecturers. Student enrolment happens through course registration.</p></div>
    <div class="btn-row"><button class="btn btn-outline" id="manageDepartmentsBtn">Departments</button><button class="btn" id="newCourseBtn">+ New course</button></div></div>
    <section class="card" id="listCard"></section><div id="editorHost"></div>`;
  document.getElementById('newCourseBtn').addEventListener('click', () => openEditor(null));
  document.getElementById('manageDepartmentsBtn').addEventListener('click', openDepartments);

  async function loadAll() {
    try { [courses, lecturers, departments] = await Promise.all([API.get('/courses'), API.get('/users').then(u => u.filter(x => x.role === 'lecturer' && x.status === 'active')), API.get('/departments')]); }
    catch (e) { return showError(e, document.getElementById('listCard')); }
    renderList();
  }

  function renderList() {
    let list = courses.slice().sort((a, b) => a.code.localeCompare(b.code));
    if (term) list = list.filter(c => (c.code + ' ' + c.title).toLowerCase().includes(term));
    const card = document.getElementById('listCard');
    if (courses.length === 0) { card.innerHTML = emptyState('No courses yet', 'Create your first course, then assign a lecturer.', '<button class="btn btn-sm" id="emptyNewBtn">+ New course</button>');
      document.getElementById('emptyNewBtn').addEventListener('click', () => openEditor(null)); return; }
    if (list.length === 0) { card.innerHTML = emptyState('No courses match "' + term + '"', 'Try a different code or title.'); return; }
    card.innerHTML = list.map(c => `<div class="exam-row"><div>
      <div class="exam-row-title">${escapeHtml(c.code)} — ${escapeHtml(c.title)} ${c.status !== 'active' ? `<span class="chip chip-draft">${c.status}</span>` : ''}</div>
      <div class="exam-meta">${escapeHtml(c.level || 'No level set')} ·
        ${c.lecturers.length ? escapeHtml(c.lecturers.map(l => l.name).join(', ')) : '<span style="color:var(--danger)">no lecturer assigned</span>'} ·
        ${c.studentCount} student${c.studentCount === 1 ? '' : 's'} this semester ·
        ${c.questionCount} questions · ${c.examCount} exams</div></div>
      <div class="btn-row">
        <button class="btn btn-outline btn-sm" data-manage="${c.id}">Lecturers &amp; roster</button>
        <button class="btn btn-outline btn-sm" data-edit="${c.id}">Edit</button>
        ${c.status === 'active' ? `<button class="btn btn-outline btn-sm" data-status="closed" data-id="${c.id}">Close</button>` : ''}
        ${c.status === 'closed' ? `<button class="btn btn-outline btn-sm" data-status="active" data-id="${c.id}">Reopen</button><button class="btn btn-outline btn-sm" data-status="archived" data-id="${c.id}">Archive</button>` : ''}
        <button class="btn btn-danger btn-sm" data-del="${c.id}">Delete</button></div></div>`).join('');

    card.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openEditor(courses.find(c => c.id === b.dataset.edit))));
    card.querySelectorAll('[data-manage]').forEach(b => b.addEventListener('click', () => openManage(courses.find(c => c.id === b.dataset.manage))));
    card.querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', async () => {
      try { await API.post('/courses/' + b.dataset.id + '/status', { status: b.dataset.status }); toast('Course updated.', 'success'); loadAll(); } catch (e) { toast(e.message, 'error'); }
    }));
    card.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this course? Only possible if it has no questions, exams or registrations — otherwise archive it instead.')) return;
      try { await API.del('/courses/' + b.dataset.del); toast('Course deleted.', 'success'); loadAll(); } catch (e) { toast(e.message, 'error'); }
    }));
  }

  function openEditor(existing) {
    editing = existing ? { ...existing } : { id: null, code: '', title: '', level: 'HND II' };
    const isNew = !existing;
    document.getElementById('editorHost').innerHTML = `<div class="modal-backdrop" id="backdrop"><div class="modal">
      <div class="card-head"><h2>${isNew ? 'New course' : 'Edit course'}</h2><button class="btn btn-outline btn-sm" id="closeBtn">Close</button></div>
      <div class="field-row"><div class="field"><label for="cCode">Course code</label><input type="text" id="cCode" value="${escapeHtml(editing.code)}" placeholder="SWD 412"></div>
        <div class="field"><label for="cLevel">Level</label><select id="cLevel">${LEVELS.map(l => `<option value="${l}" ${editing.level === l ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="field"><label for="cDepartment">Department</label><select id="cDepartment"><option value="">Select department…</option>${departments.filter(d => d.status === 'active').map(d => `<option value="${escapeHtml(d.name)}" ${editing.department === d.name ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="cTitle">Course title</label><input type="text" id="cTitle" value="${escapeHtml(editing.title)}" placeholder="Web Application Development"></div>
      <div id="courseError" class="error-text" style="display:none; margin-bottom:12px;"></div>
      <div class="btn-row"><button class="btn" id="saveCourseBtn">${isNew ? 'Create course' : 'Save changes'}</button><button class="btn btn-outline" id="cancelBtn">Cancel</button></div></div></div>`;
    const close = () => { editing = null; document.getElementById('editorHost').innerHTML = ''; };
    document.getElementById('closeBtn').addEventListener('click', close);
    document.getElementById('cancelBtn').addEventListener('click', close);
    document.getElementById('backdrop').addEventListener('click', e => { if (e.target.id === 'backdrop') close(); });
    document.getElementById('saveCourseBtn').addEventListener('click', async () => {
      const err = document.getElementById('courseError'); err.style.display = 'none';
      const body = { code: document.getElementById('cCode').value, title: document.getElementById('cTitle').value, level: document.getElementById('cLevel').value, department: document.getElementById('cDepartment').value };
      try { if (isNew) await API.post('/courses', body); else await API.patch('/courses/' + editing.id, body); toast('Course saved.', 'success'); close(); loadAll(); }
      catch (e) { err.textContent = e.message; err.style.display = 'block'; }
    });
  }

  async function openDepartments() {
    document.getElementById('editorHost').innerHTML = `<div class="modal-backdrop" id="backdrop"><div class="modal" style="max-width:620px;">
      <div class="card-head"><h2>Departments</h2><button class="btn btn-outline btn-sm" id="closeBtn">Close</button></div>
      <p class="hint">Departments control which students and courses can be matched. Students can only select active departments.</p>
      <div class="field-row"><div class="field"><label for="newDepartment">Add department</label><input id="newDepartment" placeholder="Computer Engineering"></div><div class="field" style="align-self:end;"><button class="btn" id="addDepartmentBtn">Add</button></div></div>
      <div id="departmentList"></div></div></div>`;
    const close = () => document.getElementById('editorHost').innerHTML = '';
    document.getElementById('closeBtn').addEventListener('click', close);
    document.getElementById('backdrop').addEventListener('click', e => { if (e.target.id === 'backdrop') close(); });
    const render = () => {
      document.getElementById('departmentList').innerHTML = departments.map(d => `<div class="q-row"><div class="q-body"><div class="q-text">${escapeHtml(d.name)}</div><div class="hint">${d.status}</div></div>${d.status === 'active' ? `<button class="btn btn-outline btn-sm" data-dept-status="inactive" data-id="${d.id}">Deactivate</button>` : `<button class="btn btn-outline btn-sm" data-dept-status="active" data-id="${d.id}">Reactivate</button>`}</div>`).join('');
      document.querySelectorAll('[data-dept-status]').forEach(b => b.addEventListener('click', async () => { try { await API.post('/departments/' + b.dataset.id + '/status', { status: b.dataset.deptStatus }); departments = await API.get('/departments'); render(); } catch(e) { toast(e.message, 'error'); } }));
    };
    document.getElementById('addDepartmentBtn').addEventListener('click', async () => { const input = document.getElementById('newDepartment'); try { await API.post('/departments', { name: input.value }); departments = await API.get('/departments'); input.value=''; render(); toast('Department added.', 'success'); } catch(e) { toast(e.message, 'error'); } });
    render();
  }

  async function openManage(c) {
    managing = c;
    let roster;
    try { roster = await API.get('/courses/' + c.id + '/students'); } catch (e) { return toast(e.message, 'error'); }
    const assigned = c.lecturers.map(l => l.id);
    document.getElementById('editorHost').innerHTML = `<div class="modal-backdrop" id="backdrop"><div class="modal" style="max-width:680px;">
      <div class="card-head"><h2>${escapeHtml(c.code)} — lecturers &amp; roster</h2><button class="btn btn-outline btn-sm" id="closeBtn">Close</button></div>
      <div class="section-title" style="margin-top:6px;"><h2 style="font-size:1rem;">Lecturers</h2></div>
      ${lecturers.length === 0 ? '<p class="hint">No lecturer accounts exist yet.</p>' : lecturers.map(l => `<label class="q-row" style="cursor:pointer; padding:10px 4px;">
        <input type="checkbox" data-lec="${l.id}" ${assigned.includes(l.id) ? 'checked' : ''}>
        <div class="q-body"><div class="q-text" style="font-weight:600;">${escapeHtml(l.name)}</div><div class="hint">${escapeHtml(l.staffId || l.email)}</div></div></label>`).join('')}
      <div class="section-title"><h2 style="font-size:1rem;">Registered students (this semester)</h2></div>
      <p class="hint">Students are registered automatically when they select an eligible course. This roster is mainly for visibility and exceptional admin intervention.</p>
      <div id="rosterList" style="max-height:280px; overflow-y:auto; margin-bottom:12px;"></div>
      <div class="field"><label for="addStudent">Enrol a student directly</label>
        <select id="addStudent"><option value="">Choose a student…</option></select></div>
      <div class="btn-row"><button class="btn btn-sm" id="addStudentBtn">Add &amp; approve</button></div></div></div>`;

    const STATUS = { draft: ['chip-draft', 'Draft'], submitted: ['chip-awaiting', 'Submitted'], approved: ['chip-open', 'Approved'] };
    document.getElementById('rosterList').innerHTML = roster.length === 0 ? '<p class="hint">No student has registered for this course yet.</p>'
      : roster.map(s => `<div class="q-row"><div class="q-body"><div class="q-text">${escapeHtml(s.name)}</div><div class="hint mono">${escapeHtml(s.matric || s.email)}</div></div>
        <span class="chip ${STATUS[s.status][0]}">${STATUS[s.status][1]}</span>
        ${s.status === 'submitted' ? `<button class="btn btn-sm" data-approve="${s.registrationId}">Approve</button>` : ''}
        ${s.status === 'approved' ? `<button class="btn btn-outline btn-sm" data-withdraw="${s.registrationId}">Remove</button>` : ''}</div>`).join('');

    let allStudents;
    try { allStudents = await API.get('/users').then(u => u.filter(x => x.role === 'student' && x.status === 'active')); } catch (e) { allStudents = []; }
    const already = new Set(roster.map(s => s.id));
    document.getElementById('addStudent').innerHTML += allStudents.filter(s => !already.has(s.id)).map(s => `<option value="${s.id}">${escapeHtml(s.name)} — ${escapeHtml(s.matric || s.email)}</option>`).join('');

    const close = () => { managing = null; document.getElementById('editorHost').innerHTML = ''; loadAll(); };
    document.getElementById('closeBtn').addEventListener('click', close);
    document.getElementById('backdrop').addEventListener('click', e => { if (e.target.id === 'backdrop') close(); });
    document.querySelectorAll('[data-lec]').forEach(cb => cb.addEventListener('change', async () => {
      const ids = [...document.querySelectorAll('[data-lec]:checked')].map(x => x.dataset.lec);
      try { await API.put('/courses/' + c.id + '/lecturers', { lecturerIds: ids }); toast('Lecturer assignment updated.', 'success'); } catch (e) { toast(e.message, 'error'); }
    }));
    document.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', async () => { try { await API.post('/admin/registrations/' + b.dataset.approve + '/approve'); toast('Approved.', 'success'); openManage(c); } catch (e) { toast(e.message, 'error'); } }));
    document.querySelectorAll('[data-withdraw]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Remove this student from the course? Any exam results already recorded are kept.')) return;
      try { await API.post('/admin/registrations/' + b.dataset.withdraw + '/withdraw'); toast('Removed.', 'success'); openManage(c); } catch (e) { toast(e.message, 'error'); }
    }));
    document.getElementById('addStudentBtn').addEventListener('click', async () => {
      const sid = document.getElementById('addStudent').value;
      if (!sid) return;
      try { await API.post('/admin/registrations', { studentId: sid, courseId: c.id }); toast('Student enrolled.', 'success'); openManage(c); } catch (e) { toast(e.message, 'error'); }
    });
  }
  loadAll();
})();
