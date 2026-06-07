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
  const isOpen = target.classList.contains('visible');
  document.querySelectorAll('.content-area').forEach(el => el.classList.remove('visible'));

  const pwBtn = document.getElementById('pw-gen-btn');
  if (pwBtn) {
    pwBtn.style.display = (!isOpen && id === 'add-user') ? 'inline-flex' : 'none';
  }

  if (!isOpen) {
    target.classList.add('visible');
    // Auto-load users table when "View all users" is opened
    if (id === 'all-users') refreshUserTable();
    // Auto-load selects for modify/remove panels
    if (id === 'modify-user' || id === 'remove-user') populateUserSelects();
  }
}

/* ── Open password generator in new tab ── */
function openPasswordGenerator() {
  window.open('password_generator.html', '_blank', 'width=560,height=620,resizable=yes');
}

/* ── Logout placeholder ── */
function handleLogout() {
  if (confirm('Are you sure you want to log out?')) {
    alert('Logged out. Redirect to login page here.');
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