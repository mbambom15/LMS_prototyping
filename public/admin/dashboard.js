/* ── Section navigation ── */
function showSection(name, el) {
  document.querySelectorAll('.section-page').forEach(s => s.classList.remove('visible'));
  document.getElementById('section-' + name).classList.add('visible');
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  if (el) el.classList.add('active');
}

/* ── CRUD toggle panels ── */
function toggleArea(id) {
  const target = document.getElementById(id);
  if (!target) return;

  const isOpen = target.classList.contains('visible');

  // Close all content areas
  document.querySelectorAll('.content-area').forEach(el => el.classList.remove('visible'));

  // Show/hide the password generator button
  const pwBtn = document.getElementById('pw-gen-btn');
  if (pwBtn) {
    pwBtn.style.display = (!isOpen && id === 'add-user') ? 'inline-flex' : 'none';
  }

  // If the panel is being opened (not closed), load its data
  if (!isOpen) {
    target.classList.add('visible');

    if (id === 'all-users') refreshUserTable();
    if (id === 'modify-user' || id === 'remove-user') populateUserSelects();

    // Qualification‑related triggers (merged from the old second function)
    if (id === 'all-qual') refreshQualTable();
    if (id === 'remove-qual') populateRemoveSelect();
    if (id === 'upload-material') onUploadQualChange();
  }
}


function openPasswordGenerator() {
  window.open('password_generator.html', '_blank', 'width=560,height=620,resizable=yes');
}

function handleLogout() {
  if (confirm('Are you sure you want to log out?')) {
    window.location.href = '/logout';
  }
}

/* ══════════════════════════════════════════════════════════
   USER TABLE — READ, INLINE EDIT, DELETE
══════════════════════════════════════════════════════════ */

const ROLES    = ['learner', 'facilitator', 'assessor', 'grader', 'admin'];
const STATUSES = ['active', 'inactive', 'suspended', 'completed'];

const badgeClass = {
  active:    'badge-active',
  inactive:  'badge-inactive',
  suspended: 'badge-suspended',
  completed: 'badge-completed',
};

/** Fetch all users from the API and re-render the table body */
async function refreshUserTable() {
  const tbody = document.querySelector('#all-users table tbody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-secondary);font-size:13px">Loading users…</td></tr>`;

  try {
    const res  = await fetch('/api/users');
    const data = await res.json();

    if (!data.success) throw new Error(data.message);

    if (!data.users.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-secondary);font-size:13px">No users found.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.users.map(u => renderUserRow(u)).join('');

  } catch (err) {
    console.error('refreshUserTable:', err);
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--color-red);font-size:13px">Failed to load users: ${err.message}</td></tr>`;
  }
}

/** Render a single read-only user row */
function renderUserRow(u) {
  const name   = [u.name, u.surname].filter(Boolean).join(' ') || '—';
  const badge  = badgeClass[u.status] || 'badge-inactive';
  const qual   = u.qualification || '—';

  return `
    <tr data-id="${u.user_id}" data-role="${u.role}" data-status="${u.status}">
      <td>${escHtml(name)}</td>
      <td>${escHtml(u.email)}</td>
      <td><span class="badge badge-role">${escHtml(u.role)}</span></td>
      <td>${escHtml(qual)}</td>
      <td><span class="badge ${badge}">${escHtml(u.status)}</span></td>
      <td>
        <button class="btn btn-xs btn-blue" onclick="enterEditMode(this)">Edit</button>
        <button class="btn btn-xs btn-red"  onclick="confirmDeleteUser('${u.user_id}', '${escHtml(name)}')">Remove</button>
      </td>
    </tr>`;
}

/** Switch a row into inline-edit mode */
function enterEditMode(btn) {
  const row    = btn.closest('tr');
  const userId = row.dataset.id;
  const cells  = row.querySelectorAll('td');

  // Read current values from data attributes or cell text
  const currentRole   = row.dataset.role;
  const currentStatus = row.dataset.status;

  // col 2 → role selector, col 4 → status selector
  cells[2].innerHTML = selectHtml('role-select',   ROLES,    currentRole);
  cells[4].innerHTML = selectHtml('status-select', STATUSES, currentStatus);

  // Replace action buttons
  cells[5].innerHTML = `
    <button class="btn btn-xs btn-green" onclick="saveUserEdit('${userId}', this)">Save</button>
    <button class="btn btn-xs"           onclick="cancelEditMode(this)">Cancel</button>`;
}

