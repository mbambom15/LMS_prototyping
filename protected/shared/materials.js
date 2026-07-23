/* ── Sidebar helpers (same behaviour as ldashboard.js, duplicated here on
   purpose — this page intentionally does not load ldashboard.js, since
   that file's DOMContentLoaded handler also drives the attendance
   calendar/status widgets, which don't exist on this page.) ── */
function setActive(el) {
    document.querySelectorAll('.sitem').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
}

function navigateTo(el, url) {
    setActive(el);
    window.location.href = url;
}

function handleLogout() {
    if (confirm('Are you sure you want to log out?')) {
        window.location.href = '/logout';
    }
}

/* ── Role state + sidebar rendering ──
   This page is shared between learners and admins. Role comes from
   /api/me (server-trusted session), never from the URL, and drives
   both which sidebar renders and which data-loading / material-viewing
   path runs below. ── */
let currentRole = null;

const SIDEBARS = {
    learner: `
      <div class="slabel">My learning</div>
      <div class="sitem" onclick="navigateTo(this, '/learner/ldashboard.html')">Dashboard</div>
      <div class="sitem active" onclick="setActive(this)">Materials</div>
      <div class="sitem" onclick="setActive(this)">Assessments</div>
      <div class="slabel">My record</div>
      <div class="sitem" onclick="navigateTo(this, '/learner/attendance.html')">Attendance</div>
      <div class="sitem" onclick="setActive(this)">Results</div>
      <div class="slabel">Support</div>
      <div class="sitem" onclick="navigateTo(this, '/learner/ldashboard.html')">Messages</div>`,
    admin: `
      <div class="slabel">Admin</div>
      <div class="sitem" onclick="navigateTo(this, '/admin/admin.html')">Back to dashboard</div>
      <div class="sitem active" onclick="setActive(this)">Materials &amp; quizzes</div>`,
};

function renderSidebar(role) {
    const sidebar = document.getElementById('mat-sidebar');
    if (!sidebar) return;
    sidebar.innerHTML = SIDEBARS[role] || SIDEBARS.learner;
}

async function loadHeaderUser() {
    try {
        const res = await fetch('/api/me');
        if (!res.ok) { window.location.href = '/login'; return; }
        const user = await res.json();
        currentRole = user.role;

        const fullName = [user.name, user.surname].filter(Boolean).join(' ') || user.email || 'User';
        const initials = fullName.split(' ').slice(0, 2).map(p => p[0].toUpperCase()).join('');
        document.getElementById('header-initials').textContent = initials;

        const portalLabel = document.getElementById('portal-label');
        if (portalLabel) {
            portalLabel.textContent = currentRole === 'admin' ? 'Admin Portal' : 'Learner Portal';
        }
        renderSidebar(currentRole);
    } catch (err) {
        console.error('Could not load user:', err);
    }
}

/* ── Materials ── */
const CHECK_SVG = '<svg width="9" height="9" viewBox="0 0 12 12"><path d="M2 6l2.5 2.5L10 3" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function fmtSize(bytes) {
    if (!bytes) return '';
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/** Opens/downloads a material. Routes to the learner endpoint (which also
 *  logs a view for progress tracking) or the admin endpoint (no logging,
 *  admin-gated) depending on currentRole. */
async function openMaterial(materialId, mode) {
    try {
        const base = currentRole === 'admin'
            ? `/api/admin/materials/${materialId}/view`
            : `/api/learner/materials/${materialId}/view`;
        const url = mode === 'download' ? `${base}?download=1` : base;

        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to open material');
        const data = await res.json();

        const a = document.createElement('a');
        a.href = data.url;
        a.target = '_blank';
        a.rel = 'noopener';
        if (mode === 'download') a.download = data.file_name || '';
        document.body.appendChild(a);
        a.click();
        a.remove();

        // Reflect the view immediately without a full reload (learner only —
        // admins don't have a "viewed" progress state to update)
        if (currentRole !== 'admin') {
            const row = document.querySelector(`[data-material-id="${materialId}"]`);
            if (row && !row.classList.contains('viewed')) {
                row.classList.add('viewed');
                row.querySelector('.check').innerHTML = CHECK_SVG;
            }
        }
    } catch (err) {
        console.error('openMaterial error:', err);
        alert('Could not open this file. Please try again.');
    }
}

function renderMaterialRow(unitNumber, m) {
    const viewedCls = m.viewed ? 'viewed' : '';
    const meta = [m.file_name, fmtSize(m.file_size_bytes)].filter(Boolean).join(' · ');
    return `
      <div class="mat-row ${viewedCls}" data-material-id="${m.id}">
        <span class="check">${m.viewed ? CHECK_SVG : ''}</span>
        <div class="mat-info">
          <div class="mat-kind">${(m.type || 'material').replace('_', ' ')}</div>
          <div class="mat-title">${m.title}</div>
          <div class="mat-meta">${meta}</div>
        </div>
        <div class="mat-actions">
          <a href="#" onclick="openMaterial('${m.id}','view'); return false;" class="primary">View</a>
          <a href="#" onclick="openMaterial('${m.id}','download'); return false;">Download</a>
        </div>
      </div>`;
}

/* ── Unit rendering now takes a flag for whether to show the admin
   quiz + project management panels ── */
