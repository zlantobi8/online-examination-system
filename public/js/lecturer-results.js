(async function () {
  const session = await requireRole('lecturer');
  if (!session) return;
  renderShell('lecturer-exams.html');
  const content = document.getElementById('content');
  let r;
  async function load() {
    try { r = await API.get('/exams/' + encodeURIComponent(qs('exam') || '') + '/results'); }
    catch (e) { content.innerHTML = `<section class="card">${emptyState('Exam not found', e.message, '<a class="btn btn-sm" href="lecturer-exams.html">Back to exams</a>')}</section>`; return; }
    render();
  }
  function render() {
    const { exam, course, summary: sum, attempts, absent, stats, inProgress, candidateCount } = r;
    const rows = attempts.length === 0 ? '<tr><td colspan="8" style="color:var(--text-mute);">No submissions yet.</td></tr>'
      : attempts.map((a, i) => {
        const flagTitle = a.integrityTotal === 0 ? '' : Object.entries(a.integrityCounts).map(([t, n]) => `${n}× ${t.replace(/_/g, ' ')}`).join(', ');
        return `<tr><td class="mono">${i + 1}</td><td>${a.student ? escapeHtml(a.student.name) : 'Unknown'}</td><td class="mono">${a.student && a.student.matric ? escapeHtml(a.student.matric) : '—'}</td>
          <td class="mono">${a.score}/${a.totalMarks}${a.penalty ? ` <span class="hint" style="text-decoration:line-through;">${a.rawScore}</span>` : ''}</td><td class="mono">${a.percent}%</td>
          <td>${a.status === 'awaiting-marking' ? '<span class="chip chip-awaiting">Awaiting marking</span>' : `<span class="chip ${a.percent >= 50 ? 'chip-open' : 'chip-closed'}">${a.percent >= 50 ? 'Pass' : 'Fail'}</span>`}</td>
          <td>${a.integrityTotal === 0 ? '<span class="hint">—</span>' : `<span class="chip ${a.integrityMajor > 0 ? 'chip-danger' : 'chip-awaiting'}" title="${escapeHtml(flagTitle)}">${a.autoSubmitReason ? 'Auto-submitted · ' : ''}${a.integrityTotal} event${a.integrityTotal === 1 ? '' : 's'}${a.rawPenalty ? (a.penaltyWaived ? ' · penalty waived' : ' · −' + a.rawPenalty) : ''}</span>`}</td>
          <td>${a.rawPenalty ? `<button class="link-btn" data-waive="${a.id}" data-on="${a.penaltyWaived ? '0' : '1'}">${a.penaltyWaived ? 'Reinstate penalty' : 'Waive penalty'}</button>` : ''}</td></tr>`;
      }).join('');
    const statRows = stats.length === 0 ? '<tr><td colspan="4" style="color:var(--text-mute);">No data yet — analytics appear once scripts come in.</td></tr>'
      : stats.slice().sort((a, b) => a.correctRate - b.correctRate).map(s => {
        const cls = s.correctRate >= 70 ? '' : (s.correctRate >= 40 ? 'mid' : 'low');
        return `<tr><td style="max-width:420px;">${escapeHtml(s.question.text)}<div class="q-tags" style="margin-top:4px;">${typeChip(s.question.type)} ${difficultyChip(s.question.difficulty)}</div></td>
          <td class="mono">${s.seen}</td><td class="mono">${s.correctRate}%</td><td style="min-width:110px;"><div class="bar-track"><div class="bar-fill ${cls}" style="width:${s.correctRate}%"></div></div></td></tr>`;
      }).join('');

    content.innerHTML = `
      <a href="lecturer-exams.html" class="hint">&larr; Back to exams</a>
      <div class="page-head" style="margin-top:10px;"><div><h1>${escapeHtml(exam.title)}</h1>
        <p>${escapeHtml(course.code + ' — ' + course.title)} · ${exam.durationMinutes} min · ${examStateChip(exam)} ${exam.resultsReleased ? '<span class="chip chip-open">Results available automatically</span>' : '<span class="chip chip-scheduled">Awaiting marking</span>'}</p></div>
        <div class="btn-row">
          ${sum.awaitingMarking ? `<a class="btn btn-gold btn-sm" href="lecturer-marking.html?exam=${exam.id}">Mark ${sum.awaitingMarking} script${sum.awaitingMarking === 1 ? '' : 's'}</a>` : ''}
          ${exam.status === 'published' ? '<button class="btn btn-outline btn-sm" id="closeBtn">Close exam</button>' : ''}
          <button class="btn btn-outline btn-sm" id="exportBtn">Export broadsheet</button></div></div>
      ${!exam.resultsReleased && attempts.length ? '<p class="hint">Results are released automatically after objective grading, or automatically after all essay answers are marked.</p>' : ''}
      <div class="stat-row">
        <div class="stat"><div class="stat-value">${sum.submitted}/${candidateCount}</div><div class="stat-label">Submitted / candidates</div></div>
        <div class="stat"><div class="stat-value">${sum.average}%</div><div class="stat-label">Class average</div></div>
        <div class="stat"><div class="stat-value">${sum.highest}% / ${sum.lowest}%</div><div class="stat-label">Highest / lowest</div></div>
        <div class="stat"><div class="stat-value">${sum.passRate}%</div><div class="stat-label">Pass rate</div></div></div>
      ${inProgress ? `<p class="hint" style="margin-top:12px;">${inProgress} candidate${inProgress === 1 ? ' is' : 's are'} still writing.</p>` : ''}
      <div class="section-title"><h2>Broadsheet</h2></div>
      <section class="card"><table class="ledger"><thead><tr><th>#</th><th>Student</th><th>Matric no.</th><th>Score</th><th>%</th><th>Outcome</th><th>Security</th><th></th></tr></thead><tbody>${rows}</tbody></table></section>
      <div class="section-title"><h2>Question analysis</h2></div>
      <section class="card"><p class="hint" style="margin-bottom:12px;">Hardest first. Based on the frozen paper each candidate actually sat.</p>
        <table class="ledger"><thead><tr><th>Question</th><th>Seen</th><th>Correct</th><th></th></tr></thead><tbody>${statRows}</tbody></table></section>
      ${absent.length ? `<div class="section-title"><h2>Did not sit (${absent.length})</h2></div><section class="card"><table class="ledger">
        <thead><tr><th>Student</th><th>Matric no.</th></tr></thead><tbody>${absent.map(s => `<tr><td>${escapeHtml(s.name)}</td><td class="mono">${escapeHtml(s.matric || '—')}</td></tr>`).join('')}</tbody></table>
        <p class="hint" style="margin-top:10px;">Taken from the candidate list frozen when the exam was published, not from today's registrations.</p></section>` : ''}`;

    const act = async (id, fn, msg) => { const b = document.getElementById(id); if (b) b.addEventListener('click', async () => { try { await fn(); toast(msg, 'success'); } catch (e) { toast(e.message, 'error'); } load(); }); };
    const cb = document.getElementById('closeBtn');
    if (cb) cb.addEventListener('click', async () => { if (!confirm('Close this exam? No one else can start it.')) return; try { await API.post(`/exams/${exam.id}/close`); toast('Exam closed.', 'success'); } catch (e) { toast(e.message, 'error'); } load(); });
    content.querySelectorAll('[data-waive]').forEach(b => b.addEventListener('click', async () => {
      const waive = b.dataset.on === '1';
      const reason = waive ? prompt('Reason for waiving this penalty (kept in the audit log):', '') : '';
      if (waive && reason === null) return;
      try { await API.post(`/attempts/${b.dataset.waive}/waive-penalty`, { waive, reason }); toast(waive ? 'Penalty waived.' : 'Penalty reinstated.', 'success'); } catch (e) { toast(e.message, 'error'); }
      load();
    }));
    document.getElementById('exportBtn').addEventListener('click', () => {
      const out = [[course.code, exam.title], ['Generated', formatDate(new Date().toISOString())], [],
        ['S/N', 'Student', 'Matric No.', 'Raw score', 'Penalty applied', 'Final score', 'Total', 'Percent', 'Outcome', 'Submitted', 'Security events', 'Auto-submitted']];
      attempts.forEach((a, i) => out.push([i + 1, a.student ? a.student.name : 'Unknown', a.student ? a.student.matric || '' : '', a.rawScore, a.penalty, a.score, a.totalMarks, a.percent + '%',
        a.status === 'awaiting-marking' ? 'Pending' : (a.percent >= 50 ? 'Pass' : 'Fail'), formatDate(a.submittedAt), a.integrityTotal, a.autoSubmitReason ? 'Yes' : 'No']));
      absent.forEach((s, i) => out.push([attempts.length + i + 1, s.name, s.matric || '', '', '', '', '', '', 'Absent', '', '', '']));
      downloadCsv(course.code.replace(/\s+/g, '-') + '-broadsheet.csv', out); toast('Broadsheet exported.', 'success');
    });
  }
  load();
})();
