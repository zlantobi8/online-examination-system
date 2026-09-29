/* api.js — thin client for the Express API. The browser holds NO authoritative
   data: no users, no answers, no scores, no clock. Everything is fetched from
   (and validated by) the server. The session lives in an HttpOnly cookie that
   JavaScript cannot read. */
const API = (() => {
  let pending = 0;
  let hideTimer = null;
  function setLoading(on) {
    let el = document.getElementById('globalLoading');
    if (!el) {
      el = document.createElement('div');
      el.id = 'globalLoading';
      el.innerHTML = '<div class="global-loading-card"><span class="loading-spinner"></span><span>Working…</span></div>';
      document.body.appendChild(el);
    }
    if (on) {
      clearTimeout(hideTimer);
      el.classList.add('show');
    } else if (pending === 0) {
      hideTimer = setTimeout(() => el.classList.remove('show'), 120);
    }
  }
  async function call(method, url, body) {
    pending++;
    setLoading(true);
    try {
      let res;
      try {
        res = await fetch('/api' + url, {
          method,
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'oes' },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
      } catch (e) {
        const err = new Error('Cannot reach the server. Check your connection and try again.');
        err.network = true;
        throw err;
      }
      let data = null;
      try { data = await res.json(); } catch (e) { /* empty body */ }
      if (!res.ok) {
        const err = new Error((data && data.error) || 'Request failed (' + res.status + ').');
        err.status = res.status; err.data = data;
        if (res.status === 401 && !/login|register/.test(location.pathname) && !/auth\/login/.test(url)) {
          location.href = 'login.html';
        }
        throw err;
      }
      return data;
    } finally {
      pending = Math.max(0, pending - 1);
      setLoading(false);
    }
  }
  async function upload(url, formData) {
    pending++; setLoading(true);
    try {
      let res;
      try { res = await fetch('/api' + url, { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'oes' }, body: formData }); }
      catch (e) { const err = new Error('Cannot reach the server. Check your connection and try again.'); err.network = true; throw err; }
      let data = null; try { data = await res.json(); } catch (e) {}
      if (!res.ok) { const err = new Error((data && data.error) || 'Upload failed (' + res.status + ').'); err.status = res.status; throw err; }
      return data;
    } finally { pending = Math.max(0, pending - 1); setLoading(false); }
  }
  return {
    get: u => call('GET', u), post: (u, b) => call('POST', u, b === undefined ? {} : b),
    put: (u, b) => call('PUT', u, b), patch: (u, b) => call('PATCH', u, b), del: u => call('DELETE', u), upload
  };
})();
window.API = API;
