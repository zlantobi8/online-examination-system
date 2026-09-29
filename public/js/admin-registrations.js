(async function () {
  const session = await requireRole('admin');
  if (!session) return;
  renderShell('admin-registrations.html');
  const content = document.getElementById('content');
  let settings, rows;

  async function loadAll() {
    try { [settings, rows] = await Promise.all([API.get('/settings'), API.get('/admin/registrations')]); } catch (e) { return showError(e); }
    render();
  }
  function render() {
    const pending = rows.filter(r => r.status === 'submitted');
    const approved = rows.filter(r => r.status === 'approved');
    content.innerHTML = `
      <div class="page-head"><div><h1>Course Registration</h1><p>Control the registration window and approve student course selections.</p></div></div>
      <section class="card"><div class="card-head"><h2>Registration window</h2></div>
        <div class="field-row">
          <div class="field"><label for="sSession">Academic session</label><input type="text" id="sSession" value="${escapeHtml(settings.academicSession)}" placeholder="2026/2027"></div>
          <div class="field"><label for="sSemester">Semester</label><select id="sSemester"><option ${settings.semester === 'First Semester' ? 'selected' : ''}>First Semester</option><option ${settings.semester === 'Second Semester' ? 'selected' : ''}>Second Semester</option></select></div>
        </div>
        <label style="display:flex; gap:10px; align-items:flex-start; cursor:pointer; margin:8px 0 16px;">
          <input type="checkbox" id="sOpen" ${settings.registrationOpen ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--primary);margin-top:2px;">
          <span><strong>Registration is open</strong><br><span class="hint">While open, students can add and drop courses for this session/semester. Close it once registration should be locked department-wide.</span></span></label>
        <button class="btn btn-sm" id="saveSettingsBtn">Save</button></section>

      <div class="stat-row" style="margin-top:18px;"><div class="stat"><div class="stat-value">${pending.length}</div><div class="stat-label">Awaiting approval</div></div>
        <div class="stat"><div class="stat-value">${approved.length}</div><div class="stat-label">Approved</div></div></div>

      <div class="section-title"><h2>Awaiting approval (${pending.length})</h2></div>
      <section class="card" id="pendingCard"></section>
      <div class="section-title"><h2>Approved (${approved.length})</h2></div>
      <section class="card" id="approvedCard"></section>`;

    document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
      try {
        await API.put('/settings', { academicSession: document.getElementById('sSession').value, semester: document.getElementById('sSemester').value, registrationOpen: document.getElementById('sOpen').checked });
        toast('Settings saved.', 'success'); loadAll();
      } catch (e) { toast(e.message, 'error'); }
    });

    const byStudent = list => { const m = new Map(); list.forEach(r => { if (!m.has(r.student.id)) m.set(r.student.id, { student: r.student, items: [] }); m.get(r.student.id).items.push(r); }); return [...m.values()]; };
    document.getElementById('pendingCard').innerHTML = pending.length === 0 ? emptyState('Nothing waiting', 'Submitted registrations will appear here for approval.')
      : byStudent(pending).map(g => `<div class="q-row"><div class="q-body"><div class="q-text">${escapeHtml(g.student.name)}</div>
          <div class="hint mono">${escapeHtml(g.student.matric || '')} · ${escapeHtml(g.student.level || '')}</div>
          <div class="q-tags">${g.items.map(r => `<span class="chip chip-closed">${escapeHtml(r.course.code)}</span>`).join('')}</div></div>
          <button class="btn btn-sm" data-approve-all="${g.student.id}">Approve all</button></div>`).join('');
    document.getElementById('pendingCard').querySelectorAll('[data-approve-all]').forEach(b => b.addEventListener('click', async () => {
      try { const r = await API.post('/admin/students/' + b.dataset.approveAll + '/approve-all'); toast(r.approved + ' course(s) approved.', 'success'); loadAll(); } catch (e) { toast(e.message, 'error'); }
    }));

    document.getElementById('approvedCard').innerHTML = approved.length === 0 ? emptyState('None yet', '')
      : `<table class="ledger"><thead><tr><th>Student</th><th>Matric</th><th>Course</th><th>Approved</th><th></th></tr></thead>
        <tbody>${approved.map(r => `<tr><td>${escapeHtml(r.student.name)}</td><td class="mono">${escapeHtml(r.student.matric || '')}</td><td class="mono">${escapeHtml(r.course.code)}</td>
          <td>${formatDateShort(r.approvedAt)}</td><td><button class="link-btn" data-reopen="${r.id}">Reopen</button> · <button class="link-btn" data-withdraw="${r.id}">Remove</button></td></tr>`).join('')}</tbody></table>`;
    document.getElementById('approvedCard').querySelectorAll('[data-reopen]').forEach(b => b.addEventListener('click', async () => {
      try { await API.post('/admin/registrations/' + b.dataset.reopen + '/reopen'); toast('Sent back to the student as a draft.', 'success'); loadAll(); } catch (e) { toast(e.message, 'error'); }
    }));
    document.getElementById('approvedCard').querySelectorAll('[data-withdraw]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Remove this course from the student\u2019s registration? Exam results already recorded are kept regardless.')) return;
      try { await API.post('/admin/registrations/' + b.dataset.withdraw + '/withdraw'); toast('Removed.', 'success'); loadAll(); } catch (e) { toast(e.message, 'error'); }
    }));
  }
  loadAll();
})();
