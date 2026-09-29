(async function () {
  const session = await requireRole('lecturer');
  if (!session) return;
  renderShell('lecturer-courses.html');
  const content = document.getElementById('content');
  let d;
  try { d = await API.get('/lecturer/dashboard'); } catch (e) { return showError(e); }
  const mine = d.courses;
  content.innerHTML = `
    <div class="page-head"><div><h1>My Courses</h1>
      <p>Course assignment is handled by your administrator, so who-teaches-what stays an official record.</p></div></div>
    <div class="stat-row"><div class="stat"><div class="stat-value">${mine.length}</div><div class="stat-label">Courses you teach</div></div></div>
    <div class="section-title"><h2>Assigned to you</h2></div><section class="card" id="listCard"></section>
    <p class="hint" style="margin-top:10px;">Need to be added to, or removed from, a course? Ask your administrator.</p>`;
  document.getElementById('listCard').innerHTML = mine.length === 0
    ? emptyState('You have not been assigned to a course yet', 'Once your administrator assigns you to a course, it will appear here.')
    : mine.map(c => `<div class="q-row"><div class="q-body"><div class="q-text">${escapeHtml(courseLabel(c))}</div>
        <div class="q-tags"><span class="chip chip-closed">${c.studentCount} approved student${c.studentCount === 1 ? '' : 's'}</span>
        <span class="chip chip-closed">${c.questionCount} question${c.questionCount === 1 ? '' : 's'} banked</span>
        ${c.status !== 'active' ? `<span class="chip chip-draft">${c.status}</span>` : ''}</div></div></div>`).join('');
})();
