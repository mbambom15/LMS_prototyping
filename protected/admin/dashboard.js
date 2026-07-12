/* ── Section navigation ── */
function showSection(name, el) {
  document.querySelectorAll('.section-page').forEach(s => s.classList.remove('visible'));
  document.getElementById('section-' + name).classList.add('visible');
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  if (el) el.classList.add('active');
  if (name === 'dashboard') loadDashboardData();
}

/* ══════════════════════════════════════════════════════════
   DASHBOARD OVERVIEW — live KPI stats + recent activity
   Backed by GET /api/dashboard/stats and /api/dashboard/activity
   (admin_dashboard_stats / admin_recent_activity SQL views).
══════════════════════════════════════════════════════════ */
const ACTIVITY_COLORS = {
  submission: '#185fa5',
  graded: '#185fa5',
  risk: '#e24b4a',
  material: '#ba7517',
  feedback: '#1d9e75',
};

/** Load both the KPI cards and the activity feed together */
async function loadDashboardData() {
  await Promise.all([loadDashboardStats(), loadRecentActivity()]);
}

/** Fetch /api/dashboard/stats and populate the four stat cards */
async function loadDashboardStats() {
  try {
    const res = await fetch('/api/dashboard/stats');
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    renderDashboardStats(data.stats);
  } catch (err) {
    console.error('loadDashboardStats:', err);
    ['total-users', 'active-learners', 'qualifications', 'completion-rate'].forEach(id => {
      const valEl = document.getElementById(`stat-${id}`);
      const subEl = document.getElementById(`stat-${id}-sub`);
      if (valEl) valEl.textContent = '—';
      if (subEl) { subEl.textContent = 'Failed to load'; subEl.classList.remove('up'); }
    });
  }
}

function renderDashboardStats(s) {
  const newUsers = Number(s.new_users_this_month) || 0;
  setStatValue('stat-total-users', s.total_users ?? 0);
  setStatSub('stat-total-users-sub',
    `${newUsers > 0 ? '▲ ' : ''}${newUsers} this month`, newUsers > 0);

  const programmes = Number(s.active_programmes) || 0;
  setStatValue('stat-active-learners', s.active_learners ?? 0);
  setStatSub('stat-active-learners-sub',
    `Across ${programmes} programme${programmes === 1 ? '' : 's'}`);

  setStatValue('stat-qualifications', s.total_qualifications ?? 0);
  setStatSub('stat-qualifications-sub',
    `${s.active_qualifications ?? 0} active, ${s.draft_qualifications ?? 0} draft`);

  const rate = s.completion_rate_pct != null ? `${s.completion_rate_pct}%` : '—';
  setStatValue('stat-completion-rate', rate);
  setStatSub('stat-completion-rate-sub',
    `${s.completed_enrolments ?? 0} of ${s.total_enrolments ?? 0} enrolments completed`);
}

function setStatValue(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setStatSub(id, text, isUp) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('up', !!isUp);
}

/** Fetch /api/dashboard/activity and render the recent activity feed */
async function loadRecentActivity() {
  const list = document.getElementById('activity-list');
  if (!list) return;

  try {
    const res = await fetch('/api/dashboard/activity?limit=10');
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    if (!data.activity.length) {
      list.innerHTML = `<div class="activity-item"><div><div class="activity-text">No recent activity yet.</div></div></div>`;
      return;
    }

    list.innerHTML = data.activity.map(a => `
      <div class="activity-item">
        <div class="activity-dot" style="background:${ACTIVITY_COLORS[a.activity_type] || '#5f5e5a'}"></div>
        <div>
          <div class="activity-text">${escHtml(a.description)}</div>
          <div class="activity-time">${timeAgo(a.occurred_at)}</div>
        </div>
      </div>`).join('');
  } catch (err) {
    console.error('loadRecentActivity:', err);
    list.innerHTML = `<div class="activity-item"><div><div class="activity-text" style="color:var(--color-red)">Failed to load recent activity.</div></div></div>`;
  }
}

/** Turn an ISO timestamp into "10 min ago" / "2 hrs ago" / "Yesterday" etc. */
function timeAgo(isoString) {
  if (!isoString) return '';
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));

  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr${diffHr === 1 ? '' : 's'} ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay} days ago`;
  return new Date(isoString).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* Load the dashboard the moment the page is ready, since the
   Dashboard tab is visible by default before any sidebar click. */
document.addEventListener('DOMContentLoaded', loadDashboardData);

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
    if (id === 'add-user') populateQualSelects();

    // Qualification‑related triggers (merged from the old second function)
    if (id === 'all-qual') refreshQualTable();
    if (id === 'remove-qual') populateRemoveSelect();
    if (id === 'upload-material') populateUploadQualSelect();

    if (id === 'all-deals') refreshDealTable();
    if (id === 'add-deal') initDealSection();
    if (id === 'assign-facilitators') refreshFacilitatorAssignment();
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

const ROLES = ['learner', 'facilitator', 'assessor', 'grader', 'admin'];
const STATUSES = ['active', 'inactive', 'suspended', 'completed'];

const badgeClass = {
  active: 'badge-active',
  inactive: 'badge-inactive',
  suspended: 'badge-suspended',
  completed: 'badge-completed',
};

/** Fetch all users from the API and re-render the table body */
async function refreshUserTable() {
  const tbody = document.querySelector('#all-users table tbody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-secondary);font-size:13px">Loading users…</td></tr>`;

  try {
    const res = await fetch('/api/users');
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
  const name = [u.name, u.surname].filter(Boolean).join(' ') || '—';
  const badge = badgeClass[u.status] || 'badge-inactive';
  const qual = u.qualification || '—';

  return `
    <tr data-id="${u.user_id}" data-role="${u.role}" data-status="${u.status}">
      <td>${escHtml(name)}</td>
      <td>${escHtml(u.email)}</td>
      <td><span class="badge badge-role">${escHtml(u.role)}</span></td>
      <td>${escHtml(qual)}</td>
      <td><span class="badge ${badge}">${escHtml(u.status)}</span></td>
      <td>
        <button class="btn btn-xs btn-blue" onclick="enterEditMode(this)">Edit</button>
        <button class="btn btn-xs" onclick="sendUserDetails('${u.user_id}', '${escHtml(u.email)}')">Send details</button>
        <button class="btn btn-xs btn-red"  onclick="confirmDeleteUser('${u.user_id}', '${escHtml(name)}')">Remove</button>
      </td>
    </tr>`;
}

/** Switch a row into inline-edit mode */
function enterEditMode(btn) {
  const row = btn.closest('tr');
  const userId = row.dataset.id;
  const cells = row.querySelectorAll('td');

  // Read current values from data attributes or cell text
  const currentRole = row.dataset.role;
  const currentStatus = row.dataset.status;

  // col 2 → role selector, col 4 → status selector
  cells[2].innerHTML = selectHtml('role-select', ROLES, currentRole);
  cells[4].innerHTML = selectHtml('status-select', STATUSES, currentStatus);

  // Replace action buttons
  cells[5].innerHTML = `
    <button class="btn btn-xs btn-green" onclick="saveUserEdit('${userId}', this)">Save</button>
    <button class="btn btn-xs"           onclick="cancelEditMode(this)">Cancel</button>`;
}