/** Save the inline edit via PUT /api/users/:id */
async function saveUserEdit(userId, btn) {
  const row        = btn.closest('tr');
  const roleSelect   = row.querySelector('.role-select');
  const statusSelect = row.querySelector('.status-select');
  const newRole   = roleSelect.value;
  const newStatus = statusSelect.value;

  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const res  = await fetch(`/api/users/${userId}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ role: newRole, status: newStatus })
    });
    const data = await res.json();

    if (!data.success) throw new Error(data.message);

    showTableMessage('User updated successfully.', 'success');
    await refreshUserTable();   // re-render fresh from DB

  } catch (err) {
    console.error('saveUserEdit:', err);
    showTableMessage('Update failed: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

/** Revert a row back to read-only without saving */
function cancelEditMode(btn) {
  // Simply refresh the whole table — avoids stale state
  refreshUserTable();
}

/** Show a confirmation dialog, then DELETE /api/users/:id */
async function confirmDeleteUser(userId, name) {
  if (!confirm(`Remove user "${name}"?\n\nThis is permanent. Their records will be archived before removal.`)) return;

  try {
    const res  = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
    const data = await res.json();

    if (!data.success) throw new Error(data.message);

    showTableMessage(`"${name}" has been removed.`, 'success');
    await refreshUserTable();

  } catch (err) {
    console.error('confirmDeleteUser:', err);
    showTableMessage('Remove failed: ' + err.message, 'error');
  }
}

/* ── Populate the modify-user and remove-user <select>s ── */
async function populateUserSelects() {
  try {
    const res  = await fetch('/api/users');
    const data = await res.json();
    if (!data.success) return;

    const options = data.users.map(u =>
      `<option value="${u.user_id}">${escHtml([u.name, u.surname].filter(Boolean).join(' '))} (${u.email})</option>`
    ).join('');

    // modify-user select
    const modSel = document.querySelector('#modify-user select');
    if (modSel) modSel.innerHTML = options;

    // remove-user select
    const remSel = document.querySelector('#remove-user select');
    if (remSel) remSel.innerHTML = options;

  } catch (err) {
    console.error('populateUserSelects:', err);
  }
}

/* ── Small inline message above/below the table ── */
function showTableMessage(text, type) {
  let el = document.getElementById('table-message');
  if (!el) {
    el = document.createElement('div');
    el.id = 'table-message';
    el.style.cssText = 'margin:8px 0;font-size:13px;padding:8px 12px;border-radius:6px;';
    const area = document.getElementById('all-users');
    if (area) area.prepend(el);
  }
  el.textContent = text;
  el.className   = type === 'success' ? 'success-message' : 'error-message';
  el.style.display = 'block';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.display = 'none'; }, 5000);
}

/* ── Utility: build a <select> with a pre-selected value ── */
function selectHtml(className, options, selected) {
  const opts = options.map(o =>
    `<option value="${o}"${o === selected ? ' selected' : ''}>${o}</option>`
  ).join('');
  return `<select class="${className}" style="font-size:12px;padding:3px 6px;border-radius:4px;border:1px solid var(--border)">${opts}</select>`;
}

/* ── Utility: escape HTML special chars ── */
function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ══════════════════════════════════════════════════════════
   QUAL PREVIEW
══════════════════════════════════════════════════════════ */
const qualData = {
  it:  { title: 'IT Support — NQF 4',             seta: 'MICT SETA · 12 months' },
  ba:  { title: 'Business Administration — NQF 3', seta: 'SERVICES SETA · 12 months' },
  fin: { title: 'Finance & Accounting — NQF 4',    seta: 'FASSET · 18 months' }
};

function updatePreview() {
  const q     = document.getElementById('qual-select').value;
  const uSel  = document.getElementById('unit-select');
  const uText = uSel.options[uSel.selectedIndex].text;
  const uNum  = uSel.selectedIndex + 1;
  const desc  = document.getElementById('desc-input').value;
  document.getElementById('prev-title').textContent     = qualData[q].title;
  document.getElementById('prev-seta').textContent      = qualData[q].seta;
  document.getElementById('prev-unit-name').textContent = uText;
  document.getElementById('prev-unit-num').textContent  = uNum;
  document.getElementById('prev-desc').textContent      = desc || 'No description provided.';
  const count = document.getElementById('file-list').children.length;
  document.getElementById('prev-file-count').textContent = count;
}

/* ══════════════════════════════════════════════════════════
   FILE UPLOAD
══════════════════════════════════════════════════════════ */
const typeMap = {
  pdf:  { label: 'PDF', bg: '#fcebeb', color: '#a32d2d' },
  mp4:  { label: 'MP4', bg: '#e6f1fb', color: '#185fa5' },
  pptx: { label: 'PPT', bg: '#faece7', color: '#993c1d' },
  ppt:  { label: 'PPT', bg: '#faece7', color: '#993c1d' },
  docx: { label: 'DOC', bg: '#faeeda', color: '#633806' },
  doc:  { label: 'DOC', bg: '#faeeda', color: '#633806' }
};

function handleFiles(files) {
  const list = document.getElementById('file-list');
  const grid = document.getElementById('prev-materials');
  Array.from(files).forEach(f => {
    const ext  = f.name.split('.').pop().toLowerCase();
    const t    = typeMap[ext] || { label: ext.toUpperCase(), bg: '#f1efe8', color: '#5f5e5a' };
    const size = f.size > 1048576
      ? (f.size / 1048576).toFixed(1) + ' MB'
      : (f.size / 1024).toFixed(0) + ' KB';

    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <div class="file-icon" style="background:${t.bg};color:${t.color}">${t.label}</div>
      <span class="file-name">${escHtml(f.name)}</span>
      <span class="file-size">${size}</span>
      <span class="file-remove" onclick="removeFile(this)">Remove</span>`;
    list.appendChild(item);

    const tile = document.createElement('div');
    tile.className = 'material-tile';
    tile.innerHTML = `
      <div class="material-tile-icon" style="background:${t.bg};color:${t.color}">${t.label}</div>
      <div class="material-tile-name">${escHtml(f.name)}</div>
      <div class="material-tile-size">${size}</div>`;
    grid.appendChild(tile);

    document.getElementById('prev-file-count').textContent =
      document.getElementById('file-list').children.length;
  });
}

