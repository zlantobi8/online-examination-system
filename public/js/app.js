/* =========================================================
   app.js — shared UI shell and helpers for every page
   ========================================================= */

const INSTITUTION = {
  short: 'FPA',
  name: 'Online Examination System',
  sub: 'The Federal Polytechnic, Ado-Ekiti'
};

const ICONS = {
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/></svg>',
  bank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>',
  pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.5-7 8-7s8 3 8 7"/></svg>',
  lecturer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18v11H3z"/><path d="M8 21h8"/><path d="M12 16v5"/></svg>',
  student: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="6" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="18" r="1.4"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>'
};

const NAV = {
  student: [
    { group: 'Main', items: [
      { href: 'student-dashboard.html', label: 'My Exams', icon: 'grid' },
      { href: 'student-results.html', label: 'My Results', icon: 'chart' }
    ] },
    { group: 'Courses', items: [
      { href: 'student-courses.html', label: 'Course Registration', icon: 'book' }
    ] }
  ],
  lecturer: [
    { group: 'Main', items: [
      { href: 'lecturer-dashboard.html', label: 'Dashboard', icon: 'grid' }
    ] },
    { group: 'Teaching', items: [
      { href: 'lecturer-bank.html', label: 'Question Bank', icon: 'bank' },
      { href: 'lecturer-exams.html', label: 'Exams', icon: 'file' },
      { href: 'lecturer-students.html', label: 'Students', icon: 'users' }
    ] },
    { group: 'Courses', items: [
      { href: 'lecturer-courses.html', label: 'My Courses', icon: 'book' }
    ] }
  ],
  admin: [
    { group: 'Main', items: [
      { href: 'admin-dashboard.html', label: 'Dashboard', icon: 'grid' }
    ] },
    { group: 'Management', items: [
      { href: 'admin-users.html', label: 'Users', icon: 'users' },
      { href: 'admin-courses.html', label: 'Courses', icon: 'book' },
      { href: 'admin-registrations.html', label: 'Registration', icon: 'file' }
    ] }
  ]
};

const HOME = {
  student: 'student-dashboard.html',
  lecturer: 'lecturer-dashboard.html',
  admin: 'admin-dashboard.html'
};

// ---------- theme (light default, dark opt-in, remembered) ----------

function getTheme() {
  try { return localStorage.getItem('oes_theme') || 'light'; } catch (e) { return 'light'; }
}

function applyTheme(theme) {
  if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
    btn.innerHTML = theme === 'dark' ? ICONS.sun : ICONS.moon;
    btn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  });
}

function setTheme(theme) {
  try { localStorage.setItem('oes_theme', theme); } catch (e) {}
  applyTheme(theme);
}

function toggleTheme() { setTheme(getTheme() === 'dark' ? 'light' : 'dark'); }

// Wires up every [data-theme-toggle] button already in the DOM and syncs
// their icon to the stored preference. Call after inserting toggle buttons.
function initThemeToggles() {
  document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
    btn.addEventListener('click', toggleTheme);
  });
  applyTheme(getTheme());
}

function toast(message, type) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = message;
  el.className = type ? 'show ' + type : 'show';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = el.className.replace('show', ''); }, 3200);
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
function formatDateShort(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
// Converts an ISO string into the value a datetime-local input expects.
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v) { return v ? new Date(v).toISOString() : null; }

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, s => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[s]));
}

function initials(name) {
  return String(name).trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
}

const TYPE_LABEL = { mcq: 'Multiple choice', truefalse: 'True / False', short: 'Short answer', essay: 'Essay' };

function typeChip(type) {
  return `<span class="chip chip-type">${TYPE_LABEL[type] || type}</span>`;
}
function difficultyChip(d) {
  return `<span class="chip chip-${d}">${d}</span>`;
}
function examStateChip(exam) {
  const map = {
    unpublished: ['chip-draft', 'Draft'],
    scheduled: ['chip-scheduled', 'Scheduled'],
    open: ['chip-open', 'Open'],
    closed: ['chip-closed', exam.status === 'archived' ? 'Archived' : 'Closed']
  };
  const [cls, label] = map[exam.windowState] || map.unpublished;
  return `<span class="chip ${cls}">${label}</span>`;
}

