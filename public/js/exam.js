(async function () {
  const session = await requireRole('student');
  if (!session) return;

  const loadingMain = document.getElementById('loadingMain');
  const gateMain = document.getElementById('gateMain');
  const examMain = document.getElementById('examMain');
  const integrityBanner = document.getElementById('integrityBanner');

  function bail(message) {
    loadingMain.style.display = 'block'; gateMain.style.display = 'none'; examMain.style.display = 'none';
    loadingMain.innerHTML = `<div class="card empty"><div class="empty-title">Can't open this exam</div>
      <p>${escapeHtml(message)}</p><a class="btn btn-sm" href="student-dashboard.html">Back to my exams</a></div>`;
  }
  const goResult = id => { window.location.href = 'exam-result.html?attempt=' + encodeURIComponent(id); };

  const examId = qs('exam');
  let gate;
  try { gate = await API.get('/exams/' + encodeURIComponent(examId || '') + '/gate'); }
  catch (e) { return bail(e.status === 403 ? 'You are not registered as a candidate for this exam.' : e.message); }

  const exam = gate.exam, course = gate.course;
  if (gate.attempt && gate.attempt.status !== 'in-progress') return goResult(gate.attempt.id);
  if (exam.windowState === 'unpublished') return bail('This exam is not published yet.');
  if (exam.windowState === 'scheduled') return bail('This exam has not opened yet.');
  if (exam.windowState === 'closed' && !gate.attempt) return bail('This exam has closed.');

  const maxViolations = exam.maxViolations != null ? exam.maxViolations : 3;
  const resuming = !!gate.attempt;

  // ---------------- pre-start gate ----------------
  loadingMain.style.display = 'none';
  gateMain.style.display = 'block';
  document.getElementById('gateTitle').textContent = exam.title || 'Untitled exam';
  document.getElementById('gateMeta').textContent = course.code + ' · ' + exam.durationMinutes + ' minutes' + (resuming ? ' · resuming your paper' : '');
  document.getElementById('gateInstructions').innerHTML = exam.instructions
    ? `<p style="white-space:pre-wrap;">${escapeHtml(exam.instructions)}</p>` : '<p class="hint">No special instructions were given for this exam.</p>';

  const features = [
    'Your answers are saved to the server as you go. The timer is kept by the server and cannot be paused, even if you close this page.',
    'Copying, pasting and right-click are switched off on this page, and every blocked attempt is recorded.',
    maxViolations > 0
      ? `Leaving this tab or window is recorded. After ${maxViolations} such warning${maxViolations === 1 ? '' : 's'}, your paper is submitted automatically.`
      : 'Leaving this tab or window is recorded and shared with your lecturer.'
  ];
  if (exam.penaltyPerMajorViolation > 0 || exam.penaltyPerMinorViolation > 0)
    features.push('This exam applies a mark penalty for recorded security events. Your lecturer can review and waive penalties.');
  if (exam.requireFullscreen) features.push('This exam requires full-screen mode. Clicking Begin will ask your browser to enter full-screen — please allow it.');
  document.getElementById('gateFeatures').innerHTML = features.map(f => `<div class="gate-feature"><span class="dot"></span><span>${escapeHtml(f)}</span></div>`).join('');

  const gateBeginBtn = document.getElementById('gateBeginBtn');
  gateBeginBtn.textContent = resuming ? 'Resume exam' : 'Begin exam';
  const requestFs = () => {
    const el = document.documentElement, fn = el.requestFullscreen || el.webkitRequestFullscreen;
    return fn ? fn.call(el) : Promise.reject(new Error('not supported'));
  };

  gateBeginBtn.addEventListener('click', async () => {
    gateBeginBtn.disabled = true;
    const err = document.getElementById('gateError'); err.style.display = 'none';
    if (exam.requireFullscreen) { try { await requestFs(); } catch (e) { toast('Could not enter full-screen — continuing without it.', 'error'); } }
    try {
      const attempt = await API.post('/exams/' + encodeURIComponent(exam.id) + '/start');
      enterExam(attempt);
    } catch (e) {
      if (e.status === 409 && e.data && e.data.attemptId) return goResult(e.data.attemptId);
      gateBeginBtn.disabled = false; err.textContent = e.message; err.style.display = 'block';
    }
  });

  // ---------------- the exam itself ----------------
  function enterExam(attempt) {
    const questions = attempt.questions;
    if (!questions.length) return bail('This exam has no questions.');
    gateMain.style.display = 'none'; examMain.style.display = 'block';
    document.getElementById('examTitleTag').textContent = course.code + ' — ' + exam.title;

    // The deadline comes from the server. We only correct for the difference
    // between this computer's clock and the server's, so the countdown is accurate.
    const clockOffset = new Date(attempt.serverNow).getTime() - Date.now();
    const deadlineMs = new Date(attempt.deadline).getTime();

    const answers = attempt.answers || {};
    let currentIndex = 0, submitting = false;
    let fullscreenActive = !!(document.fullscreenElement || document.webkitFullscreenElement);
    const navGrid = document.getElementById('navGrid');
    const questionSheet = document.getElementById('questionSheet');
    const timerValue = document.getElementById('timerValue');
    const autosaveTag = document.getElementById('autosaveTag');

    const isAnswered = q => { const v = answers[q.id]; return v !== undefined && v !== null && String(v).trim() !== ''; };

    // ---- autosave to the server (debounced for typed answers, retried on failure) ----
    const pending = new Map(), timers = new Map();
    function setSaveStatus(t, bad) { autosaveTag.textContent = t; autosaveTag.style.color = bad ? 'var(--danger)' : ''; }
    async function flush(qid) {
      if (!pending.has(qid)) return;
      const value = pending.get(qid); pending.delete(qid);
      try {
        await API.put(`/attempts/${encodeURIComponent(attempt.id)}/answers/${encodeURIComponent(qid)}`, { value });
        if (!pending.size) { setSaveStatus('Saved'); setTimeout(() => { if (!pending.size) setSaveStatus(''); }, 1200); }
      } catch (e) {
        if (e.status === 409 && e.data && e.data.finished) { submitting = true; return goResult(e.data.attemptId || attempt.id); }
        if (!pending.has(qid)) pending.set(qid, value);
        setSaveStatus('Not saved — retrying…', true);
        setTimeout(() => flush(qid), 2500);
      }
    }
    function persist(qid, value, immediate) {
      answers[qid] = value; if (value === '') delete answers[qid];
      pending.set(qid, value); setSaveStatus('Saving…');
      clearTimeout(timers.get(qid));
      if (immediate) flush(qid); else timers.set(qid, setTimeout(() => flush(qid), 600));
      renderNav();
    }
    async function flushAll() {
      for (const [qid, t] of timers) clearTimeout(t);
      await Promise.all([...pending.keys()].map(flush));
    }

    function renderNav() {
      navGrid.innerHTML = questions.map((q, i) => {
        const cls = ['nav-cell']; if (isAnswered(q)) cls.push('answered'); if (i === currentIndex) cls.push('current');
        return `<div class="${cls.join(' ')}" data-idx="${i}" title="Question ${i + 1}">${i + 1}</div>`;
      }).join('');
      navGrid.querySelectorAll('.nav-cell').forEach(cell => cell.addEventListener('click', () => { currentIndex = Number(cell.dataset.idx); renderQuestion(); }));
      document.getElementById('answeredCount').textContent = questions.filter(isAnswered).length + '/' + questions.length;
    }

    function renderQuestion() {
      const q = questions[currentIndex], given = answers[q.id], isLast = currentIndex === questions.length - 1;
      let body = '';
      if (q.type === 'mcq' || q.type === 'truefalse') {
        body = `<div id="optionList">${q.options.map(opt => `
          <div class="option-row ${given === opt.id ? 'selected' : ''}" data-opt="${escapeHtml(opt.id)}">
            <span class="option-bubble"><span class="dot"></span></span><span>${escapeHtml(opt.text)}</span></div>`).join('')}</div>`;
      } else if (q.type === 'short') {
        body = `<input type="text" class="short-answer" id="textAnswer" placeholder="Type your answer" value="${escapeHtml(given || '')}" autocomplete="off" maxlength="500">
                <p class="hint">Be as exact as you can with spelling.</p>`;
      } else {
        body = `<textarea id="textAnswer" class="short-answer" rows="12" style="width:100%; min-height:220px;" placeholder="Write your answer here">${escapeHtml(given || '')}</textarea>
                <p class="hint" id="wordCount"></p>`;
      }
      questionSheet.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:10px; flex-wrap:wrap;">
          <span class="hint mono">QUESTION ${currentIndex + 1} OF ${questions.length}</span>
          <span style="display:flex; gap:6px; align-items:center;">${typeChip(q.type)}<span class="chip chip-closed">${q.marks} mark${q.marks === 1 ? '' : 's'}</span></span>
        </div>
        <h3 style="margin-bottom: 18px; line-height:1.45; white-space:pre-wrap;">${escapeHtml(q.text)}</h3>
        ${body}
        <div class="btn-row" style="margin-top: 22px; justify-content: space-between;">
          <button class="btn btn-outline btn-sm" id="prevBtn" ${currentIndex === 0 ? 'disabled' : ''}>Previous</button>
          ${isLast ? '<button class="btn btn-gold" id="submitBtn">Submit paper</button>' : '<button class="btn btn-sm" id="nextBtn">Next</button>'}
        </div>`;
      questionSheet.querySelectorAll('.option-row').forEach(row => row.addEventListener('click', () => {
        persist(q.id, row.dataset.opt, true); renderQuestion();
      }));
      const textEl = document.getElementById('textAnswer');
      if (textEl) {
        const wc = document.getElementById('wordCount');
        const upd = () => { if (wc) { const n = textEl.value.trim() ? textEl.value.trim().split(/\s+/).length : 0; wc.textContent = n + ' word' + (n === 1 ? '' : 's'); } };
        upd();
        textEl.addEventListener('input', () => { persist(q.id, textEl.value, false); upd(); });
      }
      const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
      on('prevBtn', () => { currentIndex--; renderQuestion(); });
      on('nextBtn', () => { currentIndex++; renderQuestion(); });
      on('submitBtn', confirmSubmit);
      renderNav();
    }

    function confirmSubmit() {
      const unanswered = questions.filter(q => !isAnswered(q)).length;
      const msg = unanswered > 0 ? `You have ${unanswered} unanswered question${unanswered === 1 ? '' : 's'}. Submit anyway? This cannot be undone.` : 'Submit your paper now? This cannot be undone.';
      if (window.confirm(msg)) doSubmit();
    }

    async function doSubmit() {
      if (submitting) return;
      submitting = true; clearInterval(timerHandle);
      if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document).catch(() => {});
      setSaveStatus('Submitting…');
      await flushAll();
      for (let i = 0; i < 5; i++) {
        try { const r = await API.post(`/attempts/${encodeURIComponent(attempt.id)}/submit`); return goResult(r.attemptId); }
        catch (e) { await new Promise(r => setTimeout(r, 1500)); }
      }
      submitting = false;
      toast('Could not reach the server to submit. Your answers are saved; keep this page open and try again.', 'error');
    }
    document.getElementById('submitSideBtn').addEventListener('click', confirmSubmit);

    // ---------------- integrity signals (logged on the server; browser-side, so advisory) ----------------
    function showIntegrityBanner(text) {
      integrityBanner.textContent = text; integrityBanner.style.display = 'block';
      clearTimeout(showIntegrityBanner._t);
      showIntegrityBanner._t = setTimeout(() => { integrityBanner.style.display = 'none'; }, 6000);
    }
    async function report(type, humanText) {
      if (submitting) return;
      try {
        const r = await API.post(`/attempts/${encodeURIComponent(attempt.id)}/integrity`, { type });
        if (r.autoSubmitted) { submitting = true; showIntegrityBanner('Too many security warnings — your paper was submitted.'); return setTimeout(() => goResult(attempt.id), 800); }
        if (humanText) showIntegrityBanner(humanText + (maxViolations > 0 ? ` (warning ${r.major} of ${maxViolations} before auto-submit)` : ''));
      } catch (e) { /* the server keeps the count; a dropped signal is not the candidate's fault */ }
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) report('tab_hidden', 'You left this tab — that has been recorded.'); });
    ['fullscreenchange', 'webkitfullscreenchange'].forEach(evt => document.addEventListener(evt, () => {
      const nowFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      if (exam.requireFullscreen && fullscreenActive && !nowFs) report('fullscreen_exit', 'You exited full-screen — that has been recorded.');
      fullscreenActive = nowFs;
    }));
    document.addEventListener('contextmenu', e => { e.preventDefault(); report('contextmenu_blocked'); });
    ['copy', 'cut', 'paste'].forEach(evt => document.addEventListener(evt, e => { e.preventDefault(); report(evt + '_blocked'); }));
    document.addEventListener('keydown', e => {
      const k = e.key ? e.key.toLowerCase() : '';
      const blocked = k === 'f12' || (e.ctrlKey && e.shiftKey && ['i', 'j', 'c'].includes(k)) || (e.metaKey && e.altKey && ['i', 'j', 'c'].includes(k)) || (e.ctrlKey && k === 'u');
      if (blocked) { e.preventDefault(); report('devtools_shortcut'); }
    });
    window.addEventListener('beforeunload', e => { if (!submitting) { e.preventDefault(); e.returnValue = ''; } });

    // ---------------- countdown (display only; the server enforces the deadline) ----------------
    function tick() {
      const remaining = deadlineMs - (Date.now() + clockOffset);
      if (remaining <= 0) {
        timerValue.textContent = '00:00';
        toast('Time is up — submitting your paper.', 'error');
        doSubmit(); return;
      }
      const secs = Math.ceil(remaining / 1000), h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
      timerValue.textContent = (h > 0 ? String(h).padStart(2, '0') + ':' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
      timerValue.classList.toggle('low', secs <= 60);
    }
    var timerHandle = setInterval(tick, 1000);
    tick();
    renderQuestion();
  }
})();
