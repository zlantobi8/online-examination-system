(async function () {
  const session = await requireRole('student');
  if (!session) return;
  renderShell('student-results.html');
  const content = document.getElementById('content');
  let r;
  try { r = await API.get('/attempts/' + encodeURIComponent(qs('attempt') || '')); }
  catch (e) {
    content.innerHTML = `<section class="card">${emptyState('Result not found', 'This result does not exist or does not belong to your account.',
      '<a class="btn btn-sm" href="student-results.html">Back to my results</a>')}</section>`;
    return;
  }
  if (r.inProgress) { window.location.href = 'exam.html?exam=' + r.examId; return; }

  const head = `
    <a href="student-results.html" class="hint">&larr; Back to my results</a>
    <h1 style="margin-top:10px;">${escapeHtml(r.exam.title)}</h1>
    <p style="color:var(--text-mute); margin-top:-8px;">${escapeHtml(r.course.code + ' — ' + r.course.title)} · Submitted ${formatDate(r.submittedAt)}</p>
    ${r.autoSubmitReason ? `<div class="card" style="border-left:4px solid var(--danger); margin-bottom:18px;"><strong>This paper was submitted automatically.</strong> ${escapeHtml(r.autoSubmitReason)}</div>` : ''}`;

  if (!r.released) {
    content.innerHTML = head + `<section class="card">${emptyState('Submitted — result not released yet',
      'Your paper has been received and scored. Your lecturer releases results once marking and moderation are complete.')}</section>`;
    return;
  }

  const items = r.review.map((q, i) => {
    let block;
    if (q.type === 'essay') {
      block = `<div class="answer-quote">${q.given ? escapeHtml(q.given) : '(not answered)'}</div>` +
        (r.canReview ? `<div class="review-opt ${q.earned === q.marks ? 'correct' : ''}">${q.earned === null ? 'Awaiting your lecturer\u2019s marking' : 'Awarded ' + q.earned + ' of ' + q.marks + ' marks'}</div>` : '');
    } else if (!r.canReview) {
      block = `<div class="review-opt">Your answer: ${q.given ? escapeHtml(q.given) : '(not answered)'}</div>`;
    } else if (q.type === 'short') {
      block = `<div class="review-opt ${q.earned ? 'correct' : 'wrong'}">Your answer: ${q.given ? escapeHtml(q.given) : '(not answered)'}</div>` +
        (q.earned ? '' : `<div class="review-opt correct">Accepted: ${escapeHtml((q.accepted || []).join(' / '))}</div>`);
    } else {
      block = `<div class="review-opt ${q.earned ? 'correct' : 'wrong'}">Your answer: ${q.given ? escapeHtml(q.given) : '(not answered)'}</div>` +
        (q.earned ? '' : `<div class="review-opt correct">Correct answer: ${q.correctText ? escapeHtml(q.correctText) : '—'}</div>`);
    }
    return `<div class="review-row"><p class="hint mono" style="margin-bottom:2px;">QUESTION ${i + 1} · ${q.marks} MARK${q.marks === 1 ? '' : 'S'} · ${TYPE_LABEL[q.type]}</p>
      <p style="margin-bottom:6px; font-weight:500;">${escapeHtml(q.text)}</p>${block}</div>`;
  }).join('');

  content.innerHTML = head + `
    ${r.awaiting ? `<div class="card" style="border-left:4px solid var(--gold); margin-bottom:18px;"><strong>Provisional result.</strong> An essay question is still being marked, so your final score may be higher.</div>` : ''}
    ${r.penalty > 0 ? `<div class="card" style="border-left:4px solid var(--danger); margin-bottom:18px;"><strong>A mark penalty was applied</strong> under this exam\u2019s published policy: raw score ${r.rawScore}/${r.totalMarks}, ${r.penalty} deducted, final ${r.score}/${r.totalMarks}. Speak to your lecturer if you believe this is wrong.</div>` : ''}
    <div class="stat-row">
      <div class="stat"><div class="stat-value">${r.score}/${r.totalMarks}</div><div class="stat-label">${r.awaiting ? 'Provisional score' : 'Score'}</div></div>
      <div class="stat"><div class="stat-value">${r.percent}%</div><div class="stat-label">Percentage</div></div>
      <div class="stat"><div class="stat-value">${r.review.length}</div><div class="stat-label">Questions</div></div>
      <div class="stat"><div class="stat-value">${r.awaiting ? '—' : (r.percent >= 50 ? 'Pass' : 'Fail')}</div><div class="stat-label">Outcome (50% mark)</div></div>
    </div>
    <div class="section-title"><h2>Answer review</h2></div>
    ${r.reviewNote ? `<p class="hint" style="margin-bottom:10px;">${escapeHtml(r.reviewNote)}</p>` : ''}
    <section class="card">${items}</section>`;
})();