function removeFile(el) {
  el.closest('.file-item').remove();
  document.getElementById('prev-file-count').textContent =
    document.getElementById('file-list').children.length;
}

/* ── Drag and drop ── */
const dropZone = document.querySelector('.drop-zone');
if (dropZone) {
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.style.background = 'var(--bg-tertiary)';
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.style.background = 'var(--bg-secondary)';
  });
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.style.background = 'var(--bg-secondary)';
    handleFiles(e.dataTransfer.files);
  });
}

/* ══════════════════════════════════════════════════════════
   ADD USER FORM
══════════════════════════════════════════════════════════ */
function showMessage(text, type) {
  let msgDiv = document.getElementById('addUserMessage');
  if (!msgDiv) {
    const form = document.getElementById('addUserForm');
    if (!form) return;
    msgDiv = document.createElement('div');
    msgDiv.id = 'addUserMessage';
    msgDiv.style.marginTop = '12px';
    msgDiv.style.fontSize  = '13px';
    form.appendChild(msgDiv);
  }
  msgDiv.textContent   = text;
  msgDiv.className     = type === 'success' ? 'success-message' : 'error-message';
  msgDiv.style.display = 'block';
  setTimeout(() => { msgDiv.style.display = 'none'; }, 5000);
}

document.addEventListener('DOMContentLoaded', function () {
  const addUserForm = document.getElementById('addUserForm');
  if (!addUserForm) return;

  addUserForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const first_name    = document.getElementById('first_name').value.trim();
    const last_name     = document.getElementById('last_name').value.trim();
    const email         = document.getElementById('email').value.trim();
    const password      = document.getElementById('password').value;
    const id_number     = document.getElementById('id_number').value.trim();
    const phone         = document.getElementById('phone').value.trim();
    const gender        = document.getElementById('gender').value;
    const role          = document.getElementById('role').value;
    const status        = document.getElementById('status').value;
    const qualification = document.getElementById('qualification').value;

    if (!first_name || !last_name || !email || !password) {
      showMessage('Please fill all required fields.', 'error');
      return;
    }

    const submitBtn    = addUserForm.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled    = true;
    submitBtn.textContent = 'Saving…';

    try {
      const response = await fetch('/api/create-user', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ first_name, last_name, email, password, id_number, phone, gender, role, status, qualification })
      });
      const result = await response.json();
      if (result.success) {
        showMessage(' User created successfully!', 'success');
        addUserForm.reset();
      } else {
        showMessage(result.message, 'error');
      }
    } catch (err) {
      console.error('Fetch error:', err);
      showMessage('Could not connect to server. Is it running?', 'error');
    } finally {
      submitBtn.disabled    = false;
      submitBtn.textContent = originalText;
    }
  });
});

