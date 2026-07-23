/* 
   project-builder.js — reusable admin project-assessment component
   Mount with: ProjectBuilder.renderForUnit(unitId, containerEl)
   Admin-only: every endpoint it calls is gated server-side by
   isRole('admin'); */
const ProjectBuilder = (() => {
  const state = {}; // unitId -> { projects }

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

  function fmtSize(bytes) {
    if (!bytes) return '';
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
  }

  async function renderForUnit(unitId, container) {
    state[unitId] = state[unitId] || { projects: [] };
    container.innerHTML = `<div class="pj-loading">Loading projects…</div>`;
    try {
      const res = await fetch(`/api/units/${unitId}/projects`);
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      state[unitId].projects = data.projects;
      renderProjectList(unitId, container);
    } catch (err) {
      container.innerHTML = `<div class="pj-error">Failed to load projects: ${escHtml(err.message)}</div>`;
    }
  }

  function renderProjectList(unitId, container) {
    const s = state[unitId];
    const rows = s.projects.length
      ? s.projects.map(p => renderProjectRow(unitId, p)).join('')
      : `<div class="pj-empty">No project assessments yet for this unit.</div>`;

    container.innerHTML = `
      <div class="pj-panel">
        <div class="pj-panel-head">
          <span class="pj-panel-title">Project assessments</span>
          <button class="btn btn-xs btn-blue" data-action="new-project">+ New project</button>
        </div>
        <div class="pj-list">${rows}</div>
        <div class="pj-new-form" id="pj-new-form-${unitId}" style="display:none"></div>
        <div class="pj-editor" id="pj-editor-${unitId}"></div>
      </div>`;

    container.querySelector('[data-action="new-project"]').onclick = () => toggleNewProjectForm(unitId, container);
    s.projects.forEach(p => {
      container.querySelector(`[data-open-project="${p.id}"]`).onclick = () => openProjectEditor(unitId, p.id, container);
      container.querySelector(`[data-delete-project="${p.id}"]`).onclick = () => deleteProject(unitId, p.id, container);
    });
  }

  function renderProjectRow(unitId, p) {
    const hasBrief = !!p.brief_file_name;
    return `
      <div class="pj-row">
        <div class="pj-row-main">
          <span class="pj-row-title">${escHtml(p.title)}</span>
          ${statusBadge(p.status)}
        </div>
        <div class="pj-row-meta">
          ${p.total_marks} marks · ${p.duration_days} day${Number(p.duration_days) === 1 ? '' : 's'} ·
          ${p.submission_count} submission${p.submission_count === 1 ? '' : 's'}
          ${!hasBrief ? '<span class="pj-incomplete"> · no brief uploaded yet</span>' : ''}
        </div>
        <div class="pj-row-actions">
          <button class="btn btn-xs" data-open-project="${p.id}">Manage</button>
          <button class="btn btn-xs btn-red" data-delete-project="${p.id}">Delete</button>
        </div>
      </div>`;
  }

  function toggleNewProjectForm(unitId, container) {
    const form = container.querySelector(`#pj-new-form-${unitId}`);
    const open = form.style.display !== 'none';
    if (open) { form.style.display = 'none'; form.innerHTML = ''; return; }

    form.style.display = 'block';
    form.innerHTML = `
      <div class="pj-form-row">
        <input type="text" class="pj-input" id="pj-new-title-${unitId}" placeholder="Project title">
      </div>
      <div class="pj-form-row">
        <textarea class="pj-input" id="pj-new-desc-${unitId}" rows="2" placeholder="Description / brief summary (optional)"></textarea>
      </div>
      <div class="pj-form-row pj-form-row-split">
        <input type="number" class="pj-input" id="pj-new-marks-${unitId}" placeholder="Total marks" min="1" step="0.5">
        <input type="number" class="pj-input" id="pj-new-duration-${unitId}" placeholder="Duration (days)" min="1">
      </div>
      <button class="btn btn-xs btn-blue" data-action="save-new-project">Create project</button>
    `;
    form.querySelector('[data-action="save-new-project"]').onclick = () => createProject(unitId, container);
  }

  async function createProject(unitId, container) {
    const title = document.getElementById(`pj-new-title-${unitId}`).value.trim();
    const total_marks = document.getElementById(`pj-new-marks-${unitId}`).value;
    const duration_days = document.getElementById(`pj-new-duration-${unitId}`).value;

    if (!title) { alert('Project title is required.'); return; }
    if (!total_marks || Number(total_marks) <= 0) { alert('Enter a valid mark allocation.'); return; }
    if (!duration_days || parseInt(duration_days, 10) <= 0) { alert('Enter a valid duration in days.'); return; }

    const description = document.getElementById(`pj-new-desc-${unitId}`).value.trim();

    try {
      const res = await fetch(`/api/units/${unitId}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, total_marks, duration_days }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      await renderForUnit(unitId, container);
      openProjectEditor(unitId, data.projectId, container);
    } catch (err) {
      alert('Could not create project: ' + err.message);
    }
  }

  async function deleteProject(unitId, projectId, container) {
    if (!confirm('Delete this project? This also removes the uploaded brief. This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      await renderForUnit(unitId, container);
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  }

  async function openProjectEditor(unitId, projectId, container) {
    const editor = container.querySelector(`#pj-editor-${unitId}`);
    editor.innerHTML = `<div class="pj-loading">Loading project…</div>`;
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      renderProjectEditor(unitId, container, data.project);
    } catch (err) {
      editor.innerHTML = `<div class="pj-error">Failed to load project: ${escHtml(err.message)}</div>`;
    }
  }

  function renderProjectEditor(unitId, container, project) {
    const editor = container.querySelector(`#pj-editor-${unitId}`);
    const hasBrief = !!project.brief_file_name;
    const isPublished = project.status === 'published';

    editor.innerHTML = `
      <div class="pj-editor-inner">
        <div class="pj-editor-head">
          <div>
            <div class="pj-editor-title">${escHtml(project.title)}</div>
            <div class="pj-editor-sub">${statusBadge(project.status)} · ${project.total_marks} marks · ${project.duration_days} day${Number(project.duration_days) === 1 ? '' : 's'} to submit</div>
          </div>
          <div class="pj-editor-actions">
            ${isPublished
              ? `<button class="btn btn-xs" data-action="unpublish">Set to draft</button>`
              : `<button class="btn btn-xs btn-blue" data-action="publish" ${hasBrief ? '' : 'disabled title="Upload the brief PDF first"'}>Publish</button>`}
            <button class="btn btn-xs" data-action="close-editor">Close</button>
          </div>
        </div>

        ${project.description ? `<div class="pj-editor-desc">${escHtml(project.description)}</div>` : ''}

        <div class="pj-brief-block">
          <div class="pj-brief-label">Assessment brief (PDF)</div>
          ${hasBrief
            ? `<div class="pj-brief-row">
                 <a href="${project.brief_url}" target="_blank" rel="noopener" class="pj-brief-link">${escHtml(project.brief_file_name)}</a>
                 <span class="pj-brief-size">${fmtSize(project.brief_file_size)}</span>
                 <button class="btn btn-xs" data-action="replace-brief">Replace</button>
                 <button class="btn btn-xs btn-red" data-action="delete-brief">Remove</button>
               </div>`
            : `<div class="pj-brief-empty">No brief uploaded yet. Publishing is disabled until one is added.</div>
               <button class="btn btn-xs btn-blue" data-action="upload-brief">Upload brief PDF</button>`}
          <input type="file" id="pj-brief-input-${unitId}" accept=".pdf" style="display:none">
        </div>

        <div class="pj-editor-fields">
          <div class="pj-form-row">
            <input type="text" class="pj-input" id="pj-edit-title-${unitId}" value="${escHtml(project.title)}" placeholder="Project title">
          </div>
          <div class="pj-form-row">
            <textarea class="pj-input" id="pj-edit-desc-${unitId}" rows="2" placeholder="Description">${escHtml(project.description || '')}</textarea>
          </div>
          <div class="pj-form-row pj-form-row-split">
            <input type="number" class="pj-input" id="pj-edit-marks-${unitId}" value="${project.total_marks}" min="1" step="0.5" placeholder="Total marks">
            <input type="number" class="pj-input" id="pj-edit-duration-${unitId}" value="${project.duration_days}" min="1" placeholder="Duration (days)">
            <button class="btn btn-xs btn-blue" data-action="save-fields">Save changes</button>
          </div>
        </div>
      </div>`;

    editor.querySelector('[data-action="close-editor"]').onclick = () => { editor.innerHTML = ''; };
    editor.querySelector('[data-action="save-fields"]').onclick = () => saveProjectFields(unitId, container, project.id);

    const publishBtn = editor.querySelector('[data-action="publish"]');
    if (publishBtn) publishBtn.onclick = () => setProjectStatus(unitId, container, project.id, 'published');
    const unpublishBtn = editor.querySelector('[data-action="unpublish"]');
    if (unpublishBtn) unpublishBtn.onclick = () => setProjectStatus(unitId, container, project.id, 'draft');

    const fileInput = editor.querySelector(`#pj-brief-input-${unitId}`);
    fileInput.onchange = () => {
      if (fileInput.files.length) uploadBrief(unitId, container, project.id, fileInput.files[0]);
    };
    const uploadBtn = editor.querySelector('[data-action="upload-brief"]');
    if (uploadBtn) uploadBtn.onclick = () => fileInput.click();
    const replaceBtn = editor.querySelector('[data-action="replace-brief"]');
    if (replaceBtn) replaceBtn.onclick = () => fileInput.click();
    const deleteBriefBtn = editor.querySelector('[data-action="delete-brief"]');
    if (deleteBriefBtn) deleteBriefBtn.onclick = () => deleteBrief(unitId, container, project.id);
  }

  async function saveProjectFields(unitId, container, projectId) {
    const payload = {
      title: document.getElementById(`pj-edit-title-${unitId}`).value.trim(),
      description: document.getElementById(`pj-edit-desc-${unitId}`).value.trim(),
      total_marks: document.getElementById(`pj-edit-marks-${unitId}`).value,
      duration_days: document.getElementById(`pj-edit-duration-${unitId}`).value,
    };
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      await renderForUnit(unitId, container);
      await openProjectEditor(unitId, projectId, container);
    } catch (err) {
      alert('Save failed: ' + err.message);
    }
  }

  async function uploadBrief(unitId, container, projectId, file) {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`/api/projects/${projectId}/brief`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      await renderForUnit(unitId, container);
      await openProjectEditor(unitId, projectId, container);
    } catch (err) {
      alert('Brief upload failed: ' + err.message);
    }
  }

  async function deleteBrief(unitId, container, projectId) {
    if (!confirm('Remove the uploaded brief? The project will revert to draft-only until a new one is uploaded.')) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/brief`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      await renderForUnit(unitId, container);
      await openProjectEditor(unitId, projectId, container);
    } catch (err) {
      alert('Remove failed: ' + err.message);
    }
  }

  async function setProjectStatus(unitId, container, projectId, status) {
    try {
      const res = await fetch(`/api/projects/${projectId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      await renderForUnit(unitId, container);
      await openProjectEditor(unitId, projectId, container);
    } catch (err) {
      alert(err.message); // surfaces the "upload the brief first" DB message directly
    }
  }

  return { renderForUnit };
})();