// Downloads rows as a CSV file — the department's paper record.
function downloadCsv(filename, rows) {
  const esc = v => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = rows.map(r => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderShell(activeHref, opts) {
  opts = opts || {};
  const session = window.SESSION;
  if (!session) return;
  const sidebarEl = document.getElementById('sidebar');
  const topbarEl = document.getElementById('topbar');
  const groups = NAV[session.role] || [];

  if (sidebarEl) {
    sidebarEl.innerHTML = `
      <a class="sidebar-brand" href="${HOME[session.role]}">
        <span class="mark">${INSTITUTION.short}</span>
        <span>
          <span class="name">ExamSuite</span>
          <span class="institution-line">${escapeHtml(INSTITUTION.sub)}</span>
        </span>
      </a>
      ${groups.map(g => `
        <div class="sidebar-group">
          <div class="sidebar-group-label">${escapeHtml(g.group)}</div>
          <nav class="sidebar-nav">
            ${g.items.map(i => `
              <a href="${i.href}" class="${i.href === activeHref ? 'active' : ''}">
                ${ICONS[i.icon] || ''}<span>${i.label}</span>
              </a>`).join('')}
          </nav>
        </div>`).join('')}
      <div class="sidebar-foot">
        <button class="profile-card" id="sidebarLogout" type="button" title="Log out">
          <div class="avatar">${initials(session.name)}</div>
          <div class="who">
            <span class="name">${escapeHtml(session.name)}</span>
            <span class="role">${escapeHtml(session.role)}</span>
          </div>
          ${ICONS.logout}
        </button>
      </div>`;
    document.getElementById('sidebarLogout').addEventListener('click', async () => {
      try { await API.post('/auth/logout'); } catch (e) {}
      window.location.href = 'index.html';
    });
  }

  if (topbarEl) {
    const searchHtml = opts.onSearch
      ? `<label class="topbar-search">${ICONS.search}
           <input type="search" id="globalSearch" placeholder="${escapeHtml(opts.searchPlaceholder || 'Search…')}">
         </label>`
      : '<span></span>';
    topbarEl.innerHTML = `
      <button class="menu-toggle" id="menuToggle" type="button" aria-label="Open menu" aria-expanded="false">${ICONS.menu}</button>
      ${searchHtml}
      <div class="topbar-right">
        <button class="theme-toggle" data-theme-toggle type="button"></button>
        <div class="avatar" title="${escapeHtml(session.name)}">${initials(session.name)}</div>
      </div>`;
    if (opts.onSearch) {
      const input = document.getElementById('globalSearch');
      input.addEventListener('input', () => opts.onSearch(input.value.trim().toLowerCase()));
    }
    initThemeToggles();
    document.getElementById('menuToggle').addEventListener('click', () => toggleSidebar());
  }

  initMobileSidebar();
}

// ---------- mobile sidebar drawer ----------

function toggleSidebar(force) {
  const sidebarEl = document.getElementById('sidebar');
  const menuBtn = document.getElementById('menuToggle');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (!sidebarEl) return;
  const open = typeof force === 'boolean' ? force : !sidebarEl.classList.contains('open');
  sidebarEl.classList.toggle('open', open);
  if (backdrop) backdrop.classList.toggle('show', open);
  if (menuBtn) menuBtn.setAttribute('aria-expanded', String(open));
  document.body.style.overflow = open ? 'hidden' : '';
}

// Wires the backdrop, escape key, resize and in-drawer link taps so the
// sidebar behaves like a proper mobile nav drawer. Safe to call more than
// once — it only creates the backdrop element the first time.
function initMobileSidebar() {
  let backdrop = document.getElementById('sidebarBackdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'sidebarBackdrop';
    backdrop.className = 'sidebar-backdrop';
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', () => toggleSidebar(false));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') toggleSidebar(false); });
    window.addEventListener('resize', () => { if (window.innerWidth > 900) toggleSidebar(false); });
  }
  const sidebarEl = document.getElementById('sidebar');
  if (sidebarEl) {
    sidebarEl.querySelectorAll('a, button').forEach(el => {
      el.addEventListener('click', () => { if (window.innerWidth <= 900) toggleSidebar(false); });
    });
  }
}

// Asks the server who we are. This only decides which page to SHOW; the server
// independently authorises every API call, so editing this in devtools grants nothing.
async function requireRole(role) {
  try {
    const { user } = await API.get('/auth/me');
    window.SESSION = user;
    if (user.role !== role) { window.location.href = HOME[user.role]; return null; }
    return user;
  } catch (e) {
    window.location.href = 'login.html';
    return null;
  }
}

// Shows a server/network error in the page body instead of leaving a blank screen.
function showError(err, target) {
  const el = target || document.getElementById('content');
  if (!el) return;
  el.innerHTML = `<section class="card">${emptyState('Something went wrong', err && err.message ? err.message : 'Please try again.')}</section>`;
}

function qs(name) { return new URLSearchParams(window.location.search).get(name); }

function emptyState(title, body, action) {
  return `<div class="empty">
    <div class="empty-title">${escapeHtml(title)}</div>
    <p>${escapeHtml(body)}</p>
    ${action || ''}
  </div>`;
}

function courseLabel(c) {
  return `${c.code} — ${c.title}${c.level ? ' · ' + c.level : ''}`;
}
