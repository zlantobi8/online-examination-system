(function () {
  initThemeToggles();
  const form = document.getElementById('registerForm');
  const formError = document.getElementById('formError');
  const departmentSelect = document.getElementById('department');
  API.get('/auth/departments').then(rows => { departmentSelect.innerHTML = '<option value="">Select department…</option>' + rows.map(d => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`).join(''); }).catch(() => { departmentSelect.innerHTML = '<option value="">Unable to load departments</option>'; });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    formError.style.display = 'none';
    const pw = document.getElementById('password').value;
    const fail = m => { formError.textContent = m; formError.style.display = 'block'; };
    if (pw !== document.getElementById('password2').value) return fail('Passwords do not match.');
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      // Account creation only. Courses are registered later, in the controlled registration window.
      await API.post('/auth/register', {
        name: document.getElementById('name').value,
        email: document.getElementById('email').value,
        matric: document.getElementById('matric').value,
        level: document.getElementById('level').value,
        department: document.getElementById('department').value,
        password: pw
      });
      window.location.href = HOME.student;
    } catch (err) { fail(err.message); btn.disabled = false; }
  });
})();
