(async function () {
  const session = await requireRole('student');
  if (!session) return;
  let term = '';
  renderShell('student-dashboard.html', {
    searchPlaceholder: 'Search exams or courses…',
    onSearch: t => { term = t; render(); }
  });
  const content = document.getElementById('content');
  let data;
  try { data = await API.get('/my/exams'); } catch (e) { return showError(e); }

  function render() {
    const { courses, exams } = data;
    const filtered = term ? exams.filter(e => (e.title + ' ' + e.course.code + ' ' + e.course.title).toLowerCase().includes(term)) : exams;
    const done = exams.filter(e => e.attempt && e.attempt.status !== 'in-progress');
    const openNow = exams.filter(e => e.windowState === 'open' && !(e.attempt && e.attempt.status !== 'in-progress'));

    let html = `
      <div class="page-head"><div>
        <h1>Welcome, ${escapeHtml(session.name.split(' ')[0])}</h1>
        <p>${escapeHtml(session.matric || '')} · ${escapeHtml(session.level || '')} · ${courses.length} approved course${courses.length === 1 ? '' : 's'}</p>
      </div></div>
      <div class="stat-row">
        <div class="stat stat-teal"><span class="stat-icon">${ICONS.target}</span><div class="stat-value">${openNow.length}</div><div class="stat-label">Open now</div></div>
        <div class="stat stat-navy"><span class="stat-icon">${ICONS.chart}</span><div class="stat-value">${done.length}</div><div class="stat-label">Sat</div></div>
        <div class="stat stat-rust"><span class="stat-icon">${ICONS.book}</span><div class="stat-value">${courses.length}</div><div class="stat-label">Courses</div></div>
      </div>`;

    if (courses.length === 0) {
      const msg = data.registrationStatus === 'pending'
        ? ['Your registration is awaiting approval', 'You have submitted your courses. Exams appear here once the administrator approves your registration.']
        : data.registrationOpen
          ? ['You have not registered your courses yet', 'Course registration is open. Select and submit your courses to become eligible for exams.']
          : ['Course registration is not open', 'The administrator opens a registration window each semester. Check back later.'];
      html += `<div class="section-title"><h2>Exams</h2></div><section class="card">${emptyState(msg[0], msg[1],
        '<a class="btn btn-sm" href="student-courses.html">Course registration</a>')}</section>`;
      content.innerHTML = html; return;
    }

    html += `<div class="section-title"><h2>Exams</h2></div><section class="card">`;
    if (exams.length === 0) html += emptyState('No exams published yet', 'Nothing has been published for your courses. Check back later.');
    else if (filtered.length === 0) html += emptyState('No exams match "' + term + '"', 'Try a different course code or title.');
    else html += filtered.map(exam => {
      const fin = exam.attempt && exam.attempt.status !== 'in-progress';
      const active = exam.attempt && exam.attempt.status === 'in-progress';
      let action;
      if (fin) action = `<a class="btn btn-outline btn-sm" href="exam-result.html?attempt=${exam.attempt.id}">View result</a>`;
      else if (active && exam.windowState === 'open') action = `<a class="btn btn-gold btn-sm" href="exam.html?exam=${exam.id}">Resume</a>`;
      else if (exam.windowState === 'open') action = `<a class="btn btn-sm" href="exam.html?exam=${exam.id}">Start exam</a>`;
      else if (exam.windowState === 'scheduled') action = `<span class="hint">Opens ${formatDateShort(exam.opensAt)}</span>`;
      else action = `<span class="hint">Closed</span>`;
      const win = exam.opensAt || exam.closesAt ? ` · ${formatDateShort(exam.opensAt)} → ${formatDateShort(exam.closesAt)}` : '';
      return `<div class="exam-row"><div>
          <div class="exam-row-title">${escapeHtml(exam.title)} ${examStateChip(exam)}</div>
          <div class="exam-meta">${escapeHtml(exam.course.code + ' — ' + exam.course.title)} · ${exam.durationMinutes} min · ${exam.questionCount} question${exam.questionCount === 1 ? '' : 's'}${win}</div>
        </div>${action}</div>`;
    }).join('');
    html += `</section>
      <div class="section-title"><h2>My courses</h2></div>
      <section class="card"><table class="ledger">
        <thead><tr><th>Code</th><th>Course</th><th>Level</th><th>Exams</th></tr></thead>
        <tbody>${courses.map(c => `<tr><td class="mono">${escapeHtml(c.code)}</td><td>${escapeHtml(c.title)}</td>
          <td>${escapeHtml(c.level || '—')}</td><td>${exams.filter(e => e.courseId === c.id).length}</td></tr>`).join('')}</tbody>
      </table></section>
      <p class="hint" style="margin-top:10px;"><a href="student-courses.html">Course registration &rarr;</a></p>`;
    content.innerHTML = html;
  }
  render();
})();