function renderUnit(unit, isAdmin) {
    const rows = unit.materials.length
        ? unit.materials.map(m => renderMaterialRow(unit.unit_number, m)).join('')
        : '<div class="mat-empty-unit">No materials uploaded for this unit yet.</div>';

    const quizContainerId = `qz-container-${unit.id}`;
    const projectContainerId = `pj-container-${unit.id}`;

    return `
      <div class="unit-acc panel">
        <div class="unit-acc-head" onclick="this.parentElement.classList.toggle('closed')">
          <span class="unit-acc-caret">▾</span>
          <div class="unit-acc-titles">
            <div class="unit-acc-tag">Unit ${unit.unit_number}</div>
            <div class="unit-acc-title">${unit.title}</div>
          </div>
        </div>
        <div class="unit-acc-body">
          ${rows}
          ${isAdmin ? `<div class="qz-mount" id="${quizContainerId}"></div>` : ''}
          ${isAdmin ? `<div class="pj-mount" id="${projectContainerId}"></div>` : ''}
        </div>
      </div>`;
}

async function loadMaterials() {
    if (currentRole === 'admin') return loadAdminMaterialsBrowser();

    try {
        const res = await fetch('/api/learner/materials');
        if (!res.ok) throw new Error('Failed to load materials');
        const data = await res.json();

        if (!data.qualification) {
            document.getElementById('mat-empty').style.display = 'block';
            document.getElementById('qual-sub').textContent = 'No active qualification found.';
            return;
        }

        document.getElementById('qual-title').textContent = data.qualification.title;
        document.getElementById('qual-sub').textContent =
            `${data.qualification.nqf_level} · Work through each unit's material below.`;

        const allMaterials = data.units.flatMap(u => u.materials);
        const doneCount = allMaterials.filter(m => m.viewed).length;

        if (allMaterials.length) {
            document.getElementById('mat-overall').style.display = 'flex';
            document.getElementById('mat-done-count').textContent = doneCount;
            document.getElementById('mat-total-count').textContent = allMaterials.length;
            const pct = Math.round((doneCount / allMaterials.length) * 100);
            document.getElementById('mat-overall-bar').style.width = pct + '%';
        }

        document.getElementById('mat-units').innerHTML = data.units.map(u => renderUnit(u, false)).join('');
    } catch (err) {
        console.error('loadMaterials error:', err);
        document.getElementById('mat-units').innerHTML =
            '<div class="panel" style="padding:20px;color:var(--text-danger);font-size:13px">Could not load your materials. Please refresh.</div>';
    }
}

/* ── ADMIN: browse any qualification's units/materials and manage
   quizzes + project assessments ── */
async function loadAdminMaterialsBrowser() {
    document.getElementById('mat-overall').style.display = 'none';
    document.getElementById('qual-title').textContent = 'Materials & quizzes';
    document.getElementById('qual-sub').innerHTML = `
        <select id="admin-qual-select" style="margin-top:6px;font-size:13px;padding:4px 8px">
          <option value="">Loading qualifications…</option>
        </select>`;

    try {
        const res = await fetch('/api/qualifications');
        const data = await res.json();
        if (!data.success) throw new Error(data.message);

        const sel = document.getElementById('admin-qual-select');
        if (!data.qualifications.length) {
            sel.innerHTML = `<option value="">No qualifications found</option>`;
            return;
        }

        sel.innerHTML = `<option value="">— Select a qualification —</option>` +
            data.qualifications.map(q => `<option value="${q.id}">${q.title} (${q.nqf_level})</option>`).join('');
        sel.onchange = () => loadAdminUnitsForQual(sel.value);
    } catch (err) {
        document.getElementById('qual-sub').textContent = 'Failed to load qualifications: ' + err.message;
    }
}

async function loadAdminUnitsForQual(qualId) {
    const container = document.getElementById('mat-units');
    if (!qualId) { container.innerHTML = ''; return; }

    container.innerHTML = `<div class="panel" style="padding:16px;font-size:13px;color:var(--text-secondary)">Loading units…</div>`;

    try {
        const res = await fetch(`/api/qualifications/${qualId}/units`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message);

        if (!data.units.length) {
            container.innerHTML = `<div class="panel" style="padding:16px;font-size:13px;color:var(--text-tertiary)">No unit standards found for this qualification yet — add one under Qualifications &rarr; Update.</div>`;
            return;
        }

        // Fetch materials for every unit so admins see the same accordion learners see
        const units = await Promise.all(data.units.map(async u => {
            const matRes = await fetch(`/api/units/${u.id}/materials`);
            const matData = await matRes.json();
            return { ...u, materials: matData.success ? matData.materials : [] };
        }));

        container.innerHTML = units.map(u => renderUnit(u, true)).join('');

        // Mount the quiz + project builders into each unit's placeholder
        // now that the DOM exists
        units.forEach(u => {
            const qzMount = document.getElementById(`qz-container-${u.id}`);
            if (qzMount) QuizBuilder.renderForUnit(u.id, qzMount);

            const pjMount = document.getElementById(`pj-container-${u.id}`);
            if (pjMount) ProjectBuilder.renderForUnit(u.id, pjMount);
        });
    } catch (err) {
        container.innerHTML = `<div class="panel" style="padding:16px;color:var(--text-danger);font-size:13px">Failed to load units: ${err.message}</div>`;
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    await loadHeaderUser();
    loadMaterials();
});