/* ══════════════════════════════════════════════════════════
   qualifications.js
   Handles all Qualification management:
     - Create qualification + units
     - View all qualifications (live table)
     - Update qualification (fields + per-unit editing)
     - Toggle active/draft status inline
     - Remove qualification (with active-enrolment guard)
     - Unit listing inside update panel
══════════════════════════════════════════════════════════ */

/* ── State ── */
let allQuals = [];

/* ════════════════════════════════════════════════════════
   SECTION INIT — called when the qualifications section opens
════════════════════════════════════════════════════════ */
function initQualSection() {
  populateQualSelects();
}

/* ════════════════════════════════════════════════════════
   FETCH helpers
════════════════════════════════════════════════════════ */
async function fetchQuals() {
  const res  = await fetch('/api/qualifications');
  const data = await res.json();
  if (!data.success) throw new Error(data.message);
  allQuals = data.qualifications;
  return allQuals;
}

/* ════════════════════════════════════════════════════════
   CREATE QUALIFICATION
   Handles #createQualForm submit
════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  const createForm = document.getElementById('createQualForm');
  if (createForm) {
    createForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn  = createForm.querySelector('button[type="submit"]');
      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Saving…';

      const payload = {
        title:           document.getElementById('cq-title').value.trim(),
        nqf_level:       document.getElementById('cq-nqf').value,
        seta:            document.getElementById('cq-seta').value.trim(),
        duration_months: document.getElementById('cq-duration').value,
        description:     document.getElementById('cq-desc').value.trim(),
        unit_count:      document.getElementById('cq-units').value,
        total_credits:   document.getElementById('cq-credits').value,
        is_active:       document.getElementById('cq-status').value === 'true',
      };

      try {
        const res  = await fetch('/api/qualifications', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        showQualMsg('create', '✓ Qualification created successfully.', 'success');
        createForm.reset();
        populateQualSelects(); // refresh selects in other panels
      } catch (err) {
        showQualMsg('create', 'Error: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = orig;
      }
    });
  }
});

/* ════════════════════════════════════════════════════════
   VIEW ALL QUALIFICATIONS  — live table
════════════════════════════════════════════════════════ */
async function refreshQualTable() {
  const tbody = document.querySelector('#all-qual table tbody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-secondary);font-size:13px">Loading…</td></tr>`;

  try {
    const quals = await fetchQuals();

    if (!quals.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-secondary);font-size:13px">No qualifications yet. Create one above.</td></tr>`;
      return;
    }

    tbody.innerHTML = quals.map(q => renderQualRow(q)).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--color-red);font-size:13px">Failed to load: ${err.message}</td></tr>`;
  }
}

