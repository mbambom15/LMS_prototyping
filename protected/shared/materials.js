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

async function loadHeaderUser() {
    try {
        const res = await fetch('/api/me');
        if (!res.ok) { window.location.href = '/login'; return; }
        const user = await res.json();
        const fullName = [user.name, user.surname].filter(Boolean).join(' ') || user.email || 'Learner';
        const initials = fullName.split(' ').slice(0, 2).map(p => p[0].toUpperCase()).join('');
        document.getElementById('header-initials').textContent = initials;
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

async function openMaterial(materialId, mode) {
    // mode: 'view' opens inline in a new tab; 'download' does the same but
    // adds the `download` attribute — this only forces an actual download
    // if your blobStorage.js signs the SAS token with a contentDisposition
    // override (Content-Disposition: attachment). If it doesn't yet, both
    // buttons just open the file — check utils/blobStorage.js's getSasUrl
    // signature and add that option there if you want a true forced download.
    try {
        const url = mode === 'download'
            ? `/api/learner/materials/${materialId}/view?download=1`
            : `/api/learner/materials/${materialId}/view`;
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

        // Reflect the view immediately without a full reload
        const row = document.querySelector(`[data-material-id="${materialId}"]`);
        if (row && !row.classList.contains('viewed')) {
            row.classList.add('viewed');
            row.querySelector('.check').innerHTML = CHECK_SVG;
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

function renderUnit(unit) {
    const rows = unit.materials.length
        ? unit.materials.map(m => renderMaterialRow(unit.unit_number, m)).join('')
        : '<div class="mat-empty-unit">No materials uploaded for this unit yet.</div>';

    return `
      <div class="unit-acc panel">
        <div class="unit-acc-head" onclick="this.parentElement.classList.toggle('closed')">
          <span class="unit-acc-caret">▾</span>
          <div class="unit-acc-titles">
            <div class="unit-acc-tag">Unit ${unit.unit_number}</div>
            <div class="unit-acc-title">${unit.title}</div>
          </div>
        </div>
        <div class="unit-acc-body">${rows}</div>
      </div>`;
}

async function loadMaterials() {
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

        document.getElementById('mat-units').innerHTML = data.units.map(renderUnit).join('');
    } catch (err) {
        console.error('loadMaterials error:', err);
        document.getElementById('mat-units').innerHTML =
            '<div class="panel" style="padding:20px;color:var(--text-danger);font-size:13px">Could not load your materials. Please refresh.</div>';
    }
}

window.addEventListener('DOMContentLoaded', () => {
    loadHeaderUser();
    loadMaterials();
});