/** Save the inline edit via PUT /api/users/:id */
async function saveUserEdit(userId, btn) {
  const row = btn.closest('tr');
  const roleSelect = row.querySelector('.role-select');
  const statusSelect = row.querySelector('.status-select');
  const newRole = roleSelect.value;
  const newStatus = statusSelect.value;

  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const res = await fetch(`/api/users/${userId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole, status: newStatus })
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
    const res = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
    const data = await res.json();

    if (!data.success) throw new Error(data.message);

    showTableMessage(`"${name}" has been removed.`, 'success');
    await refreshUserTable();

  } catch (err) {
    console.error('confirmDeleteUser:', err);
    showTableMessage('Remove failed: ' + err.message, 'error');
  }
}
async function sendUserDetails(userId, email) {
  if (!confirm(`Send login details to ${email}?\n\nThis resets their password to a new temporary one and emails it to them.`)) return;

  try {
    const res = await fetch(`/api/users/${userId}/send-details`, { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    showTableMessage(data.message, 'success');
  } catch (err) {
    console.error('sendUserDetails:', err);
    showTableMessage('Send failed: ' + err.message, 'error');
  }
}

/* ── Populate the modify-user and remove-user <select>s ── */
async function populateUserSelects() {
  try {
    const res = await fetch('/api/users');
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
  el.className = type === 'success' ? 'success-message' : 'error-message';
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
   qualifications.js
   Handles all Qualification management:
     - Create qualification + units
     - View all qualifications (live table)
     - Update qualification (fields + per-unit editing)
     - Toggle active/draft status inline
     - Remove qualification (with active-enrolment guard)
     - Unit listing inside update panel
     - Unit-standard cap enforcement (stipulated_units on qualifications)
     - Material upload (qual → unit → Azure Blob) with staged
       file list — files are only sent to the server when the
       admin clicks "Upload files", not on selection/drop.
══════════════════════════════════════════════════════════ */

/* ── State ── */
let allQuals = [];
let currentUploadUnitId = null; // tracks which unit the upload-material panel is targeting

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
  const res = await fetch('/api/qualifications');
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
      const btn = createForm.querySelector('button[type="submit"]');
      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Saving…';

      const payload = {
        title: document.getElementById('cq-title').value.trim(),
        nqf_level: document.getElementById('cq-nqf').value,
        seta: document.getElementById('cq-seta').value.trim(),
        duration_months: document.getElementById('cq-duration').value,
        description: document.getElementById('cq-desc').value.trim(),
        unit_count: document.getElementById('cq-units').value,
        total_credits: document.getElementById('cq-credits').value,
        is_active: document.getElementById('cq-status').value === 'true',
      };

      try {
        const res = await fetch('/api/qualifications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
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
    ? `<span class="badge badge-nqf${q.nqf_level.replace('NQF', '').trim()}">${q.nqf_level}</span>`
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
    const res = await fetch(`/api/qualifications/${qualId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: newStatus }),
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
   Includes the unit-standard cap (stipulated_units) control
   and the "+ Add unit standard" action, which is the only
   supported way to add units beyond what was set at creation.
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
    const res = await fetch(`/api/qualifications/${qualId}`);
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

  const unitCount = units?.length || 0;
  const cap = q.stipulated_units;

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

    <div style="margin:16px 0 8px">
      <div class="form-label" style="margin-bottom:8px">Units <span style="font-weight:400;color:var(--text-secondary)">(edit titles, descriptions &amp; credits)</span></div>

      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:10px 12px;background:var(--bg-secondary);border-radius:6px">
        <span style="font-size:12px;color:var(--text-secondary)">
          Unit standards: <strong style="color:var(--text-primary)">${unitCount}</strong> / <strong style="color:var(--text-primary)">${cap ?? '—'}</strong> stipulated
        </span>
        <div style="margin-left:auto;display:flex;gap:8px;align-items:center">
          <label class="form-label" style="margin:0;font-size:11px">Cap</label>
          <input type="number" id="uq-unit-cap" value="${cap ?? ''}" min="${unitCount}" style="width:64px;font-size:12px;padding:3px 6px">
          <button class="btn btn-xs" onclick="saveUnitCap('${q.id}')">Update cap</button>
          <button class="btn btn-xs btn-blue" onclick="addUnitPrompt('${q.id}')">+ Add unit standard</button>
        </div>
      </div>

      ${units?.length ? `<div id="units-edit-list">${unitsHtml}</div>` : `<div style="padding:10px;color:var(--text-tertiary);font-size:12px">No unit standards yet. Use "+ Add unit standard" above.</div>`}
    </div>

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
    title: document.getElementById('uq-title')?.value.trim(),
    seta: document.getElementById('uq-seta')?.value.trim(),
    duration_months: document.getElementById('uq-duration')?.value,
    is_active: document.getElementById('uq-status')?.value === 'true',
    units: []
  };

  // Collect unit edits
  document.querySelectorAll('#units-edit-list .unit-edit-row').forEach(row => {
    payload.units.push({
      id: row.dataset.unitId,
      title: row.querySelector('.unit-title-input').value.trim(),
      description: row.querySelector('.unit-desc-input').value.trim(),
      credits: parseInt(row.querySelector('.unit-credits-input').value, 10) || null,
    });
  });

  try {
    const res = await fetch(`/api/qualifications/${qualId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    const msgEl = document.getElementById('update-qual-msg');
    if (msgEl) {
      msgEl.textContent = '✓ Qualification updated successfully.';
      msgEl.className = 'success-message';
      msgEl.style.display = 'block';
      setTimeout(() => { msgEl.style.display = 'none'; }, 4000);
    }
    populateQualSelects(); // refresh dropdowns elsewhere
  } catch (err) {
    const msgEl = document.getElementById('update-qual-msg');
    if (msgEl) {
      msgEl.textContent = 'Error: ' + err.message;
      msgEl.className = 'error-message';
      msgEl.style.display = 'block';
    }
  }
}

/** Raise/lower the stipulated unit cap. Server rejects a cap below the
 *  number of unit standards that already exist for this qualification. */
async function saveUnitCap(qualId) {
  const input = document.getElementById('uq-unit-cap');
  const val = parseInt(input?.value, 10);
  if (Number.isNaN(val)) return;

  try {
    const res = await fetch(`/api/qualifications/${qualId}/unit-cap`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stipulated_units: val }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    await openUpdatePanel(qualId); // reload with fresh cap/count
  } catch (err) {
    alert(err.message);
  }
}

/** Add a new unit standard — server enforces the stipulated cap and
 *  returns an error message if the qualification is already at capacity. */
async function addUnitPrompt(qualId) {
  const title = prompt('New unit standard title:');
  if (!title || !title.trim()) return;

  try {
    const res = await fetch(`/api/qualifications/${qualId}/units`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim() }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    await openUpdatePanel(qualId); // reload to show the new unit row
  } catch (err) {
    alert(err.message); // surfaces the cap-reached message from the server
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
    const res = await fetch(`/api/qualifications/${qualId}`, { method: 'DELETE' });
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
  const sel = document.getElementById('remove-qual-select');
  const qualId = sel?.value;
  const name = sel?.options[sel.selectedIndex]?.text;

  if (!qualId) {
    showQualMsg('remove', 'Please select a qualification to remove.', 'error');
    return;
  }
  await confirmRemoveQual(qualId, name);
}

/* ════════════════════════════════════════════════════════
   UPLOAD MATERIAL PANEL
   Qualification <select> is populated from the database
   (populateUploadQualSelect), which then loads that
   qualification's real units (onUploadQualChange). Files are
   staged locally when chosen/dropped, then uploaded to Azure
   Blob Storage via POST /api/units/:unitId/materials only
   when the admin clicks the "Upload files" button. A SAS URL
   is returned for each already-stored file so it can be
   opened immediately from the preview list.
════════════════════════════════════════════════════════ */

/** Populate the qualification <select> in the upload-material panel
 *  from the live database list (mirrors populateRemoveSelect). */
async function populateUploadQualSelect() {
  const sel = document.getElementById('upload-qual-select');
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
  // Reset the unit select and any stale file list until a qualification is chosen
  const unitSel = document.getElementById('upload-unit-select');
  if (unitSel) unitSel.innerHTML = `<option value="">Select a qualification first</option>`;
  currentUploadUnitId = null;
  clearMaterialFileList();
}

/** Load the real units for the chosen qualification into the unit <select>. */
async function onUploadQualChange() {
  const qualId = document.getElementById('upload-qual-select')?.value;
  const unitSel = document.getElementById('upload-unit-select');
  if (!unitSel) return;

  currentUploadUnitId = null;
  clearMaterialFileList();

  if (!qualId) {
    unitSel.innerHTML = `<option value="">Select a qualification first</option>`;
    return;
  }

  unitSel.innerHTML = `<option>Loading units…</option>`;
  try {
    const res = await fetch(`/api/qualifications/${qualId}/units`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    if (!data.units.length) {
      unitSel.innerHTML = `<option value="">No unit standards found — add one under "Update"</option>`;
      return;
    }
    unitSel.innerHTML = `<option value="">— Select unit —</option>` + data.units.map(u =>
      `<option value="${u.id}">Unit ${u.unit_number} — ${escHtml(u.title)}</option>`
    ).join('');
  } catch (err) {
    unitSel.innerHTML = `<option>Failed to load units</option>`;
  }
}

/** Track which unit is currently targeted, and load its existing
 *  materials into the preview list so admins can see what's already there. */
async function onUploadUnitChange() {
  const unitId = document.getElementById('upload-unit-select')?.value;
  currentUploadUnitId = unitId || null;
  clearMaterialFileList();
  if (!unitId) return;
  await loadExistingMaterials(unitId);
}

/** Clear both the staged (not-yet-uploaded) files and the visible
 *  file list, and hide the "Upload files / Clear" action row. */
function clearMaterialFileList() {
  const list = document.getElementById('file-list');
  if (list) list.innerHTML = '';
  const existing = document.getElementById('existing-materials-list');
  if (existing) existing.innerHTML = `<div style="padding:10px;color:var(--text-tertiary);font-size:12px">Select a unit to see its materials.</div>`;
  stagedFiles = [];
  const actions = document.getElementById('upload-actions');
  if (actions) actions.style.display = 'none';
}
/** Show materials already uploaded for this unit, each linking to a
/** Show materials already uploaded for this unit, with Edit / Replace / Delete
 *  actions. Kept in its own container (#existing-materials-list) so it never
 *  mixes with the staged (not-yet-uploaded) file list. */
async function loadExistingMaterials(unitId) {
  const list = document.getElementById('existing-materials-list');
  if (!list) return;

  list.innerHTML = `<div style="padding:10px;color:var(--text-secondary);font-size:12px">Loading materials…</div>`;

  try {
    const res = await fetch(`/api/units/${unitId}/materials`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    if (!data.materials.length) {
      list.innerHTML = `<div style="padding:10px;color:var(--text-tertiary);font-size:12px">No materials uploaded for this unit yet.</div>`;
      return;
    }

    list.innerHTML = data.materials.map(m => renderMaterialRow(m)).join('');
  } catch (err) {
    list.innerHTML = `<div style="padding:10px;color:var(--color-red);font-size:12px">Failed to load materials: ${escHtml(err.message)}</div>`;
  }
}

function renderMaterialRow(m) {
  const ext = (m.file_name.split('.').pop() || '').toLowerCase();
  const t = typeMap[ext] || { label: ext.toUpperCase(), bg: '#f1efe8', color: '#5f5e5a' };
  const size = m.file_size_bytes > 1048576
    ? (m.file_size_bytes / 1048576).toFixed(1) + ' MB'
    : ((m.file_size_bytes || 0) / 1024).toFixed(0) + ' KB';

  return `
    <div class="material-row" data-material-id="${m.id}" data-title="${escHtml(m.title || m.file_name)}" data-desc="${escHtml(m.description || '')}">
      <div class="file-icon" style="background:${t.bg};color:${t.color}">${t.label}</div>
      <div class="material-info">
        <a class="material-title" href="${m.url}" target="_blank" rel="noopener">${escHtml(m.title || m.file_name)}</a>
        <div class="material-meta">${escHtml(m.file_name)} · ${size}${m.description ? ' · ' + escHtml(m.description) : ''}</div>
      </div>
      <div class="material-actions">
        <button class="btn btn-xs" onclick="editMaterial(this)">Edit</button>
        <button class="btn btn-xs" onclick="triggerReplaceMaterial(${m.id})">Replace</button>
        <button class="btn btn-xs btn-red" onclick="deleteMaterial(${m.id}, '${escHtml(m.title || m.file_name)}')">Delete</button>
      </div>
    </div>`;
}

/** Switch a material row into inline-edit mode (title + description) */
function editMaterial(btn) {
  const row = btn.closest('.material-row');
  const info = row.querySelector('.material-info');
  const currentTitle = row.dataset.title;
  const currentDesc = row.dataset.desc;

  info.innerHTML = `
    <input type="text" class="material-edit-title" value="${escHtml(currentTitle)}"
      style="font-size:13px;padding:4px 8px;border-radius:4px;border:1px solid var(--border);width:100%;margin-bottom:4px">
    <textarea class="material-edit-desc" rows="2"
      style="font-size:11px;padding:4px 8px;border-radius:4px;border:1px solid var(--border);width:100%;resize:vertical">${escHtml(currentDesc)}</textarea>`;

  row.querySelector('.material-actions').innerHTML = `
    <button class="btn btn-xs btn-green" onclick="saveMaterialEdit(this)">Save</button>
    <button class="btn btn-xs" onclick="loadExistingMaterials(currentUploadUnitId)">Cancel</button>`;
}

/** Save an edited title/description via PATCH /api/materials/:id */
async function saveMaterialEdit(btn) {
  const row = btn.closest('.material-row');
  const materialId = row.dataset.materialId;
  const title = row.querySelector('.material-edit-title').value.trim();
  const description = row.querySelector('.material-edit-desc').value.trim();

  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const res = await fetch(`/api/materials/${materialId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    await loadExistingMaterials(currentUploadUnitId);
  } catch (err) {
    alert('Update failed: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

/** Permanently delete a material (blob + DB row) via DELETE /api/materials/:id */
async function deleteMaterial(materialId, name) {
  if (!confirm(`Delete "${name}"?\n\nThis permanently removes the file from storage.`)) return;
  try {
    const res = await fetch(`/api/materials/${materialId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    await loadExistingMaterials(currentUploadUnitId);
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}

/** Open a one-off file picker for replacing a single material's underlying file */
function triggerReplaceMaterial(materialId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.doc,.docx,.ppt,.pptx,.mp4';
  input.onchange = () => {
    if (input.files.length) replaceMaterialFile(materialId, input.files[0]);
  };
  input.click();
}

/** Upload the replacement file via POST /api/materials/:id/replace */
async function replaceMaterialFile(materialId, file) {
  const row = document.querySelector(`.material-row[data-material-id="${materialId}"]`);
  const actions = row?.querySelector('.material-actions');
  if (actions) actions.innerHTML = `<span style="font-size:11px;color:var(--text-tertiary)">Replacing…</span>`;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch(`/api/materials/${materialId}/replace`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    await loadExistingMaterials(currentUploadUnitId);
  } catch (err) {
    alert('Replace failed: ' + err.message);
    await loadExistingMaterials(currentUploadUnitId);
  }
}

/* ════════════════════════════════════════════════════════
   POPULATE all qual <select> dropdowns (create/remove/add-user)
   Note: the upload-material qual select is handled separately
   by populateUploadQualSelect() so it always reflects the live
   qualification list the moment its panel is opened.
════════════════════════════════════════════════════════ */
async function populateQualSelects() {
  try {
    const quals = await fetchQuals();

    // Remove qual select
    const removeSel = document.getElementById('remove-qual-select');
    if (removeSel) {
      removeSel.innerHTML = `<option value="">— Select qualification —</option>` +
        quals.map(q => `<option value="${q.id}">${escHtml(q.title)} (${q.nqf_level})</option>`).join('');
    }

    // Enrol qualification select in add-user form (already in server.js, keep in sync)
    const addUserQualSel = document.getElementById('qualification');
    if (addUserQualSel) {
      addUserQualSel.innerHTML = `<option value="">— None —</option>` +
        quals.map(q => `<option value="${q.id}">${escHtml(q.title)}</option>`).join('');
    }
  } catch (err) {
    console.warn('populateQualSelects:', err);
  }
}

/* ════════════════════════════════════════════════════════
   MESSAGE helpers
════════════════════════════════════════════════════════ */
function showQualMsg(panel, text, type) {
  const id = `qual-msg-${panel}`;
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.style.cssText = 'margin:8px 0;font-size:13px;padding:8px 12px;border-radius:6px;';
    const form = document.getElementById(`createQualForm`) ||
      document.getElementById(`qual-${panel}-area`) ||
      document.getElementById('upload-material');
    if (form) form.appendChild(el);
  }
  el.textContent = text;
  el.className = type === 'success' ? 'success-message' : 'error-message';
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function showQualTableMsg(text, type) {
  let el = document.getElementById('qual-table-msg');
  if (!el) {
    el = document.createElement('div');
    el.id = 'qual-table-msg';
    el.style.cssText = 'margin:8px 0;font-size:13px;padding:8px 12px;border-radius:6px;';
    const area = document.getElementById('all-qual');
    if (area) area.prepend(el);
  }
  el.textContent = text;
  el.className = type === 'success' ? 'success-message' : 'error-message';
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
}

/* ══════════════════════════════════════════════════════════
   FILE UPLOAD  (upload-material panel)
   NEW BEHAVIOUR: handleFiles() now only STAGES files chosen or
   dropped into memory (stagedFiles) and renders them with a
   "Pending" status + a remove (✕) button. Nothing is sent to
   the server until the admin clicks the "Upload files" button,
   which calls submitMaterialUpload() — that's the only place
   POST /api/units/:unitId/materials is actually called.
   The #upload-status-banner + .upload-spinner (already styled
   in admin.html) light up while the batch is in flight.
══════════════════════════════════════════════════════════ */
const typeMap = {
  pdf: { label: 'PDF', bg: '#fcebeb', color: '#a32d2d' },
  mp4: { label: 'MP4', bg: '#e6f1fb', color: '#185fa5' },
  pptx: { label: 'PPT', bg: '#faece7', color: '#993c1d' },
  ppt: { label: 'PPT', bg: '#faece7', color: '#993c1d' },
  docx: { label: 'DOC', bg: '#faeeda', color: '#633806' },
  doc: { label: 'DOC', bg: '#faeeda', color: '#633806' }
};

/** Files picked/dropped but not yet uploaded */
let stagedFiles = [];

/** Add newly picked/dropped files to the staging list and re-render.
 *  Requires a qualification + unit to already be selected, same
 *  guard as before — just no network call happens here anymore. */
function handleFiles(files) {
  if (!currentUploadUnitId) {
    showQualMsg('upload', 'Select a qualification and unit standard first.', 'error');
    const input = document.getElementById('file-input');
    if (input) input.value = '';
    return;
  }
  stagedFiles.push(...Array.from(files));
  renderStagedFiles();
  const input = document.getElementById('file-input');
  if (input) input.value = '';
}

/** Render the staged (pending) file list with remove buttons,
 *  and show/hide the Upload/Clear action row accordingly. */
function renderStagedFiles() {
  const list = document.getElementById('file-list');
  const actions = document.getElementById('upload-actions');
  if (!list) return;

  list.innerHTML = stagedFiles.map((f, i) => {
    const ext = f.name.split('.').pop().toLowerCase();
    const t = typeMap[ext] || { label: ext.toUpperCase(), bg: '#f1efe8', color: '#5f5e5a' };
    const size = f.size > 1048576
      ? (f.size / 1048576).toFixed(1) + ' MB'
      : (f.size / 1024).toFixed(0) + ' KB';
    return `
      <div class="file-item" data-idx="${i}">
        <div class="file-icon" style="background:${t.bg};color:${t.color}">${t.label}</div>
        <span class="file-name">${escHtml(f.name)}</span>
        <span class="file-size">${size}</span>
        <span class="file-status" style="font-size:11px;color:var(--text-tertiary)">Pending</span>
        <button type="button" class="btn btn-xs" onclick="removeStagedFile(${i})">✕</button>
      </div>`;
  }).join('');

  if (actions) actions.style.display = stagedFiles.length ? 'flex' : 'none';
}

/** Remove a single staged file before it's uploaded */
function removeStagedFile(i) {
  stagedFiles.splice(i, 1);
  renderStagedFiles();
}

/** Clear all staged files without uploading anything */
function clearStagedFiles() {
  stagedFiles = [];
  renderStagedFiles();
}

/** Actually upload every staged file — called by the "Upload files"
 *  button. Uploads sequentially so per-file status updates read
 *  cleanly; shows the overall spinner banner while running. */
async function submitMaterialUpload() {
  if (!currentUploadUnitId || !stagedFiles.length) return;

  const banner = document.getElementById('upload-status-banner');
  const btn = document.getElementById('submit-upload-btn');
  const description = document.getElementById('desc-input')?.value || '';

  if (btn) btn.disabled = true;
  if (banner) {
    banner.style.display = 'flex';
    banner.innerHTML = `<div class="upload-spinner"></div><span>Uploading ${stagedFiles.length} file(s)…</span>`;
  }

  const items = document.querySelectorAll('#file-list .file-item');
  let successCount = 0;

  for (let i = 0; i < stagedFiles.length; i++) {
    const f = stagedFiles[i];
    const statusEl = items[i]?.querySelector('.file-status');
    if (statusEl) statusEl.textContent = 'Uploading…';

    const formData = new FormData();
    formData.append('file', f);
    formData.append('title', f.name);
    formData.append('description', description);

    try {
      const res = await fetch(`/api/units/${currentUploadUnitId}/materials`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);

      if (statusEl) {
        statusEl.textContent = 'Uploaded ✓';
        statusEl.style.color = 'var(--color-green, #1d9e75)';
      }
      successCount++;
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = 'Failed: ' + err.message;
        statusEl.style.color = 'var(--color-red)';
      }
    }
  }

  if (banner) {
    banner.innerHTML = `<span>${successCount} of ${stagedFiles.length} file(s) uploaded successfully.</span>`;
    setTimeout(() => { banner.style.display = 'none'; }, 4000);
  }
  if (btn) btn.disabled = false;

  stagedFiles = [];
  await loadExistingMaterials(currentUploadUnitId);
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
    msgDiv.style.fontSize = '13px';
    form.appendChild(msgDiv);
  }
  msgDiv.textContent = text;
  msgDiv.className = type === 'success' ? 'success-message' : 'error-message';
  msgDiv.style.display = 'block';
  setTimeout(() => { msgDiv.style.display = 'none'; }, 5000);
}

document.addEventListener('DOMContentLoaded', function () {
  const addUserForm = document.getElementById('addUserForm');
  if (!addUserForm) return;

  // Show schedule fields only when role = learner
  const roleSelect = document.getElementById('role');
  const scheduleRow = document.getElementById('schedule-row');
  function syncScheduleVisibility() {
    if (!roleSelect || !scheduleRow) return;
    scheduleRow.style.display = roleSelect.value === 'learner' ? 'flex' : 'none';
  }
  if (roleSelect) {
    roleSelect.addEventListener('change', syncScheduleVisibility);
    syncScheduleVisibility(); // run once on load — role defaults to "learner"
  }
  addUserForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const first_name = document.getElementById('first_name').value.trim();
    const last_name = document.getElementById('last_name').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const id_number = document.getElementById('id_number').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const gender = document.getElementById('gender').value;
    const role = document.getElementById('role').value;
    const status = document.getElementById('status').value;
    const qualification = document.getElementById('qualification').value;
    const schedule_day_1 = document.getElementById('schedule_day_1')?.value || '';
    const schedule_day_2 = document.getElementById('schedule_day_2')?.value || '';

    if (!first_name || !last_name || !email || !password) {
      showMessage('Please fill all required fields.', 'error');
      return;
    }

    if (role === 'learner' && schedule_day_1 === '') {
      showMessage('Please select at least one attendance day for this learner.', 'error');
      return;
    }

    const submitBtn = addUserForm.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';

    try {
      const response = await fetch('/api/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name, last_name, email, password, id_number, phone, gender, role, status, qualification, schedule_day_1, schedule_day_2 })
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
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });
});

/* ══════════════════════════════════════════════════════════
   deals.js  — Nkanyezi LMS Admin
   Deal management: create, view, detail drawer, link learners,
   inline row editing (sponsor / qualification / status),
   facilitator assignment
══════════════════════════════════════════════════════════ */

/* ── State ── */
let dealLearnerPool = [];   // all available learners fetched once
let selectedLearners = new Set(); // UUIDs chosen for linking
let dealQualOptionsCache = []; // cached qualification list for edit-mode <select>s
let facilitatorPool = [];        // cached facilitators with deal counts (assign panel)
let facilitatorOverviewDeals = []; // deals with facilitator info (assign panel)

const DEAL_REG_STATUSES = [
  'Registered',
  'Pending',
  'Not registered',
  'In progress',
  'Verification with SETA',
  'Inactive',
  'Expired',
];

/* ════════════════════════════════════════════════════════
   BOOTSTRAP  — auto-populate deal number when panel opens
════════════════════════════════════════════════════════ */
async function initDealSection() {
  await populateDealQualSelect();
  await prefillDealNumber();
}

async function prefillDealNumber() {
  try {
    const res = await fetch('/api/deals/next-number');
    const data = await res.json();
    if (data.success) {
      const el = document.getElementById('cd-number');
      if (el && !el.value) el.value = data.next_number;
    }
  } catch { /* silent */ }
}

async function populateDealQualSelect() {
  try {
    const res = await fetch('/api/qualifications');
    const data = await res.json();
    if (!data.success) return;

    dealQualOptionsCache = data.qualifications; // cache for inline edit rows too

    const options = `<option value="">— None —</option>` +
      data.qualifications.map(q =>
        `<option value="${q.id}">${escHtml(q.title)} (${q.nqf_level})</option>`
      ).join('');

    ['cd-qual', 'ld-qual'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = options;
    });
  } catch (err) {
    console.warn('populateDealQualSelect:', err);
  }
}

/** Make sure we have the qualification list cached (used when opening edit mode
 *  without having visited the create-deal panel first) */
async function ensureDealQualCache() {
  if (dealQualOptionsCache.length) return dealQualOptionsCache;
  try {
    const res = await fetch('/api/qualifications');
    const data = await res.json();
    if (data.success) dealQualOptionsCache = data.qualifications;
  } catch (err) {
    console.warn('ensureDealQualCache:', err);
  }
  return dealQualOptionsCache;
}

/* ════════════════════════════════════════════════════════
   CREATE DEAL
════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('createDealForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving…';

    const payload = {
      deal_number: parseInt(document.getElementById('cd-number').value, 10),
      sponsor: document.getElementById('cd-sponsor').value.trim(),
      qualification_id: document.getElementById('cd-qual').value || null,
      registration_status: document.getElementById('cd-reg-status').value.trim(),
      start_date: document.getElementById('cd-start').value || null,
      learners_count: parseInt(document.getElementById('cd-count').value, 10) || null,
    };

    try {
      const res = await fetch('/api/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);

      showDealMsg('create', '✓ Deal created successfully.', 'success');
      form.reset();
      await prefillDealNumber();
    } catch (err) {
      showDealMsg('create', 'Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  });
});

/* ════════════════════════════════════════════════════════
   VIEW ALL DEALS  — table
════════════════════════════════════════════════════════ */
async function refreshDealTable() {
  const tbody = document.querySelector('#all-deals table tbody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-secondary);font-size:13px">Loading deals…</td></tr>`;

  try {
    const res = await fetch('/api/deals');
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    if (!data.deals.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-secondary);font-size:13px">No deals yet. Create one above.</td></tr>`;
      return;
    }
    tbody.innerHTML = data.deals.map(d => renderDealRow(d)).join('');

    // Warm the qualification cache in the background so Edit mode opens instantly
    ensureDealQualCache();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--color-red);font-size:13px">Failed to load: ${escHtml(err.message)}</td></tr>`;
  }
}

function renderDealRow(d) {
  const regBadge = d.registration_status
    ? `<span class="badge badge-reg">${escHtml(d.registration_status)}</span>`
    : `<span style="color:var(--text-tertiary);font-size:12px">—</span>`;

  const startFmt = d.start_date
    ? new Date(d.start_date).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';

  const qual = d.qualification_title
    ? `${escHtml(d.qualification_title)} <span class="badge badge-nqf4" style="font-size:9px">${escHtml(d.nqf_level)}</span>`
    : '<span style="color:var(--text-tertiary)">—</span>';

  return `
    <tr data-deal="${d.deal_number}"
        data-sponsor="${escHtml(d.sponsor)}"
        data-qual-id="${d.qualification_id || ''}"
        data-reg-status="${escHtml(d.registration_status || '')}">
      <td style="font-weight:600;color:var(--blue)">${d.deal_number}</td>
      <td class="deal-cell-sponsor">${escHtml(d.sponsor)}</td>
      <td class="deal-cell-qual">${qual}</td>
      <td class="deal-cell-status">${regBadge}</td>
      <td>${startFmt}</td>
      <td>
        <span class="deal-learner-count">${d.linked_learners}</span>
        <span style="color:var(--text-tertiary);font-size:11px"> / ${d.learners_count ?? '—'}</span>
      </td>
      <td class="deal-cell-actions">
        <button class="btn btn-xs btn-blue" onclick="enterDealEditMode(this)">Edit</button>
        <a class="btn btn-xs" href="deal-details.html?deal=${d.deal_number}" target="_blank">More info</a>
        <button class="btn btn-xs" onclick="openLinkLearners(${d.deal_number})">Link learners</button>
        <button class="btn btn-xs btn-red" onclick="confirmRemoveDeal(${d.deal_number}, '${escHtml(d.sponsor)}', ${d.linked_learners})">Remove</button>
      </td>
    </tr>`;
}

/* ════════════════════════════════════════════════════════
   INLINE ROW EDIT — sponsor / qualification / registration status
   (mirrors the Users table enterEditMode → saveUserEdit pattern)
════════════════════════════════════════════════════════ */

/** Switch a deal row into inline-edit mode */
async function enterDealEditMode(btn) {
  const row = btn.closest('tr');
  const cells = row.querySelectorAll('td');
  const currentSponsor = row.dataset.sponsor || '';
  const currentQualId = row.dataset.qualId || '';
  const currentRegStatus = row.dataset.regStatus || '';

  // Make sure we have qualification options to populate the select with
  const quals = await ensureDealQualCache();

  // col 1 → sponsor text input
  cells[1].innerHTML = `
    <input type="text" class="deal-edit-sponsor" value="${escHtml(currentSponsor)}"
      style="font-size:12px;padding:4px 8px;border-radius:4px;border:1px solid var(--border);width:100%">`;

  // col 2 → qualification select
  const qualOptions = `<option value="">— None —</option>` +
    quals.map(q =>
      `<option value="${q.id}"${q.id === currentQualId ? ' selected' : ''}>${escHtml(q.title)} (${q.nqf_level})</option>`
    ).join('');
  cells[2].innerHTML = `
    <select class="deal-edit-qual" style="font-size:12px;padding:4px 6px;border-radius:4px;border:1px solid var(--border);width:100%">
      ${qualOptions}
    </select>`;

  // col 3 → registration status select
  cells[3].innerHTML = selectHtml('deal-edit-status', DEAL_REG_STATUSES, currentRegStatus);

  // col 6 → Save / Cancel buttons
  cells[6].innerHTML = `
    <button class="btn btn-xs btn-green" onclick="saveDealEdit('${row.dataset.deal}', this)">Save</button>
    <button class="btn btn-xs"           onclick="refreshDealTable()">Cancel</button>`;
}

/** Save the inline deal edit via PUT /api/deals/:number */
async function saveDealEdit(dealNumber, btn) {
  const row = btn.closest('tr');
  const sponsorInput = row.querySelector('.deal-edit-sponsor');
  const qualSelect = row.querySelector('.deal-edit-qual');
  const statusSelect = row.querySelector('.deal-edit-status');

  const newSponsor = sponsorInput.value.trim();
  if (!newSponsor) {
    showDealTableMsg('Sponsor name cannot be empty.', 'error');
    return;
  }

  const payload = {
    sponsor: newSponsor,
    qualification_id: qualSelect.value || null,
    registration_status: statusSelect.value || null,
  };

  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const res = await fetch(`/api/deals/${dealNumber}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    showDealTableMsg('Deal updated successfully.', 'success');
    await refreshDealTable();   // re-render fresh from DB
  } catch (err) {
    console.error('saveDealEdit:', err);
    showDealTableMsg('Update failed: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

/** Small inline message above the deals table (mirrors showTableMessage for users) */
function showDealTableMsg(text, type) {
  let el = document.getElementById('deal-table-msg');
  if (!el) {
    el = document.createElement('div');
    el.id = 'deal-table-msg';
    el.style.cssText = 'margin:8px 0;font-size:13px;padding:8px 12px;border-radius:6px;';
    const area = document.getElementById('all-deals');
    if (area) area.prepend(el);
  }
  el.textContent = text;
  el.className = type === 'success' ? 'success-message' : 'error-message';
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
}

/* ════════════════════════════════════════════════════════
   REMOVE DEAL — soft delete (archives, never hard-deletes)
   Learners/facilitators/assessors/enrolments still linked to
   this deal are auto-unlinked server-side; the deal number
   itself is retired and never reused.
════════════════════════════════════════════════════════ */
async function confirmRemoveDeal(dealNumber, sponsor, linkedLearners) {
  const warning = linkedLearners > 0
    ? `Remove deal #${dealNumber} (${sponsor})?\n\nThis deal currently has ${linkedLearners} learner(s) linked. They will be automatically unlinked — their enrolments are not affected, only the deal association.\n\nThe deal will be archived (not permanently deleted) for SETA audit purposes.`
    : `Remove deal #${dealNumber} (${sponsor})?\n\nThe deal will be archived (not permanently deleted) for SETA audit purposes.`;

  if (!confirm(warning)) return;

  try {
    const res = await fetch(`/api/deals/${dealNumber}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    showDealTableMsg(data.message, 'success');
    await refreshDealTable();
  } catch (err) {
    console.error('confirmRemoveDeal:', err);
    showDealTableMsg('Remove failed: ' + err.message, 'error');
  }
}

/* ════════════════════════════════════════════════════════
   DEAL DETAIL DRAWER  — slides in from right
════════════════════════════════════════════════════════ */
async function openDealDrawer(dealNumber) {
  const overlay = document.getElementById('deal-drawer-overlay');
  const drawer = document.getElementById('deal-drawer');
  const content = document.getElementById('deal-drawer-content');
  if (!overlay || !drawer) return;

  content.innerHTML = `<div class="drawer-loading">Loading deal ${dealNumber}…</div>`;
  overlay.classList.add('visible');
  drawer.classList.add('visible');
  document.body.style.overflow = 'hidden';

  try {
    const res = await fetch(`/api/deals/${dealNumber}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    renderDrawerContent(data.deal, data.learners);
  } catch (err) {
    content.innerHTML = `<div style="padding:24px;color:var(--color-red);font-size:13px">Failed to load: ${escHtml(err.message)}</div>`;
  }
}

function closeDealDrawer() {
  const overlay = document.getElementById('deal-drawer-overlay');
  const drawer = document.getElementById('deal-drawer');
  if (overlay) overlay.classList.remove('visible');
  if (drawer) drawer.classList.remove('visible');
  document.body.style.overflow = '';
}

function renderDrawerContent(deal, learners) {
  const content = document.getElementById('deal-drawer-content');

  const startFmt = deal.start_date
    ? new Date(deal.start_date).toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' })
    : 'Not set';

  const learnersHtml = learners.length
    ? learners.map(l => {
      const name = [l.name, l.surname].filter(Boolean).join(' ') || '—';
      const prog = l.progress_pct != null ? `${parseFloat(l.progress_pct).toFixed(0)}%` : '—';
      const statusBadge = `<span class="badge ${l.status === 'active' ? 'badge-active' : 'badge-inactive'}">${escHtml(l.status)}</span>`;
      return `
          <div class="drawer-learner-row">
            <div class="drawer-learner-avatar">${initials(name)}</div>
            <div class="drawer-learner-info">
              <div class="drawer-learner-name">${escHtml(name)}</div>
              <div class="drawer-learner-email">${escHtml(l.email)}</div>
            </div>
            <div style="display:flex;align-items:center;gap:10px">
              ${statusBadge}
              <div class="drawer-progress-pill">
                <div class="drawer-progress-bar" style="width:${prog === '—' ? 0 : prog}"></div>
              </div>
              <span style="font-size:11px;color:var(--text-secondary);min-width:28px">${prog}</span>
              <button class="btn btn-xs btn-red-outline" onclick="unlinkLearner(${deal.deal_number}, '${l.user_id}', this)" title="Unlink from deal">✕</button>
            </div>
          </div>`;
    }).join('')
    : `<div style="padding:16px 0;color:var(--text-tertiary);font-size:13px;text-align:center">No learners linked to this deal yet.</div>`;

  content.innerHTML = `
    <div class="drawer-header">
      <div>
        <div class="drawer-deal-num">Deal #${deal.deal_number}</div>
        <div class="drawer-deal-name">${escHtml(deal.sponsor)}</div>
      </div>
      <button class="drawer-close" onclick="closeDealDrawer()">✕</button>
    </div>

    <div class="drawer-meta-grid">
      <div class="drawer-meta-item">
        <div class="drawer-meta-label">Qualification</div>
        <div class="drawer-meta-value">${escHtml(deal.qualification_title || '—')}</div>
      </div>
      <div class="drawer-meta-item">
        <div class="drawer-meta-label">NQF Level</div>
        <div class="drawer-meta-value">${deal.nqf_level ? `<span class="badge badge-nqf4">${escHtml(deal.nqf_level)}</span>` : '—'}</div>
      </div>
      <div class="drawer-meta-item">
        <div class="drawer-meta-label">Start date</div>
        <div class="drawer-meta-value">${startFmt}</div>
      </div>
      <div class="drawer-meta-item">
        <div class="drawer-meta-label">Registration status</div>
        <div class="drawer-meta-value">${deal.registration_status ? `<span class="badge badge-reg">${escHtml(deal.registration_status)}</span>` : '—'}</div>
      </div>
      <div class="drawer-meta-item">
        <div class="drawer-meta-label">Expected learners</div>
        <div class="drawer-meta-value">${deal.learners_count ?? '—'}</div>
      </div>
      <div class="drawer-meta-item">
        <div class="drawer-meta-label">Linked learners</div>
        <div class="drawer-meta-value" style="font-weight:600;color:var(--blue)">${learners.length}</div>
      </div>
    </div>

    <div class="drawer-section-title">Learners on this deal</div>
    <div id="drawer-learners-list">
      ${learnersHtml}
    </div>

    <div style="padding:16px 0 8px">
      <button class="btn btn-blue" style="width:100%" onclick="closeDealDrawer(); openLinkLearners(${deal.deal_number})">
        + Link more learners
      </button>
    </div>
  `;
}

/* ════════════════════════════════════════════════════════
   UNLINK LEARNER from drawer
════════════════════════════════════════════════════════ */
async function unlinkLearner(dealNumber, learnerId, btn) {
  if (!confirm('Remove this learner from the deal?')) return;
  btn.disabled = true;
  try {
    const res = await fetch(`/api/deals/${dealNumber}/learners/${learnerId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    // Remove row from drawer without full reload
    btn.closest('.drawer-learner-row').remove();
    const list = document.getElementById('drawer-learners-list');
    if (list && !list.querySelector('.drawer-learner-row')) {
      list.innerHTML = `<div style="padding:16px 0;color:var(--text-tertiary);font-size:13px;text-align:center">No learners linked to this deal yet.</div>`;
    }
    // Refresh table in background
    if (document.querySelector('#all-deals table tbody')) refreshDealTable();
  } catch (err) {
    alert('Could not unlink: ' + err.message);
    btn.disabled = false;
  }
}

/* ════════════════════════════════════════════════════════
   LINK LEARNERS PANEL
════════════════════════════════════════════════════════ */
async function openLinkLearners(dealNumber) {
  // Make link-learners area visible
  document.querySelectorAll('.content-area').forEach(el => el.classList.remove('visible'));
  const area = document.getElementById('link-learners');
  if (!area) return;
  area.classList.add('visible');
  area.scrollIntoView({ behavior: 'smooth', block: 'start' });

  document.getElementById('ll-deal-number').value = dealNumber;
  document.getElementById('ll-deal-label').textContent = `Deal #${dealNumber}`;

  selectedLearners.clear();
  renderSelectedPills();

  await loadAvailableLearners('');
}

async function loadAvailableLearners(search) {
  const list = document.getElementById('ll-learner-list');
  if (!list) return;

  list.innerHTML = `<div style="padding:10px;color:var(--text-secondary);font-size:12px">Searching…</div>`;

  try {
    const url = `/api/learners/available${search ? `?search=${encodeURIComponent(search)}` : ''}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    dealLearnerPool = data.learners;
    renderLearnerPickerList(data.learners);
  } catch (err) {
    list.innerHTML = `<div style="padding:10px;color:var(--color-red);font-size:12px">Error: ${escHtml(err.message)}</div>`;
  }
}

function renderLearnerPickerList(learners) {
  const list = document.getElementById('ll-learner-list');
  if (!list) return;

  if (!learners.length) {
    list.innerHTML = `<div style="padding:10px;color:var(--text-tertiary);font-size:12px">No learners found.</div>`;
    return;
  }

  list.innerHTML = learners.map(l => {
    const name = [l.name, l.surname].filter(Boolean).join(' ') || '—';
    const checked = selectedLearners.has(l.user_id) ? 'checked' : '';
    const dealTag = l.current_deal
      ? `<span class="badge badge-reg" style="font-size:9px">Deal #${l.current_deal}</span>`
      : '';
    return `
      <label class="ll-learner-item${selectedLearners.has(l.user_id) ? ' selected' : ''}">
        <input type="checkbox" value="${l.user_id}" ${checked} onchange="toggleLearnerPick(this, '${l.user_id}', '${escHtml(name)}')">
        <div class="ll-learner-avatar">${initials(name)}</div>
        <div class="ll-learner-info">
          <div class="ll-learner-name">${escHtml(name)} ${dealTag}</div>
          <div class="ll-learner-email">${escHtml(l.email)}</div>
        </div>
      </label>`;
  }).join('');
}

function toggleLearnerPick(checkbox, userId, name) {
  const label = checkbox.closest('label');
  if (checkbox.checked) {
    selectedLearners.add(userId);
    label.classList.add('selected');
  } else {
    selectedLearners.delete(userId);
    label.classList.remove('selected');
  }
  renderSelectedPills();
}

function renderSelectedPills() {
  const container = document.getElementById('ll-selected-pills');
  const countEl = document.getElementById('ll-selected-count');
  const submitBtn = document.getElementById('ll-submit-btn');
  if (!container) return;

  const count = selectedLearners.size;
  if (countEl) countEl.textContent = count;
  if (submitBtn) submitBtn.disabled = count === 0;

  if (!count) {
    container.innerHTML = `<span style="color:var(--text-tertiary);font-size:12px">No learners selected yet.</span>`;
    return;
  }

  container.innerHTML = [...selectedLearners].map(id => {
    const learner = dealLearnerPool.find(l => l.user_id === id);
    const name = learner ? [learner.name, learner.surname].filter(Boolean).join(' ') : id.slice(0, 8);
    return `<span class="ll-pill">${escHtml(name)} <span onclick="removePick('${id}')" style="cursor:pointer;margin-left:4px;opacity:.7">✕</span></span>`;
  }).join('');
}

function removePick(userId) {
  selectedLearners.delete(userId);
  // Uncheck in list if visible
  const cb = document.querySelector(`#ll-learner-list input[value="${userId}"]`);
  if (cb) {
    cb.checked = false;
    cb.closest('label')?.classList.remove('selected');
  }
  renderSelectedPills();
}

/* debounced search */
let _searchTimer;
function onLearnerSearch(val) {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => loadAvailableLearners(val), 280);
}

async function submitLinkLearners() {
  const dealNumber = document.getElementById('ll-deal-number')?.value;
  if (!dealNumber || !selectedLearners.size) return;

  const btn = document.getElementById('ll-submit-btn');
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Linking…';

  try {
    const res = await fetch(`/api/deals/${dealNumber}/learners`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ learner_ids: [...selectedLearners] }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    showDealMsg('link', `✓ ${data.message}`, 'success');
    selectedLearners.clear();
    renderSelectedPills();
    await loadAvailableLearners('');
    document.getElementById('ll-search').value = '';

    // Refresh deal table if visible
    if (document.querySelector('#all-deals table tbody')) refreshDealTable();
  } catch (err) {
    showDealMsg('link', 'Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

/* ════════════════════════════════════════════════════════
   FACILITATOR ASSIGNMENT PANEL
   One facilitator can hold many deals; one deal has exactly
   one facilitator. Two columns: deals still needing a
   facilitator, and deals already assigned (with reassign).
   The picker dropdown shows every facilitator, visually
   muting (not disabling) ones who already carry deals so the
   admin can see at a glance who has spare capacity — but any
   facilitator can still be picked, including for a second,
   third, etc. deal.
════════════════════════════════════════════════════════ */
async function refreshFacilitatorAssignment() {
  const unassignedList = document.getElementById('fa-unassigned-list');
  const assignedList = document.getElementById('fa-assigned-list');
  if (!unassignedList || !assignedList) return;

  unassignedList.innerHTML = `<div class="fa-loading">Loading…</div>`;
  assignedList.innerHTML = `<div class="fa-loading">Loading…</div>`;

  try {
    const [dealsData, facData] = await Promise.all([
      fetch('/api/deals/facilitator-overview').then(r => r.json()),
      fetch('/api/facilitators/assignable').then(r => r.json()),
    ]);
    if (!dealsData.success) throw new Error(dealsData.message);
    if (!facData.success) throw new Error(facData.message);

    facilitatorOverviewDeals = dealsData.deals;
    facilitatorPool = facData.facilitators;

    renderFacilitatorOverview();
  } catch (err) {
    console.error('refreshFacilitatorAssignment:', err);
    unassignedList.innerHTML = `<div class="fa-error">Failed to load: ${escHtml(err.message)}</div>`;
    assignedList.innerHTML = '';
  }
}

function renderFacilitatorOverview() {
  const unassigned = facilitatorOverviewDeals.filter(d => !d.facilitator_id);
  const assigned = facilitatorOverviewDeals.filter(d => d.facilitator_id);

  const unassignedCountEl = document.getElementById('fa-unassigned-count');
  const assignedCountEl = document.getElementById('fa-assigned-count');
  if (unassignedCountEl) unassignedCountEl.textContent = unassigned.length;
  if (assignedCountEl) assignedCountEl.textContent = assigned.length;

  const unassignedList = document.getElementById('fa-unassigned-list');
  const assignedList = document.getElementById('fa-assigned-list');
  if (!unassignedList || !assignedList) return;

  unassignedList.innerHTML = unassigned.length
    ? unassigned.map(d => renderFaDealRow(d, false)).join('')
    : `<div class="fa-empty">Every deal has a facilitator assigned.</div>`;

  assignedList.innerHTML = assigned.length
    ? assigned.map(d => renderFaDealRow(d, true)).join('')
    : `<div class="fa-empty">No deals assigned yet.</div>`;
}

function renderFaDealRow(d, isAssigned) {
  const qual = d.qualification_title ? escHtml(d.qualification_title) : 'No qualification set';
  const facName = isAssigned
    ? [d.facilitator_name, d.facilitator_surname].filter(Boolean).join(' ') || '—'
    : '';

  return `
    <div class="fa-deal-row" data-deal="${d.deal_number}">
      <div class="fa-deal-main">
        <div class="fa-deal-info">
          <span class="fa-deal-num">#${d.deal_number}</span>
          <span class="fa-deal-sponsor">${escHtml(d.sponsor)}</span>
        </div>
        <div class="fa-deal-qual">${qual}</div>
      </div>
      ${isAssigned ? `
        <div class="fa-assigned-pill">
          <div class="fa-facilitator-avatar">${initials(facName)}</div>
          <span>${escHtml(facName)}</span>
        </div>
      ` : ''}
      <button class="btn btn-xs ${isAssigned ? '' : 'btn-blue'}" onclick="toggleFacilitatorPicker(${d.deal_number}, this)">
        ${isAssigned ? 'Reassign' : 'Assign'}
      </button>
    </div>`;
}

/* ── Floating picker state ──
   Only one picker is ever open at a time. It lives at
   #fa-floating-picker, a direct child of <body> (see admin.html,
   right after the deal drawer markup) — deliberately NOT nested
   inside .fa-list or .panel, since .panel has overflow:hidden and
   .fa-list has overflow-y:auto, both of which would clip an
   absolutely-positioned dropdown anchored to a row inside them.
   Using position:fixed + a body-level element sidesteps that
   clipping entirely, regardless of how deep the row is nested. */
let faOpenDealNumber = null;

function getFaPickerEl() {
  return document.getElementById('fa-floating-picker');
}

function buildFacilitatorPickerHtml(dealNumber) {
  if (!facilitatorPool.length) {
    return `<div class="fa-empty" style="padding:14px">No facilitators found. Add one under Users &amp; roles.</div>`;
  }

  const currentDeal = facilitatorOverviewDeals.find(d => d.deal_number === dealNumber);
  const currentFacId = currentDeal?.facilitator_id || null;

  const optionsHtml = facilitatorPool.map(f => {
    const name = [f.name, f.surname].filter(Boolean).join(' ') || '—';
    const busy = f.deals_count > 0;
    const isCurrent = f.facilitator_id === currentFacId;
    return `
      <div class="fa-picker-option${busy ? ' fa-muted' : ''}${isCurrent ? ' fa-current' : ''}"
           onclick="assignFacilitator(${dealNumber}, '${f.facilitator_id}', this)">
        <div class="fa-facilitator-avatar">${initials(name)}</div>
        <div class="fa-picker-option-info">
          <span class="fa-picker-option-name">${escHtml(name)}</span>
          <span class="fa-picker-option-meta">${busy ? `${f.deals_count} deal${f.deals_count === 1 ? '' : 's'} already` : 'No deals yet'}</span>
        </div>
        ${isCurrent ? '<span class="fa-current-tag">Current</span>' : ''}
      </div>`;
  }).join('');

  return `
    <div class="fa-picker-inner">
      <div class="fa-picker-label">Select a facilitator</div>
      ${optionsHtml}
      ${currentFacId ? `<div class="fa-picker-option fa-unassign-option" onclick="assignFacilitator(${dealNumber}, null, this)">Unassign facilitator</div>` : ''}
    </div>`;
}

function toggleFacilitatorPicker(dealNumber, btn) {
  const picker = getFaPickerEl();
  if (!picker) return;

  // Clicking the same row's trigger again closes it
  if (faOpenDealNumber === dealNumber && picker.classList.contains('open')) {
    closeFacilitatorPicker();
    return;
  }

  picker.innerHTML = buildFacilitatorPickerHtml(dealNumber);
  faOpenDealNumber = dealNumber;
  picker.classList.add('open');
  positionFaPicker(picker, btn);
}

/** Position the floating picker next to its trigger button using
 *  viewport-relative coordinates (position:fixed), flipping above
 *  the button or clamping horizontally if it would overflow. */
function positionFaPicker(picker, btn) {
  const rect = btn.getBoundingClientRect();
  const margin = 8;
  const pickerWidth = picker.offsetWidth || 260;
  const pickerHeight = picker.offsetHeight || 200;

  let left = rect.right - pickerWidth;
  if (left < margin) left = margin;
  if (left + pickerWidth > window.innerWidth - margin) {
    left = window.innerWidth - pickerWidth - margin;
  }

  let top = rect.bottom + 4;
  if (top + pickerHeight > window.innerHeight - margin) {
    const above = rect.top - pickerHeight - 4;
    top = above > margin ? above : Math.max(margin, window.innerHeight - pickerHeight - margin);
  }

  picker.style.top = `${top}px`;
  picker.style.left = `${left}px`;
}

function closeFacilitatorPicker() {
  const picker = getFaPickerEl();
  if (picker) {
    picker.classList.remove('open');
    picker.innerHTML = '';
  }
  faOpenDealNumber = null;
}

async function assignFacilitator(dealNumber, facilitatorId, el) {
  const picker = getFaPickerEl();
  if (picker) picker.innerHTML = `<div class="fa-loading" style="padding:14px">Saving…</div>`;

  try {
    const res = await fetch(`/api/deals/${dealNumber}/facilitator`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facilitator_id: facilitatorId }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    showFaMsg(data.message || 'Facilitator updated.', 'success');
    closeFacilitatorPicker();
    await refreshFacilitatorAssignment();

    // Refresh deals table in background if visible
    if (document.querySelector('#all-deals table tbody')) refreshDealTable();
  } catch (err) {
    console.error('assignFacilitator:', err);
    showFaMsg('Error: ' + err.message, 'error');
    closeFacilitatorPicker();
  }
}

/* Close the floating picker on outside click, or on scroll/resize
   anywhere (capture:true catches scroll on nested containers like
   .fa-list and main, which don't bubble a normal 'scroll' event). */
document.addEventListener('click', (e) => {
  if (e.target.closest('#fa-floating-picker') || e.target.closest('.fa-deal-row')) return;
  closeFacilitatorPicker();
});
window.addEventListener('scroll', () => closeFacilitatorPicker(), true);
window.addEventListener('resize', () => closeFacilitatorPicker());

function showFaMsg(text, type) {
  const el = document.getElementById('deal-msg-facilitator');
  if (!el) return;
  el.textContent = text;
  el.className = type === 'success' ? 'success-message' : 'error-message';
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
}

/* ════════════════════════════════════════════════════════
   UTILS
════════════════════════════════════════════════════════ */
function initials(name) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');
}

function showDealMsg(panel, text, type) {
  const id = `deal-msg-${panel}`;
  let el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = type === 'success' ? 'success-message' : 'error-message';
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
}

/* expose for toggleArea hook in dashboard.js */
window.initDealSection = initDealSection;
window.refreshDealTable = refreshDealTable;
window.openDealDrawer = openDealDrawer;
window.closeDealDrawer = closeDealDrawer;
window.openLinkLearners = openLinkLearners;
window.unlinkLearner = unlinkLearner;
window.onLearnerSearch = onLearnerSearch;
window.submitLinkLearners = submitLinkLearners;
window.toggleLearnerPick = toggleLearnerPick;
window.removePick = removePick;
window.enterDealEditMode = enterDealEditMode;
window.saveDealEdit = saveDealEdit;
window.confirmRemoveDeal = confirmRemoveDeal;
window.refreshFacilitatorAssignment = refreshFacilitatorAssignment;
window.toggleFacilitatorPicker = toggleFacilitatorPicker;
window.assignFacilitator = assignFacilitator;
window.closeFacilitatorPicker = closeFacilitatorPicker;