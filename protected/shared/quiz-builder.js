/* ══════════════════════════════════════════════════════════
   quiz-builder.js — reusable admin quiz management component
   Mount with: QuizBuilder.renderForUnit(unitId, containerEl)
   Admin-only: every endpoint it calls is gated server-side by
   isRole('admin'), this is purely the UI layer on top.
══════════════════════════════════════════════════════════ */
const QuizBuilder = (() => {
  const MIN_QUESTIONS = 6;
  const state = {}; // unitId -> { quizzes, openQuizId, questions }

  function escHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function statusBadge(status) {
    const map = {
      draft: '<span class="badge badge-inactive">Draft</span>',
      published: '<span class="badge badge-active">Published</span>',
      archived: '<span class="badge">Archived</span>',
    };
    return map[status] || '';
  }

  async function renderForUnit(unitId, container) {
    state[unitId] = state[unitId] || { quizzes: [], openQuizId: null, questions: [] };
    container.innerHTML = `<div class="qz-loading">Loading quizzes…</div>`;
    try {
      const res = await fetch(`/api/units/${unitId}/quizzes`);
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      state[unitId].quizzes = data.quizzes;
      renderQuizList(unitId, container);
    } catch (err) {
      container.innerHTML = `<div class="qz-error">Failed to load quizzes: ${escHtml(err.message)}</div>`;
    }
  }

  function renderQuizList(unitId, container) {
    const s = state[unitId];
    const rows = s.quizzes.length
      ? s.quizzes.map(q => renderQuizRow(unitId, q)).join('')
      : `<div class="qz-empty">No quizzes yet for this unit.</div>`;

    container.innerHTML = `
      <div class="qz-panel">
        <div class="qz-panel-head">
          <span class="qz-panel-title">Quizzes</span>
          <button class="btn btn-xs btn-blue" data-action="new-quiz">+ New quiz</button>
        </div>
        <div class="qz-list">${rows}</div>
        <div class="qz-new-form" id="qz-new-form-${unitId}" style="display:none"></div>
        <div class="qz-editor" id="qz-editor-${unitId}"></div>
      </div>`;

    container.querySelector('[data-action="new-quiz"]').onclick = () => toggleNewQuizForm(unitId, container);
    s.quizzes.forEach(q => {
      container.querySelector(`[data-open-quiz="${q.id}"]`).onclick = () => openQuizEditor(unitId, q.id, container);
      container.querySelector(`[data-delete-quiz="${q.id}"]`).onclick = () => deleteQuiz(unitId, q.id, container);
    });
  }

  function renderQuizRow(unitId, q) {
    const marks = Number(q.total_marks || 0);
    const complete = q.question_count >= MIN_QUESTIONS;
    return `
      <div class="qz-row">
        <div class="qz-row-main">
          <span class="qz-row-title">${escHtml(q.title)}</span>
          ${statusBadge(q.status)}
        </div>
        <div class="qz-row-meta">
          ${q.question_count}/${MIN_QUESTIONS}+ questions · ${marks} marks
          ${!complete ? '<span class="qz-incomplete"> · needs more questions to publish</span>' : ''}
        </div>
        <div class="qz-row-actions">
          <button class="btn btn-xs" data-open-quiz="${q.id}">Manage</button>
          <button class="btn btn-xs btn-red" data-delete-quiz="${q.id}">Delete</button>
        </div>
      </div>`;
  }

  function toggleNewQuizForm(unitId, container) {
    const form = container.querySelector(`#qz-new-form-${unitId}`);
    const open = form.style.display !== 'none';
    if (open) { form.style.display = 'none'; form.innerHTML = ''; return; }

    form.style.display = 'block';
    form.innerHTML = `
      <div class="qz-form-row">
        <input type="text" class="qz-input" id="qz-new-title-${unitId}" placeholder="Quiz title">
      </div>
      <div class="qz-form-row">
        <textarea class="qz-input" id="qz-new-desc-${unitId}" rows="2" placeholder="Description (optional)"></textarea>
      </div>
      <div class="qz-form-row qz-form-row-split">
        <input type="number" class="qz-input" id="qz-new-time-${unitId}" placeholder="Time limit (min)" min="1">
        <input type="number" class="qz-input" id="qz-new-pass-${unitId}" placeholder="Pass mark %" min="0" max="100" value="50">
      </div>
      <button class="btn btn-xs btn-blue" data-action="save-new-quiz">Create quiz</button>
    `;
    form.querySelector('[data-action="save-new-quiz"]').onclick = () => createQuiz(unitId, container);
  }

  async function createQuiz(unitId, container) {
    const title = document.getElementById(`qz-new-title-${unitId}`).value.trim();
    if (!title) { alert('Quiz title is required.'); return; }
    const description = document.getElementById(`qz-new-desc-${unitId}`).value.trim();
    const time_limit_minutes = document.getElementById(`qz-new-time-${unitId}`).value || null;
    const pass_mark_pct = document.getElementById(`qz-new-pass-${unitId}`).value || 50;

    try {
      const res = await fetch(`/api/units/${unitId}/quizzes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, time_limit_minutes, pass_mark_pct }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      await renderForUnit(unitId, container);
      openQuizEditor(unitId, data.quizId, container);
    } catch (err) {
      alert('Could not create quiz: ' + err.message);
    }
  }

  async function deleteQuiz(unitId, quizId, container) {
    if (!confirm('Delete this quiz and all its questions? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/quizzes/${quizId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      await renderForUnit(unitId, container);
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  }

  async function openQuizEditor(unitId, quizId, container) {
    const editor = container.querySelector(`#qz-editor-${unitId}`);
    editor.innerHTML = `<div class="qz-loading">Loading quiz…</div>`;
    try {
      const res = await fetch(`/api/quizzes/${quizId}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      state[unitId].openQuizId = quizId;
      state[unitId].questions = data.questions;
      renderQuizEditor(unitId, container, data.quiz, data.questions);
    } catch (err) {
      editor.innerHTML = `<div class="qz-error">Failed to load quiz: ${escHtml(err.message)}</div>`;
    }
  }

  function renderQuizEditor(unitId, container, quiz, questions) {
    const editor = container.querySelector(`#qz-editor-${unitId}`);
    const canPublish = questions.length >= MIN_QUESTIONS;
    const isPublished = quiz.status === 'published';

    editor.innerHTML = `
      <div class="qz-editor-inner">
        <div class="qz-editor-head">
          <div>
            <div class="qz-editor-title">${escHtml(quiz.title)}</div>
            <div class="qz-editor-sub">${statusBadge(quiz.status)} · ${questions.length}/${MIN_QUESTIONS}+ questions required to publish</div>
          </div>
          <div class="qz-editor-actions">
            ${isPublished
              ? `<button class="btn btn-xs" data-action="unpublish">Set to draft</button>`
              : `<button class="btn btn-xs btn-blue" data-action="publish" ${canPublish ? '' : 'disabled title="Add at least 6 questions first"'}>Publish</button>`}
            <button class="btn btn-xs" data-action="close-editor">Close</button>
          </div>
        </div>

        <div class="qz-question-list" id="qz-question-list-${unitId}">
          ${questions.map((q, i) => renderQuestionRow(q, i)).join('') ||
            `<div class="qz-empty">No questions yet. Add at least ${MIN_QUESTIONS} below.</div>`}
        </div>

        <button class="btn btn-xs btn-blue" data-action="add-question" style="margin-top:10px">+ Add question</button>
        <div class="qz-question-form" id="qz-question-form-${unitId}" style="display:none"></div>
      </div>`;

    editor.querySelector('[data-action="close-editor"]').onclick = () => {
      editor.innerHTML = '';
      state[unitId].openQuizId = null;
    };
    editor.querySelector('[data-action="add-question"]').onclick = () =>
      toggleQuestionForm(unitId, container, quiz.id, null);

    const publishBtn = editor.querySelector('[data-action="publish"]');
    if (publishBtn) publishBtn.onclick = () => setQuizStatus(unitId, container, quiz.id, 'published');
    const unpublishBtn = editor.querySelector('[data-action="unpublish"]');
    if (unpublishBtn) unpublishBtn.onclick = () => setQuizStatus(unitId, container, quiz.id, 'draft');

    questions.forEach(q => {
      const editBtn = editor.querySelector(`[data-edit-q="${q.id}"]`);
      const delBtn = editor.querySelector(`[data-delete-q="${q.id}"]`);
      if (editBtn) editBtn.onclick = () => toggleQuestionForm(unitId, container, quiz.id, q);
      if (delBtn) delBtn.onclick = () => deleteQuestion(unitId, container, quiz.id, q.id);
    });
  }

  function renderQuestionRow(q, index) {
    const choices = ['A', 'B', 'C', 'D'].map(letter => {
      const isCorrect = q.correct_choice === letter;
      return `<div class="qz-choice ${isCorrect ? 'qz-choice-correct' : ''}">
        <span class="qz-choice-letter">${letter}</span> ${escHtml(q[`choice_${letter.toLowerCase()}`])}
        ${isCorrect ? '<span class="qz-check">✓</span>' : ''}
      </div>`;
    }).join('');

    return `
      <div class="qz-question-row" data-question-id="${q.id}">
        <div class="qz-question-head">
          <span class="qz-question-num">Q${index + 1}</span>
          <span class="qz-question-text">${escHtml(q.question_text)}</span>
          <span class="qz-question-marks">${q.marks} mark${Number(q.marks) === 1 ? '' : 's'}</span>
        </div>
        <div class="qz-choices">${choices}</div>
        <div class="qz-question-actions">
          <button class="btn btn-xs" data-edit-q="${q.id}">Edit</button>
          <button class="btn btn-xs btn-red" data-delete-q="${q.id}">Delete</button>
        </div>
      </div>`;
  }

  function toggleQuestionForm(unitId, container, quizId, existing) {
    const form = container.querySelector(`#qz-question-form-${unitId}`);
    const isEdit = !!existing;

    form.style.display = 'block';
    form.innerHTML = `
      <div class="qz-form-row">
        <textarea class="qz-input" id="qz-q-text-${unitId}" rows="2" placeholder="Question text">${isEdit ? escHtml(existing.question_text) : ''}</textarea>
      </div>
      ${['A', 'B', 'C', 'D'].map(letter => `
        <div class="qz-form-row qz-choice-input-row">
          <input type="radio" name="qz-correct-${unitId}" value="${letter}"
            id="qz-correct-${unitId}-${letter}" ${isEdit && existing.correct_choice === letter ? 'checked' : ''}>
          <label for="qz-correct-${unitId}-${letter}">${letter}</label>
          <input type="text" class="qz-input" id="qz-choice-${letter}-${unitId}"
            placeholder="Choice ${letter}" value="${isEdit ? escHtml(existing[`choice_${letter.toLowerCase()}`]) : ''}">
        </div>`).join('')}
      <div class="qz-form-row qz-form-row-split">
        <input type="number" class="qz-input" id="qz-q-marks-${unitId}" placeholder="Marks" min="0.5" step="0.5"
          value="${isEdit ? existing.marks : 1}">
        <button class="btn btn-xs btn-blue" data-action="save-question">${isEdit ? 'Save changes' : 'Add question'}</button>
        <button class="btn btn-xs" data-action="cancel-question">Cancel</button>
      </div>
    `;

    form.querySelector('[data-action="cancel-question"]').onclick = () => {
      form.style.display = 'none';
      form.innerHTML = '';
    };
    form.querySelector('[data-action="save-question"]').onclick = () =>
      saveQuestion(unitId, container, quizId, existing?.id);
  }

  async function saveQuestion(unitId, container, quizId, existingId) {
    const correctInput = document.querySelector(`input[name="qz-correct-${unitId}"]:checked`);
    const payload = {
      question_text: document.getElementById(`qz-q-text-${unitId}`).value.trim(),
      choice_a: document.getElementById(`qz-choice-A-${unitId}`).value.trim(),
      choice_b: document.getElementById(`qz-choice-B-${unitId}`).value.trim(),
      choice_c: document.getElementById(`qz-choice-C-${unitId}`).value.trim(),
      choice_d: document.getElementById(`qz-choice-D-${unitId}`).value.trim(),
      correct_choice: correctInput ? correctInput.value : null,
      marks: document.getElementById(`qz-q-marks-${unitId}`).value || 1,
    };
    if (!payload.correct_choice) { alert('Select which choice is correct.'); return; }

    try {
      const url = existingId ? `/api/questions/${existingId}` : `/api/quizzes/${quizId}/questions`;
      const method = existingId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      await refreshEditor(unitId, container, quizId);
      await renderForUnit(unitId, container); // refresh counts in the collapsed list too
      await openQuizEditor(unitId, quizId, container);
    } catch (err) {
      alert('Save failed: ' + err.message);
    }
  }

  async function deleteQuestion(unitId, container, quizId, questionId) {
    if (!confirm('Delete this question?')) return;
    try {
      const res = await fetch(`/api/questions/${questionId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      await renderForUnit(unitId, container);
      await openQuizEditor(unitId, quizId, container);
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  }

  async function setQuizStatus(unitId, container, quizId, status) {
    try {
      const res = await fetch(`/api/quizzes/${quizId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      await renderForUnit(unitId, container);
      await openQuizEditor(unitId, quizId, container);
    } catch (err) {
      alert(err.message); // surfaces the "needs at least 6 questions" DB message directly
    }
  }

  async function refreshEditor(unitId, container, quizId) {
    // no-op placeholder kept for readability; openQuizEditor already re-fetches
  }

  return { renderForUnit };
})();