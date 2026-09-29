(async function () {
  const session = await requireRole('student');
  if (!session) return;
  renderShell('student-results.html');
  const content = document.getElementById('content');
  let attempts;
  try { attempts = await API.get('/my/attempts'); } catch (e) { return showError(e); }

  const released = attempts.filter(a => a.released);
  const pcts = released.map(a => a.percent);
  const avg = pcts.length ? Math.round(pcts.reduce((s, v) => s + v, 0) / pcts.length) : 0;
  const passed = pcts.filter(p => p >= 50).length;

  const body = attempts.length === 0
    ? emptyState('No results yet', 'Once you sit and submit an exam, it appears here.', '<a class="btn btn-sm" href="student-dashboard.html">See my exams</a>')
    : `<table class="ledger"><thead><tr><th>Exam</th><th>Course</th><th>Score</th><th>%</th><th>Outcome</th><th>Submitted</th><th></th></tr></thead>
      <tbody>${attempts.map(a => `<tr>
        <td>${escapeHtml(a.exam)}</td><td class="mono">${escapeHtml(a.course)}</td>
        ${a.released ? `<td class="mono">${a.score}/${a.totalMarks}</td><td class="mono">${a.percent}%</td>
          <td>${a.awaiting ? '<span class="chip chip-awaiting">Provisional</span>' : `<span class="chip ${a.percent >= 50 ? 'chip-open' : 'chip-closed'}">${a.percent >= 50 ? 'Pass' : 'Fail'}</span>`}</td>`
        : `<td colspan="3"><span class="chip chip-scheduled">Awaiting marking</span></td>`}
        <td>${formatDateShort(a.submittedAt)}</td>
        <td><a class="link-btn" href="exam-result.html?attempt=${a.id}">View</a></td></tr>`).join('')}</tbody></table>`;

  content.innerHTML = `
    <div class="page-head"><div><h1>My results</h1><p>Results are released automatically after grading.</p></div>
      ${released.length ? '<button class="btn btn-outline btn-sm" id="exportBtn">Export CSV</button>' : ''}</div>
    <div class="stat-row">
      <div class="stat"><div class="stat-value">${attempts.length}</div><div class="stat-label">Papers sat</div></div>
      <div class="stat"><div class="stat-value">${avg}%</div><div class="stat-label">Average (released)</div></div>
      <div class="stat"><div class="stat-value">${passed}/${released.length}</div><div class="stat-label">Passed</div></div>
    </div>
    <div class="section-title"><h2>Results</h2></div><section class="card">${body}</section>`;

  const btn = document.getElementById('exportBtn');
  if (btn) btn.addEventListener('click', () => {
    const rows = [['Exam', 'Course', 'Score', 'Total', 'Percent', 'Outcome', 'Submitted']];
    released.forEach(a => rows.push([a.exam, a.course, a.score, a.totalMarks, a.percent + '%', a.percent >= 50 ? 'Pass' : 'Fail', formatDate(a.submittedAt)]));
    downloadCsv('my-results.csv', rows); toast('Results exported.', 'success');
  });
})();
