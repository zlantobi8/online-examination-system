(async function () {
  const session = await requireRole('lecturer');
  if (!session) return;
  renderShell('lecturer-dashboard.html');
  const content = document.getElementById('content');
  let d;
  try { d = await API.get('/lecturer/dashboard'); } catch (e) { return showError(e); }
  const { courses, exams } = d;

  if (courses.length === 0) {
    content.innerHTML = `<div class="page-head"><div><h1>Dashboard</h1></div></div>
      <section class="card">${emptyState('You are not offering any course yet',
        'Your administrator assigns lecturers to courses — once you are assigned, your dashboard, question bank and exams will appear here.',
        '<a class="btn btn-sm" href="lecturer-courses.html">My Courses</a>')}</section>`;
    return;
  }
  content.innerHTML = `
    <div class="page-head"><div><h1>Welcome, ${escapeHtml(session.name)}</h1>
      <p>${courses.length} course${courses.length === 1 ? '' : 's'} · ${escapeHtml(session.staffId || '')}</p></div>
      <div class="btn-row"><a class="btn btn-outline" href="lecturer-bank.html">Question bank</a><a class="btn" href="lecturer-exams.html">Set an exam</a></div></div>
    <div class="stat-row">
      <div class="stat stat-navy"><span class="stat-icon">${ICONS.bank}</span><div class="stat-value">${d.bankTotal}</div><div class="stat-label">Questions banked</div></div>
      <div class="stat stat-rust"><span class="stat-icon">${ICONS.file}</span><div class="stat-value">${exams.length}</div><div class="stat-label">Exams set</div></div>
      <div class="stat stat-teal"><span class="stat-icon">${ICONS.target}</span><div class="stat-value">${d.liveNow}</div><div class="stat-label">Open now</div></div>
      <div class="stat"><div class="stat-value">${d.submitted}</div><div class="stat-label">Scripts in</div></div>
    </div>
    ${d.awaiting > 0 ? `<a class="banner banner-teal" style="margin-top:18px; text-decoration:none;" href="lecturer-marking.html">
      <span class="banner-title">${d.awaiting} script${d.awaiting === 1 ? '' : 's'} awaiting your marking</span>
      <span class="banner-meta">Essay answers need a score before these results are final</span></a>` : ''}
    <div class="section-title"><h2>My courses</h2></div>
    <section class="card"><table class="ledger">
      <thead><tr><th>Code</th><th>Course</th><th>Students</th><th>Questions</th><th>Exams</th><th></th></tr></thead>
      <tbody>${courses.map(c => `<tr><td class="mono">${escapeHtml(c.code)}</td><td>${escapeHtml(c.title)}</td><td>${c.studentCount}</td>
        <td>${c.questionCount}</td><td>${c.examCount}</td><td><a class="link-btn" href="lecturer-bank.html?course=${c.id}">Open bank</a></td></tr>`).join('')}</tbody>
    </table></section>
    <div class="section-title"><h2>Recent exams</h2></div>
    <section class="card">${exams.length === 0
      ? emptyState('No exams yet', 'Build your question bank first, then set an exam from it.', '<a class="btn btn-sm" href="lecturer-exams.html">Set an exam</a>')
      : exams.slice(0, 6).map(e => `<div class="exam-row"><div>
          <div class="exam-row-title">${escapeHtml(e.title)} ${examStateChip(e)}</div>
          <div class="exam-meta">${e.questionCount == null ? 'random draw' : e.questionCount + ' questions'} · ${e.summary.submitted} submitted · avg ${e.summary.average}%</div></div>
          <a class="btn btn-outline btn-sm" href="lecturer-results.html?exam=${e.id}">Results</a></div>`).join('')}</section>`;
})();
