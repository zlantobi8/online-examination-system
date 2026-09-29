(async function () {
  const session = await requireRole('lecturer');
  if (!session) return;
  let term = '';
  renderShell('lecturer-exams.html', { searchPlaceholder: 'Search exams…', onSearch: t => { term = t; render(); } });
  const content = document.getElementById('content');
  let courses, exams;
  async function load() {
    try { [courses, exams] = await Promise.all([API.get('/courses'), API.get('/exams')]); } catch (e) { return showError(e); }
    render();
  }
  const codeOf = id => (courses.find(c => c.id === id) || {}).code || '—';

  function render() {
    if (courses.length === 0) {
      content.innerHTML = `<div class="page-head"><div><h1>Exams</h1></div></div><section class="card">${emptyState('You are not offering any course yet',
        'Your administrator assigns lecturers to courses. Once assigned, you can set exams.')}</section>`; return;
    }
    const list = term ? exams.filter(e => (e.title + ' ' + codeOf(e.courseId)).toLowerCase().includes(term)) : exams;
    content.innerHTML = `
      <div class="page-head"><div><h1>Exams</h1><p>Draft a paper, publish it (this freezes it), close it when done, then release results.</p></div>
        <div class="btn-row"><button class="btn btn-outline" id="importJsonBtn">Import JSON</button><button class="btn btn-outline" id="importExcelBtn">Import Excel</button><button class="btn btn-outline" id="templateExcelBtn">Excel Template</button><button class="btn" id="newExamBtn">+ Set new exam</button><input type="file" id="importJsonFile" accept="application/json,.json" hidden><input type="file" id="importExcelFile" accept="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx" hidden></div></div><section class="card" id="listCard"></section>`;
    document.getElementById('newExamBtn').addEventListener('click', async () => {
      try {
        const e = await API.post('/exams', { courseId: courses[0].id, title: 'Untitled exam', durationMinutes: 30, shuffleQuestions: true, shuffleOptions: true, maxViolations: 3 });
        window.location.href = 'lecturer-exam-edit.html?exam=' + e.id;
      } catch (err) { toast(err.message, 'error'); }
    });
    const importJsonBtn = document.getElementById('importJsonBtn');
    const importJsonFile = document.getElementById('importJsonFile');
    const importExcelBtn = document.getElementById('importExcelBtn');
    const importExcelFile = document.getElementById('importExcelFile');
    const chooseCourse = () => {
      let target = courses[0];
      if (courses.length > 1) {
        const choices = courses.map((c, i) => `${i + 1}. ${c.code} — ${c.title}`).join('\n');
        const answer = prompt('Import this exam into which course?\n\n' + choices + '\n\nEnter the course number:');
        if (answer === null) return null;
        const index = parseInt(answer, 10) - 1;
        if (!(index >= 0 && index < courses.length)) throw new Error('Invalid course selection.');
        target = courses[index];
      }
      return target;
    };

    function closeImportPreview() {
      document.getElementById('importPreviewBackdrop')?.remove();
    }

    function showImportPreview(preview, onConfirm) {
      const questions = Array.isArray(preview.questions) ? preview.questions : [];
      const title = escapeHtml(preview.exam?.title || 'Imported exam');
      const course = escapeHtml(preview.course ? `${preview.course.code} — ${preview.course.title}` : 'Selected course');
      const list = questions.slice(0, 30).map(q => `<div class="import-preview-q"><span class="import-preview-num">${q.number}</span><div><div>${escapeHtml(q.text)}</div><small>${escapeHtml(q.type)} · ${q.marks} mark${q.marks === 1 ? '' : 's'}${q.topic ? ' · ' + escapeHtml(q.topic) : ''}</small></div></div>`).join('');
      const more = questions.length > 30 ? `<p class="muted">Showing the first 30 of ${questions.length} questions.</p>` : '';
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop'; backdrop.id = 'importPreviewBackdrop';
      backdrop.innerHTML = `<div class="modal import-preview-modal">
        <div class="page-head" style="margin-bottom:12px"><div><h2>Review imported exam</h2><p>Nothing has been saved yet. Check the details before importing.</p></div></div>
        <div class="import-preview-summary"><div><strong>${title}</strong><span>${course}</span></div><div><strong>${preview.questionCount}</strong><span>Questions</span></div><div><strong>${preview.totalMarks}</strong><span>Total marks</span></div><div><strong>${preview.exam?.durationMinutes || 30}</strong><span>Minutes</span></div></div>
        <div class="import-preview-list">${list || '<p class="muted">No questions.</p>'}</div>${more}
        <div class="btn-row" style="justify-content:flex-end;margin-top:16px"><button class="btn btn-outline" id="cancelImportPreview">Cancel Import</button><button class="btn" id="confirmImportPreview">Import Exam</button></div>
      </div>`;
      document.body.appendChild(backdrop);
      backdrop.querySelector('#cancelImportPreview').addEventListener('click', closeImportPreview);
      backdrop.querySelector('#confirmImportPreview').addEventListener('click', async () => {
        const btn = backdrop.querySelector('#confirmImportPreview');
        btn.disabled = true;
        try { await onConfirm(); closeImportPreview(); }
        catch (err) { toast(err.message || 'Could not import this exam.', 'error'); btn.disabled = false; }
      });
      backdrop.addEventListener('click', e => { if (e.target === backdrop) closeImportPreview(); });
    }

    importJsonBtn.addEventListener('click', () => importJsonFile.click());
    importJsonFile.addEventListener('change', async () => {
      const file = importJsonFile.files && importJsonFile.files[0]; if (!file) return;
      try {
        const pkg = JSON.parse(await file.text());
        const target = chooseCourse(); if (!target) return;
        pkg.courseId = target.id;
        const preview = await API.post('/exams/import/preview', pkg);
        showImportPreview(preview, async () => {
          const result = await API.post('/exams/import', pkg);
          toast(`Exam imported with ${result.importedQuestions} question${result.importedQuestions === 1 ? '' : 's'}.`, 'success');
          window.location.href = 'lecturer-exam-edit.html?exam=' + result.id;
        });
      } catch (err) { toast(err.message || 'Could not read this JSON exam.', 'error'); }
      finally { importJsonFile.value = ''; }
    });
    importExcelBtn.addEventListener('click', () => importExcelFile.click());
    document.getElementById('templateExcelBtn').addEventListener('click', () => { const a = document.createElement('a'); a.href = '/api/exams/excel-template'; a.download = 'exam-import-template.xlsx'; document.body.appendChild(a); a.click(); a.remove(); });
    importExcelFile.addEventListener('change', async () => {
      const file = importExcelFile.files && importExcelFile.files[0]; if (!file) return;
      try {
        const target = chooseCourse(); if (!target) return;
        const previewForm = new FormData(); previewForm.append('file', file); previewForm.append('courseId', target.id);
        const preview = await API.upload('/exams/import.xlsx/preview', previewForm);
        showImportPreview(preview, async () => {
          const form = new FormData(); form.append('file', file); form.append('courseId', target.id);
          const result = await API.upload('/exams/import.xlsx', form);
          toast(`Exam imported with ${result.importedQuestions} question${result.importedQuestions === 1 ? '' : 's'}.`, 'success');
          window.location.href = 'lecturer-exam-edit.html?exam=' + result.id;
        });
      } catch (err) { toast(err.message || 'Could not read this Excel exam.', 'error'); }
      finally { importExcelFile.value = ''; }
    });
    const card = document.getElementById('listCard');
    if (exams.length === 0) { card.innerHTML = emptyState('No exams set yet', 'Bank some questions first, then draw an exam from them.', '<a class="btn btn-sm" href="lecturer-bank.html">Go to question bank</a>'); return; }
    if (list.length === 0) { card.innerHTML = emptyState('No exams match "' + term + '"', 'Try a different title or course code.'); return; }

    card.innerHTML = list.map(e => {
      const sched = (e.opensAt || e.closesAt) ? `${formatDateShort(e.opensAt)} → ${formatDateShort(e.closesAt)}` : 'No time window set';
      const draft = e.status === 'draft', pub = e.status === 'published';
      return `<div class="exam-row"><div>
        <div class="exam-row-title">${escapeHtml(e.title)} ${examStateChip(e)} ${e.frozen ? '<span class="chip chip-type">Frozen</span>' : ''} ${e.resultsReleased ? '<span class="chip chip-open">Results released</span>' : ''}</div>
        <div class="exam-meta">${escapeHtml(codeOf(e.courseId))} · ${e.durationMinutes} min · ${e.questionCount == null ? 'random draw' : e.questionCount + ' question' + (e.questionCount === 1 ? '' : 's')}
          · ${e.selectionMode === 'random' ? 'random draw' : 'fixed set'} · ${sched} · ${e.summary.submitted} submitted</div></div>
        <div class="btn-row">
          <a class="btn btn-outline btn-sm" href="lecturer-results.html?exam=${e.id}">Results</a>
          ${draft ? `<a class="btn btn-outline btn-sm" href="lecturer-exam-edit.html?exam=${e.id}">Edit</a><button class="btn btn-sm" data-act="publish" data-id="${e.id}">Publish</button>` : ''}
          ${pub && e.attemptCount === 0 ? `<button class="btn btn-outline btn-sm" data-act="unpublish" data-id="${e.id}">Unpublish</button>` : ''}
          ${pub ? `<button class="btn btn-sm" data-act="close" data-id="${e.id}">Close exam</button>` : ''}
          ${e.status === 'closed' ? `<button class="btn btn-outline btn-sm" data-act="archive" data-id="${e.id}">Archive</button>` : ''}
          <button class="btn btn-outline btn-sm" data-act="duplicate" data-id="${e.id}">Duplicate</button>
          <button class="btn btn-outline btn-sm" data-act="export-excel" data-id="${e.id}">Excel</button><button class="btn btn-outline btn-sm" data-act="export-json" data-id="${e.id}">JSON</button>
          ${draft && e.attemptCount === 0 ? `<button class="btn btn-danger btn-sm" data-act="delete" data-id="${e.id}">Delete</button>` : ''}
        </div></div>`;
    }).join('');

    const CONFIRM = {
      publish: 'Publish this exam? Its questions and settings will be frozen and the candidate list fixed.',
      close: 'Close this exam? No new candidates can start it. Papers already in progress keep their own deadline.',
      archive: 'Archive this exam? Results are kept.', delete: 'Delete this draft?'
    };
    const OK = { publish: 'Exam published.', unpublish: 'Exam unpublished.', close: 'Exam closed.', archive: 'Exam archived.', delete: 'Draft deleted.', duplicate: 'Duplicated as a draft.' };
    card.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', async () => {
      const { act, id } = b.dataset;
      if (CONFIRM[act] && !confirm(CONFIRM[act])) return;
      b.disabled = true;
      try {
        if (act === 'export-json' || act === 'export-excel') {
          const ext = act === 'export-excel' ? 'xlsx' : 'json';
          if (ext === 'xlsx') {
            const a = document.createElement('a'); a.href = '/api/exams/' + id + '/export.xlsx'; a.download = ''; document.body.appendChild(a); a.click(); a.remove();
          } else {
            const pkg = await API.get('/exams/' + id + '/export');
            const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob); const a = document.createElement('a');
            a.href = url; a.download = (pkg.exam.title || 'exam').replace(/[^a-z0-9_-]+/gi, '-').replace(/-+/g, '-') + '-exam.json';
            document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          }
          toast(`Exam exported as ${ext.toUpperCase()}.`, 'success'); return;
        }
        if (act === 'delete') await API.del('/exams/' + id); else await API.post(`/exams/${id}/${act}`);
        toast(OK[act], 'success');
      } catch (e) { toast(e.message, 'error'); }
      load();
    }));
  }
  load();
})();
