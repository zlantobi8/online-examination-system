(async function () {
  const session = await requireRole('student');
  if (!session) return;
  renderShell('student-courses.html');
  const content = document.getElementById('content');

  const STATUS = {
    none: ['chip-draft', 'Not started'], draft: ['chip-scheduled', 'Draft — not submitted'],
    submitted: ['chip-awaiting', 'Submitted — awaiting approval'], approved: ['chip-open', 'Approved']
  };

  async function load() {
    let d;
    try { d = await API.get('/my/registration'); } catch (e) { return showError(e); }
    const canEdit = d.registrationOpen;
    const [cls, label] = STATUS[d.status];
    const lockedCount = d.registered.filter(r => r.locked).length;

    content.innerHTML = `
      <div class="page-head"><div>
        <h1>Course Registration</h1>
        <p>${escapeHtml(d.academicSession)} · ${escapeHtml(d.semester)} · ${escapeHtml(d.department || 'Department not set')} · ${escapeHtml(d.level || '')}</p>
      </div></div>
      <div class="stat-row">
        <div class="stat"><div class="stat-value">${d.registered.length}</div><div class="stat-label">Selected</div></div>
        <div class="stat"><div class="stat-value"><span class="chip ${cls}">${label}</span></div><div class="stat-label">Status</div></div>
        <div class="stat"><div class="stat-value">${d.registrationOpen ? 'Open' : 'Closed'}</div><div class="stat-label">Registration window</div></div>
      </div>
      ${!d.registrationOpen && d.status === 'none' ? `<div class="card" style="border-left:4px solid var(--gold); margin-top:18px;">
        <strong>Registration is closed.</strong> The administrator opens a registration window each semester. You cannot add courses until then.</div>` : ''}
      ${lockedCount ? `<div class="card" style="border-left:4px solid var(--gold); margin-top:18px;"><strong>${lockedCount} course${lockedCount === 1 ? '' : 's'} locked.</strong> A course cannot be dropped once you have started or sat its exam.</div>` : ''}

      <div class="section-title"><h2>Your courses</h2></div>
      <section class="card" id="mine"></section>
      ${canEdit ? `<div class="section-title"><h2>Available for ${escapeHtml(d.department || 'your department')} · ${escapeHtml(d.level || 'your level')}</h2></div><section class="card" id="avail"></section>
        <p class="hint" style="margin-top:8px;">Courses are registered immediately. You can add or remove eligible courses while registration is open, except for a course once you have started its exam.</p>` : ''}`;

    const mine = document.getElementById('mine');
    mine.innerHTML = d.registered.length === 0
      ? emptyState('No courses selected', d.registrationOpen ? 'Add courses from the list below.' : 'Nothing to show yet.')
      : d.registered.map(r => `<div class="q-row"><div class="q-body">
          <div class="q-text">${escapeHtml(courseLabel(r.course))}</div>
          <div class="q-tags"><span class="chip chip-open">Registered</span>${r.locked ? '<span class="chip chip-awaiting">Exam locked</span>' : ''}</div></div>
          ${canEdit && !r.locked ? `<button class="btn btn-outline btn-sm" data-drop="${r.course.id}">Remove</button>` : ''}</div>`).join('');

    if (canEdit) {
      const av = document.getElementById('avail');
      av.innerHTML = d.available.length === 0
        ? emptyState('Nothing else available', 'There are no more active courses for your level.')
        : d.available.map(c => `<div class="q-row"><div class="q-body"><div class="q-text">${escapeHtml(courseLabel(c))}</div></div>
            <button class="btn btn-sm" data-add="${c.id}">Add</button></div>`).join('');
    }
    const act = (sel, fn, ok) => content.querySelectorAll(sel).forEach(b => b.addEventListener('click', async () => {
      b.disabled = true;
      try { await fn(b); toast(ok, 'success'); } catch (e) { toast(e.message, 'error'); }
      load();
    }));
    act('[data-add]', b => API.post('/registrations', { courseId: b.dataset.add }), 'Course added.');
    act('[data-drop]', b => API.del('/registrations/' + b.dataset.drop), 'Course removed.');
  }
  load();
})();
