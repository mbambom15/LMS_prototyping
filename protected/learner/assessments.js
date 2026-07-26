/* ══════════════════════════════════════════════════════════
   assessments.js — learner-facing quizzes + project submissions
   Mounts into #assessments-units on /learner/assessments.html.
   Loaded by assessments-page.js's DOMContentLoaded handler, which calls
   LearnerAssessments.init(container) once the DOM is ready.
══════════════════════════════════════════════════════════ */
const LearnerAssessments = (() => {
  let unitsData = [];
  let gradeData = null;

  // Live quiz-taking state, reset per attempt
  const quizState = {
    quizId: null, attemptId: null, questions: [], answers: {}, index: 0,
    expiresAt: null, timerHandle: null, submitting: false,
  };

  function escHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmtSize(bytes) {
    if (!bytes) return '';
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
  }

  function fmtMinutes(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  async function init(container) {
    if (!document.getElementById('quiz-modal-mount')) {
      const mount = document.createElement('div');
      mount.id = 'quiz-modal-mount';
      document.body.appendChild(mount);
    }
    await load(container);
  }

  async function load(container) {
    container.innerHTML = `<div class="panel" style="padding:16px;font-size:13px;color:var(--text-secondary)">Loading assessments…</div>`;
    try {
      const res = await fetch('/api/learner/assessments');
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      unitsData = data.units;
      gradeData = data.grade;
      render(container);
    } catch (err) {
      container.innerHTML = `<div class="panel" style="padding:16px;color:var(--text-danger);font-size:13px">Could not load assessments: ${escHtml(err.message)}</div>`;
    }
  }

  function render(container) {
    const gradeBar = renderGradeSummary();
    const units = unitsData.map(renderUnitAssessments).join('');
    container.innerHTML = gradeBar + (units || `<div class="panel" style="padding:16px;font-size:13px;color:var(--text-tertiary)">No assessments have been published yet.</div>`);

    unitsData.forEach(u => {
      u.quizzes.forEach(q => {
        const btn = container.querySelector(`[data-quiz-action="${q.id}"]`);
        if (btn && !btn.disabled) btn.onclick = () => handleQuizAction(q);
        const reviewBtn = container.querySelector(`[data-quiz-review="${q.id}"]`);
        if (reviewBtn) reviewBtn.onclick = () => reviewBestAttempt(q);
      });
      u.projects.forEach(p => {
        wireProjectCard(container, p);
      });
    });
  }

  function fmtPct(n) {
    return Number(n).toFixed(2).replace('.', ',');
  }

  function renderGradeSummary() {
    if (!gradeData) return '';
    const q = gradeData.quiz_pct != null ? `${fmtPct(gradeData.quiz_pct)}%` : '—';
    const p = gradeData.project_pct != null ? `${fmtPct(gradeData.project_pct)}%` : '—';
    return `
      <div class="panel" style="padding:14px 18px;margin-bottom:14px;display:flex;gap:24px;align-items:center;flex-wrap:wrap">
        <div><div class="sc-label">Overall grade</div><div class="sc-val">${fmtPct(gradeData.overall_pct)}%</div></div>
        <div><div class="sc-label">Quizzes (40%)</div><div class="sc-val" style="font-size:16px">${q}</div></div>
        <div><div class="sc-label">Projects (60%)</div><div class="sc-val" style="font-size:16px">${p}</div></div>
      </div>`;
  }

  function renderUnitAssessments(unit) {
    if (!unit.quizzes.length && !unit.projects.length) return '';
    return `
      <div class="unit-acc panel">
        <div class="unit-acc-head" onclick="this.parentElement.classList.toggle('closed')">
          <span class="unit-acc-caret">▾</span>
          <div class="unit-acc-titles">
            <div class="unit-acc-tag">Unit ${unit.unit_number}</div>
            <div class="unit-acc-title">${escHtml(unit.title)}</div>
          </div>
        </div>
        <div class="unit-acc-body">
          ${unit.quizzes.map(renderQuizCard).join('')}
          ${unit.projects.map(renderProjectCard).join('')}
        </div>
      </div>`;
  }

  function renderQuizCard(q) {
    const badges = q.attempts.map(a => {
      const cls = a.status === 'in_progress' ? 'as-status-progress'
        : (a.score_pct >= q.pass_mark_pct ? 'as-status-pass' : 'as-status-fail');
      const label = a.status === 'in_progress' ? `Attempt ${a.attempt_number}: in progress` : `Attempt ${a.attempt_number}: ${fmtPct(a.score_pct)}%`;
      return `<span class="quiz-attempt-badge ${cls}">${label}</span>`;
    }).join(' ');

    let actionLabel, actionDisabled = false;
    if (q.in_progress_attempt) {
      actionLabel = 'Continue quiz';
    } else if (q.can_start_new) {
      actionLabel = q.attempts_used === 0 ? 'Start quiz' : `Start attempt ${q.attempts_used + 1} of ${q.max_attempts}`;
    } else {
      actionLabel = 'No attempts remaining';
      actionDisabled = true;
    }

    return `
      <div class="as-card">
        <div class="as-card-main">
          <div class="as-card-kind">Quiz</div>
          <div class="as-card-title">${escHtml(q.title)}</div>
          <div class="as-card-meta">${q.question_count} questions · ${q.total_marks} marks${q.time_limit_minutes ? ` · ${q.time_limit_minutes} min` : ''} · pass mark ${q.pass_mark_pct}% · ${q.max_attempts} attempt${q.max_attempts === 1 ? '' : 's'} allowed</div>
          ${badges ? `<div class="quiz-attempt-badges">${badges}</div>` : ''}
        </div>
        <div class="as-card-actions">
          <button class="btn btn-xs btn-blue" data-quiz-action="${q.id}" ${actionDisabled ? 'disabled' : ''}>${actionLabel}</button>
          ${(!q.in_progress_attempt && q.best_score_pct != null) ? `<button class="btn btn-xs" data-quiz-review="${q.id}">Review best</button>` : ''}
        </div>
      </div>`;
  }

  function renderProjectCard(p) {
    const sub = p.submission;
    return `
      <div class="as-card" data-project-card="${p.id}">
        <div class="as-card-main">
          <div class="as-card-kind">Project</div>
          <div class="as-card-title">${escHtml(p.title)}</div>
          ${p.description ? `<div class="as-card-desc">${escHtml(p.description)}</div>` : ''}
          <div class="as-card-meta">
            ${p.total_marks} marks · ${p.duration_days} day${p.duration_days === 1 ? '' : 's'} to submit
            ${p.has_brief ? ` · <a href="#" data-brief-link="${p.id}">Download brief</a>` : ''}
          </div>
          ${sub && sub.deadline_at ? `<div class="as-card-deadline" data-deadline="${sub.deadline_at}">Loading deadline…</div>` : ''}
          <div class="pj-upload-area" id="pj-upload-${p.id}"></div>
        </div>
      </div>`;
  }

  function wireProjectCard(container, p) {
    const briefLink = container.querySelector(`[data-brief-link="${p.id}"]`);
    if (briefLink) briefLink.onclick = async (e) => {
      e.preventDefault();
      const res = await fetch(`/api/learner/projects/${p.id}/brief`);
      const data = await res.json();
      if (data.success) window.open(data.url, '_blank', 'noopener');
    };

    const deadlineEl = container.querySelector(`[data-project-card="${p.id}"] [data-deadline]`);
    if (deadlineEl) startDeadlineClock(deadlineEl);

    renderProjectUploadArea(container, p);
  }

  function startDeadlineClock(el) {
    const deadline = new Date(el.dataset.deadline);
    const tick = () => {
      const diffMs = deadline - new Date();
      if (diffMs <= 0) { el.textContent = 'Deadline passed'; el.style.color = '#b91c1c'; clearInterval(handle); return; }
      const days = Math.floor(diffMs / 86400000);
      const hours = Math.floor((diffMs % 86400000) / 3600000);
      el.textContent = days > 0 ? `Due in ${days}d ${hours}h` : `Due in ${hours}h ${Math.floor((diffMs % 3600000) / 60000)}m`;
    };
    tick();
    const handle = setInterval(tick, 60000);
  }

  function renderProjectUploadArea(container, p) {
    const area = container.querySelector(`#pj-upload-${p.id}`);
    if (!area) return;
    const sub = p.submission;

    if (sub && sub.status === 'submitted') {
      area.innerHTML = `
        <div class="pj-locked">
          <span class="pj-check">✓</span> Submitted — ${escHtml(sub.file_name)} (${fmtSize(sub.file_size_bytes)})
          ${sub.score != null ? `<div class="as-card-status as-status-pass" style="margin-top:4px">Graded: ${sub.score}/${p.total_marks}</div>` : `<div class="as-card-status" style="margin-top:4px">Awaiting facilitator grading</div>`}
        </div>`;
      return;
    }

    if (sub && sub.file_name) {
      area.innerHTML = `
        <div class="pj-staged">
          <span>${escHtml(sub.file_name)} (${fmtSize(sub.file_size_bytes)})</span>
          <button class="btn btn-xs" data-pj-remove="${p.id}">Remove</button>
          <button class="btn btn-xs btn-blue" data-pj-submit="${p.id}">Submit project</button>
        </div>`;
      area.querySelector(`[data-pj-remove="${p.id}"]`).onclick = () => removeProjectFile(container, p);
      area.querySelector(`[data-pj-submit="${p.id}"]`).onclick = () => submitProject(container, p);
      return;
    }

    area.innerHTML = `
      <label class="btn btn-xs pj-upload-btn">
        Upload PDF or ZIP
        <input type="file" accept=".pdf,.zip" style="display:none" id="pj-file-${p.id}">
      </label>
      <span class="pj-upload-hint" id="pj-upload-hint-${p.id}"></span>`;
    area.querySelector(`#pj-file-${p.id}`).onchange = (e) => {
      if (e.target.files.length) uploadProjectFile(container, p, e.target.files[0]);
    };
  }

  async function uploadProjectFile(container, p, file) {
    const hint = container.querySelector(`#pj-upload-hint-${p.id}`);
    if (hint) hint.textContent = 'Uploading…';
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`/api/learner/projects/${p.id}/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      p.submission = { ...(p.submission || {}), file_name: data.submission.file_name, file_size_bytes: data.submission.file_size_bytes, status: 'draft', started_at: data.submission.started_at, deadline_at: p.submission?.deadline_at || new Date(new Date(data.submission.started_at).getTime() + p.duration_days * 86400000) };
      renderProjectUploadArea(container, p);
    } catch (err) {
      if (hint) hint.textContent = 'Upload failed: ' + err.message;
    }
  }

  async function removeProjectFile(container, p) {
    if (!confirm('Remove this file? You can upload a different one before submitting.')) return;
    try {
      const res = await fetch(`/api/learner/projects/${p.id}/upload`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      p.submission.file_name = null;
      p.submission.file_size_bytes = null;
      renderProjectUploadArea(container, p);
    } catch (err) {
      alert('Could not remove file: ' + err.message);
    }
  }

  async function submitProject(container, p) {
    if (!confirm('Submit this project? You will not be able to change your submission afterwards.')) return;
    try {
      const res = await fetch(`/api/learner/projects/${p.id}/submit`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      p.submission.status = 'submitted';
      p.submission.submitted_at = data.submission.submitted_at;
      renderProjectUploadArea(container, p);
    } catch (err) {
      alert('Could not submit: ' + err.message);
    }
  }

  // ══════════════════════ QUIZ TAKING MODAL ══════════════════════

  async function handleQuizAction(q) {
    try {
      const res = await fetch(`/api/learner/quizzes/${q.id}/start`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);

      quizState.quizId = q.id;
      quizState.attemptId = data.attempt.id;
      quizState.questions = data.questions;
      quizState.answers = {};
      data.answers.forEach(a => { quizState.answers[a.question_id] = a.selected_choice; });
      quizState.index = data.answers.length; // resume at the first unanswered question
      if (quizState.index >= quizState.questions.length) quizState.index = quizState.questions.length - 1;
      quizState.expiresAt = data.attempt.expires_at;
      quizState.quizMeta = data.quiz;

      openQuizModal();
    } catch (err) {
      alert('Could not open quiz: ' + err.message);
    }
  }

  // Shows a finished attempt's result without spending/touching an
  // attempt slot — pulled entirely from data already in hand from the
  // assessments list, no /start call involved.
  function reviewBestAttempt(q) {
    const best = q.attempts.reduce((b, a) => (!b || Number(a.score_pct) > Number(b.score_pct)) ? a : b, null);
    if (!best) return;
    quizState.quizMeta = { title: q.title, description: q.description, pass_mark_pct: q.pass_mark_pct };
    quizState.expiresAt = null;
    openQuizModal(true);
    renderQuizResult(
      { score: best.score, total_marks: q.total_marks, score_pct: best.score_pct },
      false,
      { attempts_used: q.attempts_used, max_attempts: q.max_attempts, attempts_remaining: Math.max(0, q.max_attempts - q.attempts_used) }
    );
  }

  function openQuizModal(skipQuestionRender) {
    const mount = document.getElementById('quiz-modal-mount');
    mount.innerHTML = `
      <div class="quiz-overlay" id="quiz-overlay">
        <div class="quiz-card">
          <div class="quiz-timer" id="quiz-timer" style="display:none"></div>
          <div class="quiz-title">${escHtml(quizState.quizMeta.title)}</div>
          ${quizState.quizMeta.description ? `<div class="quiz-sub">${escHtml(quizState.quizMeta.description)}</div>` : ''}
          <div class="quiz-progress-label" id="quiz-progress-label"></div>
          <div class="quiz-progress-track"><div class="quiz-progress-fill" id="quiz-progress-fill"></div></div>
          <div id="quiz-question-mount"></div>
        </div>
      </div>`;
    if (quizState.expiresAt) startQuizTimer();
    if (!skipQuestionRender) renderQuestion();
  }

  function closeQuizModal() {
    if (quizState.timerHandle) clearInterval(quizState.timerHandle);
    document.getElementById('quiz-modal-mount').innerHTML = '';
    load(document.getElementById('assessments-units')); // refresh card states behind the modal
  }

  function startQuizTimer() {
    const timerEl = document.getElementById('quiz-timer');
    timerEl.style.display = 'block';
    const tick = () => {
      const remainingMs = new Date(quizState.expiresAt) - new Date();
      if (remainingMs <= 0) {
        timerEl.textContent = "Time's up";
        clearInterval(quizState.timerHandle);
        finishQuiz(true);
        return;
      }
      timerEl.textContent = `Time remaining: ${fmtMinutes(remainingMs / 1000)}`;
      if (remainingMs < 60000) timerEl.classList.add('quiz-timer-warn');
    };
    tick();
    quizState.timerHandle = setInterval(tick, 1000);
  }

  function renderQuestion() {
    const total = quizState.questions.length;
    const q = quizState.questions[quizState.index];
    document.getElementById('quiz-progress-label').textContent = `QUESTION ${quizState.index + 1} OF ${total}`;
    document.getElementById('quiz-progress-fill').style.width = `${((quizState.index + 1) / total) * 100}%`;

    const selected = quizState.answers[q.id];
    const letters = ['A', 'B', 'C', 'D'];
    const mount = document.getElementById('quiz-question-mount');
    mount.innerHTML = `
      <div class="quiz-question-text">${escHtml(q.question_text)}</div>
      <div class="quiz-choices" id="quiz-choices">
        ${letters.map(letter => `
          <div class="quiz-choice ${selected === letter ? 'quiz-choice-selected' : ''}" data-choice="${letter}">
            <span class="quiz-choice-letter">${letter}</span>
            <span>${escHtml(q[`choice_${letter.toLowerCase()}`])}</span>
          </div>`).join('')}
      </div>
      <button class="quiz-confirm-btn" id="quiz-confirm-btn" ${selected ? '' : 'disabled'}>
        ${quizState.index === total - 1 ? 'Submit quiz' : 'Confirm Answer'}
      </button>`;

    mount.querySelectorAll('.quiz-choice').forEach(el => {
      el.onclick = () => {
        mount.querySelectorAll('.quiz-choice').forEach(c => c.classList.remove('quiz-choice-selected'));
        el.classList.add('quiz-choice-selected');
        quizState.answers[q.id] = el.dataset.choice;
        document.getElementById('quiz-confirm-btn').disabled = false;
      };
    });

    document.getElementById('quiz-confirm-btn').onclick = () => confirmAnswer(q.id);
  }

  async function confirmAnswer(questionId) {
    if (quizState.submitting) return;
    const btn = document.getElementById('quiz-confirm-btn');
    btn.disabled = true;
    try {
      const res = await fetch(`/api/learner/quizzes/${quizState.quizId}/attempt/answer`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_id: questionId, selected_choice: quizState.answers[questionId] }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);

      if (quizState.index === quizState.questions.length - 1) {
        const ok = await finishQuiz(false);
        // finishQuiz swallows its own errors (so a timer-triggered auto-submit
        // never throws into the caller) — without this, a failed submit left
        // the button disabled forever with no way to retry, which is exactly
        // what "the submit button doesn't work" looks like from the outside.
        if (!ok && btn.isConnected) btn.disabled = false;
      } else {
        quizState.index += 1;
        renderQuestion();
      }
    } catch (err) {
      console.error('confirmAnswer error:', err);
      alert(err.message);
      if (btn.isConnected) btn.disabled = false;
    }
  }

  async function finishQuiz(timedOut) {
    if (quizState.submitting) return false;
    quizState.submitting = true;
    if (quizState.timerHandle) clearInterval(quizState.timerHandle);
    try {
      const res = await fetch(`/api/learner/quizzes/${quizState.quizId}/submit`, { method: 'POST' });
      const data = await res.json();
      quizState.submitting = false;
      if (!data.success) throw new Error(data.message);
      renderQuizResult(data.attempt || {}, timedOut, {
        attempts_used: data.attempts_used,
        max_attempts: data.max_attempts,
        attempts_remaining: data.attempts_remaining,
      });
      return true;
    } catch (err) {
      quizState.submitting = false;
      console.error('finishQuiz error:', err);
      alert('Could not submit quiz: ' + err.message);
      return false;
    }
  }

  function renderQuizResult(attempt, timedOut, attemptInfo) {
    const mount = document.getElementById('quiz-question-mount');
    document.getElementById('quiz-progress-label').textContent = timedOut ? 'TIME EXPIRED' : 'QUIZ COMPLETE';
    document.getElementById('quiz-progress-fill').style.width = '100%';
    const scorePct = Number(attempt.score_pct);
    const pass = scorePct >= quizState.quizMeta.pass_mark_pct;
    const remainingLine = attemptInfo && attemptInfo.max_attempts != null
      ? `<div class="quiz-result-attempts">${attemptInfo.attempts_used} of ${attemptInfo.max_attempts} attempt${attemptInfo.max_attempts === 1 ? '' : 's'} used${attemptInfo.attempts_remaining > 0 ? ` · ${attemptInfo.attempts_remaining} remaining` : ' · no attempts remaining'}</div>`
      : '';
    mount.innerHTML = `
      <div class="quiz-result">
        <div class="quiz-result-score ${pass ? 'quiz-result-pass' : 'quiz-result-fail'}">${fmtPct(scorePct)}%</div>
        <div class="quiz-result-sub">${attempt.score}/${attempt.total_marks} marks ${pass ? '· Passed' : '· Below pass mark'}</div>
        ${remainingLine}
        <button class="quiz-confirm-btn" id="quiz-close-btn">Close</button>
      </div>`;
    document.getElementById('quiz-close-btn').onclick = closeQuizModal;
  }

  return { init };
})();