function renderQualRow(q) {
  const statusBadge = q.is_active
    ? `<span class="badge badge-active">Active</span>`
    : `<span class="badge badge-inactive">Draft</span>`;

  const nqfBadge = q.nqf_level?.replace('NQF', '').trim()
    ? `<span class="badge badge-nqf${q.nqf_level.replace('NQF','').trim()}">${q.nqf_level}</span>`
    : `<span class="badge">${q.nqf_level}</span>`;

  return `
    <tr data-qual-id="${q.id}">
      <td>${escHtml(q.title)}</td>
      <td>${nqfBadge}</td>
      <td>${escHtml(q.seta)}</td>
      <td>${q.duration_months} mo</td>
      <td>${q.enrolled_count ?? 0}</td>
      <td>${statusBadge}</td>
      <td>
        <button class="btn btn-xs btn-blue" onclick="openUpdatePanel('${q.id}')">Edit</button>
        <button class="btn btn-xs" onclick="toggleQualStatus('${q.id}', ${!q.is_active})" title="${q.is_active ? 'Set to Draft' : 'Set to Active'}">
          ${q.is_active ? 'Draft' : 'Activate'}
        </button>
        <button class="btn btn-xs btn-red" onclick="confirmRemoveQual('${q.id}', '${escHtml(q.title)}')">Remove</button>
      </td>
    </tr>`;
}

/* ════════════════════════════════════════════════════════
   STATUS TOGGLE (inline from table)
════════════════════════════════════════════════════════ */
async function toggleQualStatus(qualId, newStatus) {
  try {
    const res  = await fetch(`/api/qualifications/${qualId}/status`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ is_active: newStatus }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    showQualTableMsg(data.message, 'success');
    await refreshQualTable();
  } catch (err) {
    showQualTableMsg('Failed: ' + err.message, 'error');
  }
}

/* ════════════════════════════════════════════════════════
   UPDATE QUALIFICATION PANEL
════════════════════════════════════════════════════════ */

