(async function () {
  const session = await requireRole('lecturer');
  if (!session) return;
  let term = '';
  renderShell('lecturer-bank.html', { searchPlaceholder: 'Search questions…', onSearch: t => { term = t; renderList(); } });
  const content = document.getElementById('content');
  let courses;
  try { courses = await API.get('/courses'); } catch (e) { return showError(e); }

  if (courses.length === 0) {
    content.innerHTML = `<div class="page-head"><div><h1>Question bank</h1></div></div><section class="card">${emptyState('You are not offering any course yet',
      'Your administrator assigns lecturers to courses. Once assigned, come back here to bank questions.', '<a class="btn btn-sm" href="lecturer-courses.html">My Courses</a>')}</section>`;
    return;
  }
  let courseId = qs('course') && courses.some(c => c.id === qs('course')) ? qs('course') : courses[0].id;
  let filterType = 'all', filterDiff = 'all', editing = null, bank = [];
  const TYPES = ['mcq', 'truefalse', 'short', 'essay'];

  content.innerHTML = `
    <div class="page-head"><div><h1>Question bank</h1><p>Questions live on the course. Publishing an exam freezes a copy, so editing the bank later never changes an exam already set.</p></div>
      <div class="btn-row"><button class="btn btn-outline" id="importBankBtn">Import</button><button class="btn" id="newQBtn">+ New question</button></div></div>
    <div class="toolbar">
      <select id="courseSel">${courses.map(c => `<option value="${c.id}">${escapeHtml(c.code + ' — ' + c.title)}</option>`).join('')}</select>
      <select id="typeSel"><option value="all">All types</option>${TYPES.map(t => `<option value="${t}">${TYPE_LABEL[t]}</option>`).join('')}</select>
      <select id="diffSel"><option value="all">All difficulties</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select>
      <span class="spacer"></span><button class="btn btn-outline btn-sm" id="exportBankBtn">Export bank</button></div>
    <div class="stat-row" id="bankStats"></div>
    <div class="section-title"><h2>Questions</h2></div><section class="card" id="listCard"></section><div id="editorHost"></div>`;

  const courseSel = document.getElementById('courseSel'); courseSel.value = courseId;
  courseSel.addEventListener('change', () => { courseId = courseSel.value; loadBank(); });
  document.getElementById('typeSel').addEventListener('change', e => { filterType = e.target.value; renderList(); });
  document.getElementById('diffSel').addEventListener('change', e => { filterDiff = e.target.value; renderList(); });
  document.getElementById('newQBtn').addEventListener('click', () => openEditor(null));
  document.getElementById('importBankBtn').addEventListener('click', openImport);
  document.getElementById('exportBankBtn').addEventListener('click', exportBank);

  async function loadBank() {
    try { bank = await API.get('/courses/' + courseId + '/questions'); } catch (e) { return toast(e.message, 'error'); }
    renderList();
  }
  function currentList() {
    let l = bank;
    if (filterType !== 'all') l = l.filter(q => q.type === filterType);
    if (filterDiff !== 'all') l = l.filter(q => q.difficulty === filterDiff);
    if (term) l = l.filter(q => (q.text + ' ' + (q.topic || '')).toLowerCase().includes(term));
    return l;
  }
  function renderList() {
    const list = currentList();
    document.getElementById('bankStats').innerHTML = `
      <div class="stat"><div class="stat-value">${bank.length}</div><div class="stat-label">Questions</div></div>
      <div class="stat"><div class="stat-value">${bank.reduce((s, q) => s + q.marks, 0)}</div><div class="stat-label">Total marks available</div></div>
      <div class="stat"><div class="stat-value">${new Set(bank.map(q => q.topic).filter(Boolean)).size}</div><div class="stat-label">Topics</div></div>`;
    const card = document.getElementById('listCard');
    if (bank.length === 0) {
      card.innerHTML = emptyState('This bank is empty', 'Add your first question and it becomes reusable across every exam on this course.', '<button class="btn btn-sm" id="emptyNewBtn">+ New question</button>');
      document.getElementById('emptyNewBtn').addEventListener('click', () => openEditor(null)); return;
    }
    if (list.length === 0) { card.innerHTML = emptyState('No questions match those filters', 'Try widening the type, difficulty or search.'); return; }
    card.innerHTML = list.map(q => `<div class="q-row"><div class="q-body"><div class="q-text">${escapeHtml(q.text)}</div>
      <div class="q-tags">${typeChip(q.type)} ${difficultyChip(q.difficulty)}${q.topic ? `<span class="chip chip-closed">${escapeHtml(q.topic)}</span>` : ''}
      <span class="chip chip-closed">${q.marks} mark${q.marks === 1 ? '' : 's'}</span></div></div>
      <div class="icon-btn-row"><button class="icon-btn" data-edit="${q.id}" title="Edit">${ICONS.pen}</button>
      <button class="icon-btn danger" data-del="${q.id}" title="Delete">${ICONS.trash}</button></div></div>`).join('');
    card.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openEditor(bank.find(q => q.id === b.dataset.edit))));
    card.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this question? If it is already part of a published exam it will be archived (hidden from the bank) and the exam keeps its own copy.')) return;
      try { const r = await API.del('/questions/' + b.dataset.del); toast(r.archived ? 'Question archived (kept for exam records).' : 'Question deleted.', 'success'); loadBank(); }
      catch (e) { toast(e.message, 'error'); }
    }));
  }

  /* ---------------- editor ---------------- */
  const blank = () => ({ type: 'mcq', text: '', topic: '', difficulty: 'medium', marks: 2, grading: 'normalized',
    options: ['a', 'b', 'c', 'd'].map(id => ({ id, text: '' })), correctOptionId: 'a', acceptedAnswers: [] });
  function openEditor(existing) { editing = existing ? JSON.parse(JSON.stringify(existing)) : blank(); editing._id = existing ? existing.id : null; renderEditor(); }
  function closeEditor() { editing = null; document.getElementById('editorHost').innerHTML = ''; }

  function renderEditor() {
    const q = editing, host = document.getElementById('editorHost');
    let specific = '';
    if (q.type === 'mcq') {
      specific = `<div class="field"><label>Options — select the correct one</label>${q.options.map(o => `
        <div class="option-input-row"><input type="radio" name="correct" ${q.correctOptionId === o.id ? 'checked' : ''} data-correct="${o.id}">
        <input type="text" placeholder="Option ${o.id.toUpperCase()}" value="${escapeHtml(o.text)}" data-opt="${o.id}">
        ${q.options.length > 2 ? `<button type="button" class="btn btn-danger btn-sm" data-rmopt="${o.id}">&times;</button>` : ''}</div>`).join('')}
        ${q.options.length < 6 ? '<button type="button" class="btn btn-outline btn-sm" id="addOptBtn">+ Add option</button>' : ''}</div>`;
    } else if (q.type === 'truefalse') {
      specific = `<div class="field"><label>The statement above is:</label><div class="pill-row">
        <button type="button" class="pill ${q.correctOptionId === 'true' ? 'active' : ''}" data-tf="true">True</button>
        <button type="button" class="pill ${q.correctOptionId === 'false' ? 'active' : ''}" data-tf="false">False</button></div></div>`;
    } else if (q.type === 'short') {
      specific = `<div class="field"><label>Accepted answers (one per line)</label>
        <textarea id="acceptedBox" placeholder="Document Object Model">${escapeHtml((q.acceptedAnswers || []).join('\n'))}</textarea></div>
        <div class="field"><label for="qGrading">Matching</label><select id="qGrading">
          <option value="normalized" ${q.grading === 'normalized' ? 'selected' : ''}>Forgiving — ignore case, spacing and punctuation (D.O.M. = DOM)</option>
          <option value="case" ${q.grading === 'case' ? 'selected' : ''}>Ignore case only</option>
          <option value="exact" ${q.grading === 'exact' ? 'selected' : ''}>Exact match</option></select>
          <p class="hint">Add spelling variants and synonyms on their own lines.</p></div>`;
    } else {
      specific = `<p class="hint">Essay answers are marked by hand. Candidates who submit one wait in your Marking queue, and their result stays provisional until you score it. Essays can be used in fixed-set exams (not random draws).</p>`;
    }
    host.innerHTML = `<div class="modal-backdrop" id="backdrop"><div class="modal">
      <div class="card-head"><h2>${q._id ? 'Edit question' : 'New question'}</h2><button class="btn btn-outline btn-sm" id="closeBtn">Close</button></div>
      <div class="field"><label>Question type</label><div class="pill-row">${TYPES.map(t => `<button type="button" class="pill ${q.type === t ? 'active' : ''}" data-type="${t}">${TYPE_LABEL[t]}</button>`).join('')}</div></div>
      <div class="field"><label for="qText">Question text</label><textarea id="qText" placeholder="Type the question exactly as the candidate should see it">${escapeHtml(q.text)}</textarea></div>
      ${specific}
      <div class="field-row">
        <div class="field"><label for="qTopic">Topic</label><input type="text" id="qTopic" value="${escapeHtml(q.topic || '')}" placeholder="e.g. Normalisation"></div>
        <div class="field"><label for="qDiff">Difficulty</label><select id="qDiff">${['easy', 'medium', 'hard'].map(d => `<option value="${d}" ${q.difficulty === d ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
        <div class="field"><label for="qMarks">Marks</label><input type="number" id="qMarks" min="1" value="${q.marks}"></div></div>
      <div id="editorError" class="error-text" style="display:none; margin-bottom:12px;"></div>
      <div class="btn-row"><button class="btn" id="saveQBtn">Save question</button><button class="btn btn-outline" id="cancelQBtn">Cancel</button></div></div></div>`;

    const collect = () => {
      q.text = document.getElementById('qText').value; q.topic = document.getElementById('qTopic').value.trim();
      q.difficulty = document.getElementById('qDiff').value; q.marks = parseInt(document.getElementById('qMarks').value, 10) || 1;
      const acc = document.getElementById('acceptedBox'); if (acc) q.acceptedAnswers = acc.value.split('\n').map(s => s.trim()).filter(Boolean);
      const g = document.getElementById('qGrading'); if (g) q.grading = g.value;
    };
    host.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => {
      collect(); q.type = b.dataset.type;
      if (q.type === 'mcq') {
        if (!q.options || q.options.length < 2) q.options = ['a', 'b', 'c', 'd'].map(id => ({ id, text: '' }));
        if (!q.options.some(o => o.id === q.correctOptionId)) q.correctOptionId = q.options[0].id;
      }
      if (q.type === 'truefalse' && !['true', 'false'].includes(q.correctOptionId)) q.correctOptionId = 'true';
      renderEditor();
    }));
    host.querySelectorAll('[data-opt]').forEach(el => el.addEventListener('input', () => { const o = q.options.find(x => x.id === el.dataset.opt); if (o) o.text = el.value; }));
    host.querySelectorAll('[data-correct]').forEach(el => el.addEventListener('change', () => { if (el.checked) q.correctOptionId = el.dataset.correct; }));
    host.querySelectorAll('[data-rmopt]').forEach(el => el.addEventListener('click', () => {
      collect(); q.options = q.options.filter(o => o.id !== el.dataset.rmopt);
      if (!q.options.some(o => o.id === q.correctOptionId)) q.correctOptionId = q.options[0].id; renderEditor();
    }));
    const addOpt = document.getElementById('addOptBtn');
    if (addOpt) addOpt.addEventListener('click', () => { collect(); const n = 'abcdef'.split('').find(c => !q.options.some(o => o.id === c)); if (n) q.options.push({ id: n, text: '' }); renderEditor(); });
    host.querySelectorAll('[data-tf]').forEach(el => el.addEventListener('click', () => { collect(); q.correctOptionId = el.dataset.tf; renderEditor(); }));
    document.getElementById('closeBtn').addEventListener('click', closeEditor);
    document.getElementById('cancelQBtn').addEventListener('click', closeEditor);
    document.getElementById('backdrop').addEventListener('click', e => { if (e.target.id === 'backdrop') closeEditor(); });
    document.getElementById('saveQBtn').addEventListener('click', async () => {
      collect();
      const err = document.getElementById('editorError'); err.style.display = 'none';
      try {
        const body = { courseId, type: q.type, text: q.text, topic: q.topic, difficulty: q.difficulty, marks: q.marks,
          options: q.options, correctOptionId: q.correctOptionId, acceptedAnswers: q.acceptedAnswers, grading: q.grading };
        if (q._id) await API.put('/questions/' + q._id, body); else await API.post('/questions', body);
        closeEditor(); toast('Question saved.', 'success'); loadBank();
      } catch (e) { err.textContent = e.message; err.style.display = 'block'; }
    });
  }

  function openImport() {
    const c = courses.find(x => x.id === courseId);
    const host = document.getElementById('editorHost');
    host.innerHTML = `<div class="modal-backdrop" id="importBackdrop"><div class="modal">
      <div class="card-head"><h2>Import questions</h2><button class="btn btn-outline btn-sm" id="closeImport">Close</button></div>
      <p class="hint">Import questions directly into <strong>${escapeHtml(c ? c.code + ' — ' + c.title : 'this course')}</strong>. No course number is required.</p>
      <div class="btn-row" style="margin-top:18px;">
        <button class="btn" id="importJsonBtn">Import JSON</button>
        <button class="btn btn-outline" id="importExcelBtn">Import Excel</button>
      </div>
      <input type="file" id="bankFile" hidden>
      <div id="importStatus" class="hint" style="margin-top:14px;"></div>
    </div></div>`;
    const close = () => host.innerHTML = '';
    document.getElementById('closeImport').addEventListener('click', close);
    document.getElementById('importBackdrop').addEventListener('click', e => { if (e.target.id === 'importBackdrop') close(); });
    document.getElementById('importJsonBtn').addEventListener('click', () => choose('json'));
    document.getElementById('importExcelBtn').addEventListener('click', () => choose('xlsx'));
    const input = document.getElementById('bankFile');
    async function choose(kind) {
      input.accept = kind === 'json' ? '.json,application/json' : '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      input.value = ''; input.click();
      input.onchange = async () => {
        const file = input.files && input.files[0]; if (!file) return;
        const status = document.getElementById('importStatus');
        status.textContent = 'Importing…';
        try {
          let result;
          if (kind === 'json') {
            const text = await file.text();
            let payload; try { payload = JSON.parse(text); } catch { throw new Error('Invalid JSON file.'); }
            payload = Array.isArray(payload) ? { questions: payload } : payload;
            payload.courseId = courseId;
            result = await API.post('/courses/' + courseId + '/questions/import', payload);
          } else {
            const fd = new FormData(); fd.append('file', file); fd.append('courseId', courseId);
            result = await API.post('/courses/' + courseId + '/questions/import.xlsx', fd);
          }
          close(); toast(`${result.importedQuestions} question${result.importedQuestions === 1 ? '' : 's'} imported successfully.`, 'success'); loadBank();
        } catch (e) { status.textContent = e.message || 'Import failed.'; toast(e.message || 'Import failed.', 'error'); }
      };
    }
  }

  function exportBank() {
    if (bank.length === 0) return toast('Nothing to export.', 'error');
    const c = courses.find(x => x.id === courseId);
    const rows = [['Type', 'Topic', 'Difficulty', 'Marks', 'Question', 'Answer']];
    bank.forEach(q => {
      let a = '';
      if (q.type === 'mcq') { const o = q.options.find(x => x.id === q.correctOptionId); a = o ? o.text : ''; }
      else if (q.type === 'truefalse') a = q.correctOptionId; else if (q.type === 'short') a = (q.acceptedAnswers || []).join(' / ');
      rows.push([TYPE_LABEL[q.type], q.topic || '', q.difficulty, q.marks, q.text, a]);
    });
    downloadCsv((c ? c.code.replace(/\s+/g, '-') : 'bank') + '-question-bank.csv', rows); toast('Question bank exported.', 'success');
  }
  loadBank();
})();
