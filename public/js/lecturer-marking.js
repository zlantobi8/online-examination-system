(async function () {
  const session = await requireRole('lecturer');
  if (!session) return;
  renderShell('lecturer-marking.html');
  const content = document.getElementById('content');
  const filterExam = qs('exam');
  let queue = [], skipped = 0;

  async function load() {
    try { queue = await API.get('/marking' + (filterExam ? '?exam=' + encodeURIComponent(filterExam) : '')); } catch (e) { return showError(e); }
    render();
  }
  function render() {
    if (queue.length === 0) {
      content.innerHTML = `<div class="page-head"><div><h1>Marking</h1><p>Essay answers that need a score before a result becomes final.</p></div></div>
        <section class="card">${emptyState('Nothing waiting to be marked', 'Objective questions are marked automatically. Essay answers land here when a candidate submits.')}</section>`; return;
    }
    const item = queue[skipped % queue.length];
    content.innerHTML = `
      <div class="page-head"><div><h1>Marking</h1><p>${queue.length} script${queue.length === 1 ? '' : 's'} waiting${filterExam ? ' on this exam' : ''}.</p></div>
        ${filterExam ? '<a class="btn btn-outline btn-sm" href="lecturer-marking.html">Show all exams</a>' : ''}</div>
      <section class="card"><div class="card-head"><h2>${escapeHtml(item.student ? item.student.name : 'Unknown candidate')}</h2>
        <span class="hint mono">${escapeHtml(item.student && item.student.matric || '')}</span></div>
        <p class="hint" style="margin-top:-8px;">${escapeHtml(item.exam.title)} · ${escapeHtml(item.course ? item.course.code : '')} · submitted ${formatDate(item.submittedAt)}</p>
        <p class="hint">Objective questions already scored <strong>${item.autoScore}</strong> of ${item.totalMarks}. Essay marks are added to that.</p></section>
      ${item.essays.map(q => {
        const words = q.answer.trim() ? q.answer.trim().split(/\s+/).length : 0;
        return `<section class="card"><p class="hint mono" style="margin-bottom:4px;">ESSAY · ${q.marks} MARKS AVAILABLE · ${words} WORD${words === 1 ? '' : 'S'}</p>
          <h3 style="margin-bottom:10px;">${escapeHtml(q.text)}</h3>
          <div class="answer-quote">${q.answer.trim() ? escapeHtml(q.answer) : '(the candidate left this blank)'}</div>
          <div class="mark-box" style="margin-top:12px;"><label for="mark-${q.id}" style="font-weight:600; font-size:0.85rem;">Marks awarded</label>
            <input type="number" id="mark-${q.id}" min="0" max="${q.marks}" value="${q.current === null ? '' : q.current}" placeholder="0"><span class="hint">out of ${q.marks}</span></div></section>`;
      }).join('')}
      <div class="field"><label for="reason">Note (optional, kept in the audit log)</label><input type="text" id="reason" maxlength="300"></div>
      <div id="markError" class="error-text" style="display:none; margin-bottom:12px;"></div>
      <div class="btn-row"><button class="btn" id="saveMarkBtn">Save marks</button>
        <button class="btn btn-outline" id="skipBtn" ${queue.length < 2 ? 'disabled' : ''}>Skip for now</button></div>`;

    document.getElementById('saveMarkBtn').addEventListener('click', async () => {
      const err = document.getElementById('markError'); err.style.display = 'none';
      const marks = {};
      for (const q of item.essays) {
        const raw = document.getElementById('mark-' + q.id).value;
        const n = Number(raw);
        if (raw === '' || isNaN(n) || n < 0 || n > q.marks) { err.textContent = `Give every essay a mark between 0 and its maximum (${q.marks}).`; err.style.display = 'block'; return; }
        marks[q.id] = n;
      }
      try {
        await API.put(`/attempts/${item.attemptId}/marks`, { marks, reason: document.getElementById('reason').value });
        toast('Marks saved. The change is recorded in the audit log.', 'success'); skipped = 0; load();
      } catch (e) { err.textContent = e.message; err.style.display = 'block'; }
    });
    document.getElementById('skipBtn').addEventListener('click', () => { skipped++; render(); });
  }
  load();
})();
