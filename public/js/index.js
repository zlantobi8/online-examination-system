(async function () {
  try {
    const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (r.ok) {
      const { user } = await r.json();
      const firstName = escapeHtml((user.name || '').split(' ')[0] || 'there');
      document.getElementById('navActions').innerHTML =
        `<button class="theme-toggle" data-theme-toggle type="button" aria-label="Toggle theme"></button>
         <span style="align-self:center; color:var(--text-mute); font-size:.75rem; margin-right:4px;">Hi, ${firstName}</span>
         <a class="btn btn-sm" href="${HOME[user.role] || 'login.html'}">Dashboard</a>`;
    }
  } catch (e) { /* public page remains usable offline */ }
  if (typeof initThemeToggles === 'function') initThemeToggles();
})();
