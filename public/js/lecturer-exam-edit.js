(async function () {
  const session = await requireRole('lecturer');
  if (!session) return;
  renderShell('lecturer-exams.html');
  const content = document.getElementById('content');
  const notFound = (t, b) => { content.innerHTML = `<section class="card">${emptyState(t, b, '<a class="btn btn-sm" href="lecturer-exams.html">Back to exams</a>')}</section>`; };

  let exam, courses;
  try { [exam, courses] = await Promise.all([API.get('/exams/' + encodeURIComponent(qs('exam') || '')), API.get('/courses')]); }
  catch (e) { return notFound('Exam not found', e.message); }

  if (exam.status !== 'draft') {
    return notFound('This exam is frozen', 'Once published, an exam\u2019s questions and settings cannot change, so every candidate sits the same paper. Duplicate it to make a new version.');
  }
  const draft = JSON.parse(JSON.stringify(exam));
  let bank = [], bankFilter = '';
  async function loadBank() { bank = await API.get('/courses/' + draft.courseId + '/questions'); }
  try { await loadBank(); } catch (e) { return showError(e); }

  const poolOf = () => bank.filter(q => q.type !== 'essay' && (draft.randomDifficulty === 'any' || q.difficulty === draft.randomDifficulty));

  function render() {
    const pool = poolOf();
    const selected = draft.questionIds.filter(id => bank.some(q => q.id === id));
    const selectedMarks = selected.reduce((s, id) => s + bank.find(q => q.id === id).marks, 0);
    const willFace = draft.selectionMode === 'random' ? Math.min(draft.randomCount, pool.length) : selected.length;
    const shown = bankFilter ? bank.filter(q => (q.text + ' ' + (q.topic || '')).toLowerCase().includes(bankFilter)) : bank;
    const chk = (id, on, title, hint) => `<label style="display:flex; gap:10px; align-items:flex-start; margin-bottom:12px; cursor:pointer;">
      <input type="checkbox" id="${id}" ${on ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--primary);margin-top:2px;">
      <span><strong>${title}</strong><br><span class="hint">${hint}</span></span></label>`;

    content.innerHTML = `
      <a href="lecturer-exams.html" class="hint">&larr; Back to exams</a>
      <div class="page-head" style="margin-top:10px;"><div><h1>${escapeHtml(draft.title || 'Untitled exam')}</h1>
        <p>${examStateChip(draft)} Draft. Publishing freezes the paper and fixes the candidate list.</p></div>
        <div class="btn-row"><button class="btn btn-outline" id="saveDraftBtn">Save draft</button><button class="btn" id="savePublishBtn">Save &amp; publish</button></div></div>

      <section class="card"><div class="card-head"><h2>Paper details</h2></div>
        <div class="field-row">
          <div class="field"><label for="fTitle">Exam title</label><input type="text" id="fTitle" value="${escapeHtml(draft.title)}"></div>
          <div class="field"><label for="fCourse">Course</label><select id="fCourse">${courses.filter(c => c.status === 'active').map(c =>
            `<option value="${c.id}" ${c.id === draft.courseId ? 'selected' : ''}>${escapeHtml(c.code + ' — ' + c.title)}</option>`).join('')}</select></div></div>
        <div class="field"><label for="fInstructions">Instructions shown to candidates</label><textarea id="fInstructions">${escapeHtml(draft.instructions || '')}</textarea></div>
        <div class="field-row">
          <div class="field"><label for="fDuration">Duration (minutes)</label><input type="number" id="fDuration" min="1" value="${draft.durationMinutes}"></div>
          <div class="field"><label for="fOpens">Opens at (optional)</label><input type="datetime-local" id="fOpens" value="${toLocalInput(draft.opensAt)}"></div>
          <div class="field"><label for="fCloses">Closes at (optional)</label><input type="datetime-local" id="fCloses" value="${toLocalInput(draft.closesAt)}"></div></div>
        <p class="hint">Times are enforced by the server clock. A candidate's deadline is their start time plus the duration, or the closing time if that is earlier.</p></section>

      <section class="card"><div class="card-head"><h2>Randomisation</h2></div>
        ${chk('fShuffleQ', draft.shuffleQuestions, 'Shuffle question order', 'Each candidate sees the questions in a different order.')}
        ${chk('fShuffleO', draft.shuffleOptions, 'Shuffle options within multiple-choice questions', 'True/False keeps its natural order.')}</section>

      <section class="card"><div class="card-head"><h2>Exam security &amp; results</h2></div>
        <p class="hint" style="margin-top:-4px; margin-bottom:14px;">Browser signals (tab switches, blocked copy/paste) are logged on the server and shown to you, but they run on the candidate's computer and can be bypassed — treat them as evidence to review, not proof.</p>
        ${chk('fRequireFullscreen', draft.requireFullscreen, 'Require full-screen mode', 'Exiting full-screen is logged. Leave off for exams sat on phones.')}
        <div class="field-row"><div class="field"><label for="fMaxViolations">Auto-submit after this many tab-switches / full-screen exits</label>
          <input type="number" id="fMaxViolations" min="0" value="${draft.maxViolations}"><p class="hint">0 = record only, never auto-submit.</p></div></div>
        <div class="field-row">
          <div class="field"><label for="fPenaltyMajor">Penalty per tab-switch / full-screen exit (% of total)</label><input type="number" id="fPenaltyMajor" min="0" max="100" value="${draft.penaltyPerMajorViolation}"></div>
          <div class="field"><label for="fPenaltyMinor">Penalty per blocked copy/paste/devtools attempt (%)</label><input type="number" id="fPenaltyMinor" min="0" max="100" value="${draft.penaltyPerMinorViolation}"></div></div>
        <p class="hint">Default is <strong>0 — no automatic penalty</strong>. Only set a penalty if your institution's policy says so; you can waive it per candidate from the results page.</p>
        <div class="field"><label for="fShowAnswers">Answer review</label><select id="fShowAnswers">
          <option value="after_release" ${draft.showAnswers === 'after_release' ? 'selected' : ''}>Show correct answers after results are released AND the exam has closed</option>
          <option value="never" ${draft.showAnswers === 'never' ? 'selected' : ''}>Never show correct answers</option></select></div></section>

      <section class="card"><div class="card-head"><h2>Questions</h2><span class="hint">${willFace} question${willFace === 1 ? '' : 's'} per candidate</span></div>
        <div class="pill-row" style="margin-bottom:16px;">
          <button type="button" class="pill ${draft.selectionMode === 'fixed' ? 'active' : ''}" data-mode="fixed">Fixed set</button>
          <button type="button" class="pill ${draft.selectionMode === 'random' ? 'active' : ''}" data-mode="random">Random draw from bank</button></div>
        ${draft.selectionMode === 'random' ? `
          <div class="field-row"><div class="field"><label for="fCount">Questions to draw per candidate</label><input type="number" id="fCount" min="1" value="${draft.randomCount}"></div>
            <div class="field"><label for="fDiff">Difficulty</label><select id="fDiff">${['any', 'easy', 'medium', 'hard'].map(d => `<option value="${d}" ${draft.randomDifficulty === d ? 'selected' : ''}>${d}</option>`).join('')}</select></div></div>
          <p class="hint">Pool: <strong>${pool.length}</strong> auto-graded question${pool.length === 1 ? '' : 's'} from your bank (essays are excluded from random draws).
            ${draft.randomCount > pool.length ? '<span style="color:var(--danger)"> The pool is smaller than the number requested — you cannot publish until it is large enough.</span>' : ''}</p>`
        : `<p class="hint" style="margin-bottom:12px;">${selected.length} selected · ${selectedMarks} marks total</p>
          <div class="toolbar"><input type="search" id="bankSearch" placeholder="Filter the bank…" value="${escapeHtml(bankFilter)}"><span class="spacer"></span>
            <button class="btn btn-outline btn-sm" id="selectAllBtn">Select all shown</button><button class="btn btn-outline btn-sm" id="clearAllBtn">Clear selection</button></div>
          ${bank.length === 0 ? emptyState('This course has no banked questions', 'Add questions to the bank first, then pick them here.',
              `<a class="btn btn-sm" href="lecturer-bank.html?course=${draft.courseId}">Go to question bank</a>`)
            : shown.map(q => `<label class="q-row" style="cursor:pointer;"><input type="checkbox" data-pick="${q.id}" ${draft.questionIds.includes(q.id) ? 'checked' : ''}>
              <div class="q-body"><div class="q-text">${escapeHtml(q.text)}</div><div class="q-tags">${typeChip(q.type)} ${difficultyChip(q.difficulty)}
              ${q.topic ? `<span class="chip chip-closed">${escapeHtml(q.topic)}</span>` : ''}<span class="chip chip-closed">${q.marks} mark${q.marks === 1 ? '' : 's'}</span></div></div></label>`).join('')}`}
      </section>
      <div id="editError" class="error-text" style="display:none; margin-bottom:12px;"></div>`;
    wire();
  }

  function collect() {
    const g = id => document.getElementById(id);
    draft.title = g('fTitle').value; draft.courseId = g('fCourse').value; draft.instructions = g('fInstructions').value;
    draft.durationMinutes = parseInt(g('fDuration').value, 10) || 0;
    draft.opensAt = fromLocalInput(g('fOpens').value); draft.closesAt = fromLocalInput(g('fCloses').value);
    draft.shuffleQuestions = g('fShuffleQ').checked; draft.shuffleOptions = g('fShuffleO').checked;
    draft.requireFullscreen = g('fRequireFullscreen').checked;
    draft.maxViolations = Math.max(0, parseInt(g('fMaxViolations').value, 10) || 0);
    draft.penaltyPerMajorViolation = Math.max(0, Math.min(100, parseInt(g('fPenaltyMajor').value, 10) || 0));
    draft.penaltyPerMinorViolation = Math.max(0, Math.min(100, parseInt(g('fPenaltyMinor').value, 10) || 0));
    draft.showAnswers = g('fShowAnswers').value;
    if (g('fCount')) draft.randomCount = parseInt(g('fCount').value, 10) || 1;
    if (g('fDiff')) draft.randomDifficulty = g('fDiff').value;
  }

  function wire() {
    const bs = document.getElementById('bankSearch');
    if (bs) bs.addEventListener('input', () => { collect(); bankFilter = bs.value.trim().toLowerCase(); render(); const a = document.getElementById('bankSearch'); a.focus(); a.setSelectionRange(a.value.length, a.value.length); });
    document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { collect(); draft.selectionMode = b.dataset.mode; render(); }));
    document.getElementById('fCourse').addEventListener('change', async () => { collect(); draft.questionIds = []; try { await loadBank(); } catch (e) { toast(e.message, 'error'); } render(); });
    document.getElementById('fDiff') && document.getElementById('fDiff').addEventListener('change', () => { collect(); render(); });
    document.getElementById('fCount') && document.getElementById('fCount').addEventListener('change', () => { collect(); render(); });
    document.querySelectorAll('[data-pick]').forEach(cb => cb.addEventListener('change', () => {
      const id = cb.dataset.pick;
      if (cb.checked) { if (!draft.questionIds.includes(id)) draft.questionIds.push(id); } else draft.questionIds = draft.questionIds.filter(x => x !== id);
      collect(); render();
    }));
    const selAll = document.getElementById('selectAllBtn');
    if (selAll) selAll.addEventListener('click', () => { collect(); (bankFilter ? bank.filter(q => (q.text + ' ' + (q.topic || '')).toLowerCase().includes(bankFilter)) : bank).forEach(q => { if (!draft.questionIds.includes(q.id)) draft.questionIds.push(q.id); }); render(); });
    const clr = document.getElementById('clearAllBtn');
    if (clr) clr.addEventListener('click', () => { collect(); draft.questionIds = []; render(); });
    document.getElementById('saveDraftBtn').addEventListener('click', () => save(false));
    document.getElementById('savePublishBtn').addEventListener('click', () => save(true));
  }

  async function save(publish) {
    collect();
    const err = document.getElementById('editError'); err.style.display = 'none';
    try {
      await API.put('/exams/' + draft.id, draft);
      if (publish) {
        if (!confirm('Publish now? The paper will be frozen (questions, marks and settings can no longer change) and the candidate list fixed.')) return;
        await API.post('/exams/' + draft.id + '/publish');
      }
      toast(publish ? 'Exam saved and published.' : 'Draft saved.', 'success');
      setTimeout(() => { window.location.href = 'lecturer-exams.html'; }, 500);
    } catch (e) { err.textContent = e.message; err.style.display = 'block'; }
  }
  render();
})();
