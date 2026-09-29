(async function () {
  const session = await requireRole('admin');
  if (!session) return;
  let term = '';
  renderShell('admin-users.html', { searchPlaceholder: 'Search users…', onSearch: t => { term = t; renderList(); } });
  const content = document.getElementById('content');
  let users = [], departments = [], roleFilter = 'all', editing = null;
  const LEVELS = ['ND I', 'ND II', 'HND I', 'HND II'];

  content.innerHTML = `<div class="page-head"><div><h1>Users</h1><p>Create and manage staff and student accounts. Only administrators can create lecturer or admin accounts.</p></div>
    <button class="btn" id="newUserBtn">+ New user</button></div>
    <div class="toolbar"><select id="roleSel"><option value="all">All roles</option><option value="student">Students</option><option value="lecturer">Lecturers</option><option value="admin">Administrators</option></select>
      <span class="spacer"></span><button class="btn btn-outline btn-sm" id="exportUsersBtn">Export list</button></div>
    <div class="stat-row" id="userStats"></div>
    <div class="section-title"><h2>Accounts</h2></div><section class="card" id="listCard"></section><div id="editorHost"></div>`;
  document.getElementById('roleSel').addEventListener('change', e => { roleFilter = e.target.value; renderList(); });
  document.getElementById('newUserBtn').addEventListener('click', () => openEditor(null));
  document.getElementById('exportUsersBtn').addEventListener('click', exportUsers);

  async function loadAll() { try { [users, departments] = await Promise.all([API.get('/users'), API.get('/departments')]); } catch (e) { return showError(e, document.getElementById('listCard')); } renderList(); }
  function currentList() {
    let l = users;
    if (roleFilter !== 'all') l = l.filter(u => u.role === roleFilter);
    if (term) l = l.filter(u => (u.name + ' ' + u.email + ' ' + (u.matric || '') + ' ' + (u.staffId || '')).toLowerCase().includes(term));
    return l.slice().sort((a, b) => a.name.localeCompare(b.name));
  }
  function renderList() {
    document.getElementById('userStats').innerHTML = `
      <div class="stat"><div class="stat-value">${users.filter(u => u.role === 'student').length}</div><div class="stat-label">Students</div></div>
      <div class="stat"><div class="stat-value">${users.filter(u => u.role === 'lecturer').length}</div><div class="stat-label">Lecturers</div></div>
      <div class="stat"><div class="stat-value">${users.filter(u => u.role === 'admin').length}</div><div class="stat-label">Administrators</div></div>`;
    const list = currentList(), card = document.getElementById('listCard');
    if (list.length === 0) { card.innerHTML = emptyState('No accounts match', 'Try a different role or search term.'); return; }
    card.innerHTML = `<table class="ledger"><thead><tr><th>Name</th><th>Role</th><th>Email</th><th>ID</th><th>Status</th><th>Courses</th><th></th></tr></thead>
      <tbody>${list.map(u => `<tr>
        <td>${escapeHtml(u.name)}</td><td><span class="chip chip-type">${u.role}</span></td>
        <td class="mono" style="font-size:0.82rem;">${escapeHtml(u.email)}</td>
        <td class="mono" style="font-size:0.82rem;">${escapeHtml(u.matric || u.staffId || '—')}</td>
        <td>${u.status === 'active' ? '<span class="chip chip-open">Active</span>' : `<span class="chip chip-closed">${escapeHtml(u.status)}</span>`}</td>
        <td>${u.courseCount == null ? '—' : u.courseCount}</td>
        <td><div class="icon-btn-row">
          <button class="icon-btn" data-edit="${u.id}" title="Edit">${ICONS.pen}</button>
          ${u.id === session.id ? '' : `<button class="icon-btn" data-toggle="${u.id}" title="${u.status === 'active' ? 'Deactivate' : 'Activate'}">${u.status === 'active' ? ICONS.eye : ICONS.dots}</button>
            <button class="icon-btn danger" data-del="${u.id}" title="Delete">${ICONS.trash}</button>`}</div></td></tr>`).join('')}</tbody></table>`;
    card.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openEditor(users.find(u => u.id === b.dataset.edit))));
    card.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', async () => {
      const u = users.find(x => x.id === b.dataset.toggle);
      try { await API.post('/users/' + u.id + '/status', { status: u.status === 'active' ? 'suspended' : 'active' }); toast('Account updated.', 'success'); loadAll(); } catch (e) { toast(e.message, 'error'); }
    }));
    card.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this account? Only possible if it has no academic history — otherwise deactivate it instead.')) return;
      try { await API.del('/users/' + b.dataset.del); toast('Account deleted.', 'success'); loadAll(); } catch (e) { toast(e.message, 'error'); }
    }));
  }

  function openEditor(existing) { editing = existing ? { ...existing } : { role: 'student' }; renderEditor(!existing); }
  function closeEditor() { editing = null; document.getElementById('editorHost').innerHTML = ''; }
  function renderEditor(isNew) {
    const u = editing;
    document.getElementById('editorHost').innerHTML = `<div class="modal-backdrop" id="backdrop"><div class="modal">
      <div class="card-head"><h2>${isNew ? 'New user' : 'Edit user'}</h2><button class="btn btn-outline btn-sm" id="closeBtn">Close</button></div>
      ${isNew ? `<div class="field"><label>Role</label><div class="pill-row">${['student', 'lecturer', 'admin'].map(r => `<button type="button" class="pill ${u.role === r ? 'active' : ''}" data-role="${r}">${r}</button>`).join('')}</div></div>` : `<p class="hint">Role cannot be changed after creation.</p>`}
      <div class="field"><label for="uName">Full name</label><input type="text" id="uName" value="${escapeHtml(u.name || '')}"></div>
      <div class="field"><label for="uEmail">Email</label><input type="email" id="uEmail" value="${escapeHtml(u.email || '')}"></div>
      <div class="field"><label for="uId">${u.role === 'student' ? 'Matriculation number' : 'Staff ID'}</label><input type="text" id="uId" value="${escapeHtml(u.matric || u.staffId || '')}"></div>
      ${u.role === 'student' ? `<div class="field-row"><div class="field"><label for="uLevel">Level</label><select id="uLevel">${LEVELS.map(l => `<option value="${l}" ${u.level === l ? 'selected' : ''}>${l}</option>`).join('')}</select></div><div class="field"><label for="uDepartment">Department</label><select id="uDepartment"><option value="">Select department…</option>${departments.filter(d => d.status === 'active').map(d => `<option value="${escapeHtml(d.name)}" ${u.department === d.name ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}</select></div></div>` : ''}
      <div class="field"><label for="uPass">${isNew ? 'Password' : 'New password (leave blank to keep current)'}</label><input type="text" id="uPass" value="" placeholder="${isNew ? 'At least 8 characters, letters and numbers' : 'Unchanged'}"></div>
      <div id="userError" class="error-text" style="display:none; margin-bottom:12px;"></div>
      <div class="btn-row"><button class="btn" id="saveUserBtn">${isNew ? 'Create account' : 'Save changes'}</button><button class="btn btn-outline" id="cancelUserBtn">Cancel</button></div></div></div>`;
    document.querySelectorAll('[data-role]').forEach(b => b.addEventListener('click', () => {
      u.name = document.getElementById('uName').value; u.email = document.getElementById('uEmail').value; u.role = b.dataset.role; renderEditor(isNew);
    }));
    document.getElementById('closeBtn').addEventListener('click', closeEditor);
    document.getElementById('cancelUserBtn').addEventListener('click', closeEditor);
    document.getElementById('backdrop').addEventListener('click', e => { if (e.target.id === 'backdrop') closeEditor(); });
    document.getElementById('saveUserBtn').addEventListener('click', async () => {
      const err = document.getElementById('userError'); err.style.display = 'none';
      const body = { name: document.getElementById('uName').value, email: document.getElementById('uEmail').value };
      const idVal = document.getElementById('uId').value.trim();
      if (u.role === 'student') { body.matric = idVal; const lv = document.getElementById('uLevel'); const dep = document.getElementById('uDepartment'); if (lv) body.level = lv.value; if (dep) body.department = dep.value; } else body.staffId = idVal;
      const pw = document.getElementById('uPass').value; if (pw) body.password = pw;
      try {
        if (isNew) { await API.post('/users', { ...body, role: u.role, password: pw }); toast('Account created.', 'success'); }
        else { await API.patch('/users/' + u.id, body); toast('Account updated.', 'success'); }
        closeEditor(); loadAll();
      } catch (e) { err.textContent = e.message; err.style.display = 'block'; }
    });
  }
  function exportUsers() {
    const list = currentList();
    const rows = [['Name', 'Role', 'Email', 'Matric/Staff ID', 'Status', 'Courses']];
    list.forEach(u => rows.push([u.name, u.role, u.email, u.matric || u.staffId || '', u.status, u.courseCount == null ? '' : u.courseCount]));
    downloadCsv('users.csv', rows); toast('User list exported.', 'success');
  }
  loadAll();
})();