/** Load a qualification into the update form */
async function openUpdatePanel(qualId) {
  // Make sure the update panel is open
  const panel = document.getElementById('update-qual');
  if (!panel) return;
  document.querySelectorAll('.content-area').forEach(el => el.classList.remove('visible'));
  panel.classList.add('visible');

  // Scroll to panel
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Show loading state
  const inner = document.getElementById('update-qual-inner');
  if (inner) inner.innerHTML = `<div style="padding:20px;color:var(--text-secondary);font-size:13px">Loading…</div>`;

  try {
    const res  = await fetch(`/api/qualifications/${qualId}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    renderUpdateForm(data.qualification, data.units);
  } catch (err) {
    if (inner) inner.innerHTML = `<div style="padding:20px;color:var(--color-red);font-size:13px">Failed to load: ${err.message}</div>`;
  }
}

function renderUpdateForm(q, units) {
  const inner = document.getElementById('update-qual-inner');
  if (!inner) return;

  const unitsHtml = (units || []).map(u => `
    <div class="unit-edit-row" data-unit-id="${u.id}">
      <div class="unit-edit-num">${u.unit_number}</div>
      <div class="unit-edit-fields">
        <input class="unit-title-input" type="text" value="${escHtml(u.title)}" placeholder="Unit title" style="font-size:12px;padding:4px 8px;border-radius:4px;border:1px solid var(--border);width:100%;margin-bottom:4px">
        <textarea class="unit-desc-input" placeholder="Description / outcomes" rows="2" style="font-size:11px;padding:4px 8px;border-radius:4px;border:1px solid var(--border);width:100%;resize:vertical">${escHtml(u.description || '')}</textarea>
      </div>
      <div class="unit-edit-credits">
        <input class="unit-credits-input" type="number" value="${u.credits || ''}" placeholder="Credits" min="0" style="font-size:12px;padding:4px 8px;border-radius:4px;border:1px solid var(--border);width:70px">
      </div>
    </div>
  `).join('');

  inner.innerHTML = `
    <input type="hidden" id="uq-id" value="${q.id}">
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Qualification title</label>
        <input type="text" id="uq-title" value="${escHtml(q.title)}" placeholder="Title">
      </div>
      <div class="form-group">
        <label class="form-label">SETA</label>
        <input type="text" id="uq-seta" value="${escHtml(q.seta)}" placeholder="e.g. MICT SETA">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Duration (months)</label>
        <input type="number" id="uq-duration" value="${q.duration_months}" min="1">
      </div>
      <div class="form-group">
        <label class="form-label">Status</label>
        <select id="uq-status">
          <option value="true"  ${q.is_active ? 'selected' : ''}>Active</option>
          <option value="false" ${!q.is_active ? 'selected' : ''}>Draft</option>
        </select>
      </div>
    </div>

    ${units?.length ? `
      <div style="margin:16px 0 8px">
        <div class="form-label" style="margin-bottom:8px">Units <span style="font-weight:400;color:var(--text-secondary)">(edit titles, descriptions &amp; credits)</span></div>
        <div id="units-edit-list">${unitsHtml}</div>
      </div>
    ` : ''}

    <div style="display:flex;gap:8px;align-items:center;margin-top:16px">
      <button class="btn btn-blue" onclick="saveQualUpdate()">Save changes</button>
      <button class="btn" onclick="cancelUpdatePanel()">Cancel</button>
    </div>
    <div id="update-qual-msg" style="margin-top:10px;font-size:13px;display:none"></div>
  `;
}

async function saveQualUpdate() {
  const qualId = document.getElementById('uq-id')?.value;
  if (!qualId) return;

  const payload = {
    title:           document.getElementById('uq-title')?.value.trim(),
    seta:            document.getElementById('uq-seta')?.value.trim(),
    duration_months: document.getElementById('uq-duration')?.value,
    is_active:       document.getElementById('uq-status')?.value === 'true',
    units: []
  };

  // Collect unit edits
  document.querySelectorAll('#units-edit-list .unit-edit-row').forEach(row => {
    payload.units.push({
      id:          row.dataset.unitId,
      title:       row.querySelector('.unit-title-input').value.trim(),
      description: row.querySelector('.unit-desc-input').value.trim(),
      credits:     parseInt(row.querySelector('.unit-credits-input').value, 10) || null,
    });
  });

  try {
    const res  = await fetch(`/api/qualifications/${qualId}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    const msgEl = document.getElementById('update-qual-msg');
    if (msgEl) {
      msgEl.textContent   = '✓ Qualification updated successfully.';
      msgEl.className     = 'success-message';
      msgEl.style.display = 'block';
      setTimeout(() => { msgEl.style.display = 'none'; }, 4000);
    }
    populateQualSelects(); // refresh dropdowns elsewhere
  } catch (err) {
    const msgEl = document.getElementById('update-qual-msg');
    if (msgEl) {
      msgEl.textContent   = 'Error: ' + err.message;
      msgEl.className     = 'error-message';
      msgEl.style.display = 'block';
    }
  }
}

function cancelUpdatePanel() {
  const panel = document.getElementById('update-qual');
  if (panel) panel.classList.remove('visible');
  const inner = document.getElementById('update-qual-inner');
  if (inner) inner.innerHTML = `<div style="padding:12px;color:var(--text-secondary);font-size:13px">Select a qualification from the table above to edit it.</div>`;
}

/* ════════════════════════════════════════════════════════
   REMOVE QUALIFICATION
════════════════════════════════════════════════════════ */

/** Populate the remove-qual <select> */
async function populateRemoveSelect() {
  const sel = document.getElementById('remove-qual-select');
  if (!sel) return;

  sel.innerHTML = `<option value="">Loading…</option>`;
  try {
    const quals = allQuals.length ? allQuals : await fetchQuals();
    sel.innerHTML = `<option value="">— Select qualification —</option>` +
      quals.map(q =>
        `<option value="${q.id}">${escHtml(q.title)} (${q.nqf_level})</option>`
      ).join('');
  } catch {
    sel.innerHTML = `<option value="">Failed to load</option>`;
  }
}

async function confirmRemoveQual(qualId, name) {
  if (!confirm(`Remove qualification "${name}"?\n\nAll units and uploaded materials will be permanently deleted.\nLearners with active enrolments cannot be removed — you will be warned.`)) return;

  try {
    const res  = await fetch(`/api/qualifications/${qualId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    showQualTableMsg(data.message, 'success');
    await refreshQualTable();
    populateQualSelects();
  } catch (err) {
    showQualTableMsg('Remove failed: ' + err.message, 'error');
  }
}

/** Handler for the Remove button inside the "Remove qualification" panel */
async function handleRemoveQualPanel() {
  const sel  = document.getElementById('remove-qual-select');
  const qualId = sel?.value;
  const name   = sel?.options[sel.selectedIndex]?.text;

  if (!qualId) {
    showQualMsg('remove', 'Please select a qualification to remove.', 'error');
    return;
  }
  await confirmRemoveQual(qualId, name);
}

/* ════════════════════════════════════════════════════════
   UPLOAD MATERIAL  — unit <select> population
════════════════════════════════════════════════════════ */
async function onUploadQualChange() {
  const qualId = document.getElementById('upload-qual-select')?.value;
  const unitSel = document.getElementById('upload-unit-select');
  if (!unitSel || !qualId) return;

  unitSel.innerHTML = `<option>Loading units…</option>`;
  try {
    const res  = await fetch(`/api/qualifications/${qualId}/units`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    if (!data.units.length) {
      unitSel.innerHTML = `<option value="">No units found</option>`;
      return;
    }
    unitSel.innerHTML = data.units.map(u =>
      `<option value="${u.id}">Unit ${u.unit_number} — ${escHtml(u.title)}</option>`
    ).join('');
  } catch (err) {
    unitSel.innerHTML = `<option>Failed to load units</option>`;
  }
}

/* ════════════════════════════════════════════════════════
   POPULATE all qual <select> dropdowns (create/upload/remove)
════════════════════════════════════════════════════════ */
async function populateQualSelects() {
  try {
    const quals = await fetchQuals();

    const options = quals.map(q =>
      `<option value="${q.id}">${escHtml(q.title)} (${q.nqf_level})</option>`
    ).join('');

    // Upload material qual select
    const uploadSel = document.getElementById('upload-qual-select');
    if (uploadSel) {
      uploadSel.innerHTML = `<option value="">— Select qualification —</option>` + options;
    }

    // Remove qual select
    const removeSel = document.getElementById('remove-qual-select');
    if (removeSel) {
      removeSel.innerHTML = `<option value="">— Select qualification —</option>` + options;
    }

    // Enrol qualification select in add-user form (already in server.js, keep in sync)
    const addUserQualSel = document.getElementById('qualification');
    if (addUserQualSel) {
      addUserQualSel.innerHTML = `<option value="">— None —</option>` +
        quals.map(q => `<option value="${escHtml(q.title)}">${escHtml(q.title)}</option>`).join('');
    }
  } catch (err) {
    console.warn('populateQualSelects:', err);
  }
}

/* ════════════════════════════════════════════════════════
   OVERRIDE toggleArea to hook qual-specific actions
════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════
   MESSAGE helpers
════════════════════════════════════════════════════════ */
function showQualMsg(panel, text, type) {
  const id = `qual-msg-${panel}`;
  let el   = document.getElementById(id);
  if (!el) {
    el    = document.createElement('div');
    el.id = id;
    el.style.cssText = 'margin:8px 0;font-size:13px;padding:8px 12px;border-radius:6px;';
    const form = document.getElementById(`createQualForm`) ||
                 document.getElementById(`qual-${panel}-area`);
    if (form) form.appendChild(el);
  }
  el.textContent   = text;
  el.className     = type === 'success' ? 'success-message' : 'error-message';
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function showQualTableMsg(text, type) {
  let el = document.getElementById('qual-table-msg');
  if (!el) {
    el    = document.createElement('div');
    el.id = 'qual-table-msg';
    el.style.cssText = 'margin:8px 0;font-size:13px;padding:8px 12px;border-radius:6px;';
    const area = document.getElementById('all-qual');
    if (area) area.prepend(el);
  }
  el.textContent   = text;
  el.className     = type === 'success' ? 'success-message' : 'error-message';
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
}