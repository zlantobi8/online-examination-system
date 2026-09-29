(async function () {
  const session = await requireRole('admin');
  if (!session) return;
  renderShell('admin-dashboard.html');
  const content = document.getElementById('content');
  let s;
  try { s = await API.get('/admin/stats'); } catch (e) { return showError(e); }

  content.innerHTML = `
    <div class="page-head"><div><h1>Administration</h1>
      <p>${escapeHtml(s.settings.academicSession)} · ${escapeHtml(s.settings.semester)} · Registration is
        <strong>${s.settings.registrationOpen ? 'open' : 'closed'}</strong></p></div>
      <div class="btn-row"><a class="btn btn-outline" href="admin-users.html">Manage users</a><a class="btn" href="admin-courses.html">Manage courses</a></div></div>
    <div class="stat-row">
      <div class="stat stat-navy"><span class="stat-icon">${ICONS.users}</span><div class="stat-value">${s.students}</div><div class="stat-label">Students</div></div>
      <div class="stat stat-rust"><span class="stat-icon">${ICONS.lecturer}</span><div class="stat-value">${s.lecturers}</div><div class="stat-label">Lecturers</div></div>
      <div class="stat stat-teal"><span class="stat-icon">${ICONS.book}</span><div class="stat-value">${s.courses}</div><div class="stat-label">Courses</div></div>
      <div class="stat"><div class="stat-value">${s.questions}</div><div class="stat-label">Questions banked</div></div></div>
    <div class="stat-row" style="margin-top:16px;">
      <div class="stat"><div class="stat-value">${s.exams}</div><div class="stat-label">Exams set</div></div>
      <div class="stat"><div class="stat-value">${s.openNow}</div><div class="stat-label">Open right now</div></div>
      <div class="stat"><div class="stat-value">${s.scriptsSubmitted}</div><div class="stat-label">Scripts submitted</div></div>
      <div class="stat"><div class="stat-value">${s.pendingRegistrations}</div><div class="stat-label">Registrations awaiting approval</div></div></div>

    ${(s.unassigned.length || s.studentsWithoutCourses || s.pendingRegistrations) ? `
      <div class="section-title"><h2>Needs attention</h2></div>
      <section class="card">
        ${s.pendingRegistrations ? `<div class="exam-row"><div><div class="exam-row-title">${s.pendingRegistrations} registration${s.pendingRegistrations === 1 ? '' : 's'} awaiting approval</div>
          <div class="exam-meta">Students cannot sit exams until their registration is approved.</div></div><a class="btn btn-outline btn-sm" href="admin-registrations.html">Review</a></div>` : ''}
        ${s.unassigned.length ? `<div class="exam-row"><div><div class="exam-row-title">${s.unassigned.length} course${s.unassigned.length === 1 ? '' : 's'} with no lecturer assigned</div>
          <div class="exam-meta">${s.unassigned.map(escapeHtml).join(', ')}</div></div><a class="btn btn-outline btn-sm" href="admin-courses.html">Assign</a></div>` : ''}
        ${s.studentsWithoutCourses ? `<div class="exam-row"><div><div class="exam-row-title">${s.studentsWithoutCourses} student${s.studentsWithoutCourses === 1 ? '' : 's'} registered for no course this semester</div>
          <div class="exam-meta">They will see no exams until they register.</div></div></div>` : ''}
      </section>` : ''}

    <div class="section-title"><h2>Courses at a glance</h2></div>
    <section class="card">${s.courseList.length === 0 ? emptyState('No courses yet', 'Create a course, assign a lecturer, then open registration.', '<a class="btn btn-sm" href="admin-courses.html">Create a course</a>')
      : `<table class="ledger"><thead><tr><th>Code</th><th>Course</th><th>Lecturer(s)</th><th>Students</th></tr></thead>
        <tbody>${s.courseList.map(c => `<tr><td class="mono">${escapeHtml(c.code)}</td><td>${escapeHtml(c.title)}</td>
          <td>${c.lecturers.map(l => escapeHtml(l.name)).join(', ') || '<span class="chip chip-draft">Unassigned</span>'}</td><td>${c.studentCount}</td></tr>`).join('')}</tbody></table>`}</section>

    <div class="section-title"><h2>Recent activity</h2></div>
    <section class="card" id="auditCard"><p class="hint">Loading…</p></section>`;

  try {
    const audit = await API.get('/admin/audit?limit=15');
    document.getElementById('auditCard').innerHTML = audit.length === 0 ? emptyState('No activity yet', '') :
      `<table class="ledger"><thead><tr><th>When</th><th>Who</th><th>Action</th></tr></thead><tbody>${audit.map(a =>
        `<tr><td class="mono" style="font-size:0.8rem;">${formatDateShort(a.at)}</td><td>${escapeHtml(a.actor)}</td><td>${escapeHtml(a.action.replace(/_/g, ' ').toLowerCase())}</td></tr>`).join('')}</tbody></table>`;
  } catch (e) { document.getElementById('auditCard').innerHTML = ''; }
})();
