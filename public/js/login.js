(async function () {
  initThemeToggles();
  try {
    const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (r.ok) { const { user } = await r.json(); window.location.href = HOME[user.role]; return; }
  } catch (e) {}

  const iconFor = { student: ICONS.student, lecturer: ICONS.lecturer, admin: ICONS.admin };
  const tiles = [...document.querySelectorAll('.role-tile')];
  let role = ['student', 'lecturer', 'admin'].includes(qs('role')) ? qs('role') : 'student';
  tiles.forEach(t => {
    t.querySelector('.role-icon').innerHTML = iconFor[t.dataset.role];
    t.addEventListener('click', () => { role = t.dataset.role; apply(); });
  });
  function apply() { tiles.forEach(t => t.classList.toggle('active', t.dataset.role === role)); }
  apply();

  const form = document.getElementById('loginForm');
  const formError = document.getElementById('formError');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    formError.style.display = 'none';
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      const { user } = await API.post('/auth/login', {
        email: document.getElementById('email').value.trim(),
        password: document.getElementById('password').value
      });
      // The server decides the role; the tiles are only a visual hint.
      window.location.href = HOME[user.role];
    } catch (err) {
      formError.textContent = err.message;
      formError.style.display = 'block';
      btn.disabled = false;
    }
  });
})();
