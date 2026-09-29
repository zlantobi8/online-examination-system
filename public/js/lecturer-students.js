(async function () {
  const session = await requireRole('lecturer');
  if (!session) return;
  let term = '';
  renderShell('lecturer-students.html', { searchPlaceholder: 'Search students…', onSearch: t => { term = t; render(); } });
  const content = document.getElementById('content');
  let courses, rosters = {};
  try {
    courses = await API.get('/courses');
    await Promise.all(courses.map(async c => { rosters[c.id] = await API.get('/courses/' + c.id + '/students'); }));
  } catch (e) { return showError(e); }

  if (courses.length === 0) {
    content.innerHTML = `<div class="page-head"><div><h1>Students</h1></div></div><section class="card">${emptyState('You are not offering any course yet',
      'Once you are assigned to a course, its registered students appear here.', '<a class="btn btn-sm" href="lecturer-courses.html">My Courses</a>')}</section>`;
    return;
  }
  let courseId = qs('course') && courses.some(c => c.id === qs('course')) ? qs('course') : 'all';
  const rowsNow = () => {
    let rows = [];
    (courseId === 'all' ? courses : courses.filter(c => c.id === courseId)).forEach(c => rosters[c.id].forEach(s => rows.push({ student: s, course: c })));
    if (term) rows = rows.filter(r => (r.student.name + ' ' + (r.student.matric || '')).toLowerCase().includes(term));
    return rows.sort((a, b) => a.student.name.localeCompare(b.student.name));
  };
  function render() {
    const rows = rowsNow();
    content.innerHTML = `
      <div class="page-head"><div><h1>Students</h1><p>Students whose registration has been approved on the course${courses.length === 1 ? '' : 's'} you teach.</p></div>
        <button class="btn btn-outline btn-sm" id="exportBtn">Export list</button></div>
      <div class="toolbar"><select id="courseSel"><option value="all">All my courses</option>
        ${courses.map(c => `<option value="${c.id}" ${courseId === c.id ? 'selected' : ''}>${escapeHtml(courseLabel(c))}</option>`).join('')}</select>
        <span class="spacer"></span><span class="hint">${rows.length} student${rows.length === 1 ? '' : 's'}</span></div>
      <section class="card" id="listCard"></section>`;
    document.getElementById('courseSel').value = courseId;
    document.getElementById('courseSel').addEventListener('change', e => { courseId = e.target.value; render(); });
    document.getElementById('exportBtn').addEventListener('click', () => {
      const r = rowsNow(); if (!r.length) return toast('Nothing to export.', 'error');
      downloadCsv('students.csv', [['Name', 'Matric No.', 'Email', 'Course']].concat(r.map(x => [x.student.name, x.student.matric || '', x.student.email, x.course.code])));
      toast('Student list exported.', 'success');
    });
    document.getElementById('listCard').innerHTML = rows.length === 0
      ? emptyState('No students here yet', 'Students appear once their registration has been approved by the administrator.')
      : `<table class="ledger"><thead><tr><th>Name</th><th>Matric No.</th><th>Email</th>${courseId === 'all' ? '<th>Course</th>' : ''}</tr></thead>
        <tbody>${rows.map(r => `<tr><td>${escapeHtml(r.student.name)}</td><td class="mono">${escapeHtml(r.student.matric || '—')}</td>
          <td>${escapeHtml(r.student.email)}</td>${courseId === 'all' ? `<td class="mono">${escapeHtml(r.course.code)}</td>` : ''}</tr>`).join('')}</tbody></table>`;
  }
  render();
})();
