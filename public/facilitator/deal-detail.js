const params = new URLSearchParams(window.location.search);
const dealNumber = params.get('deal');

async function apiGet(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return res.json();
}

function initials(name, surname) {
    return `${(name || '?')[0] || ''}${(surname || '?')[0] || ''}`.toUpperCase();
}

function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(d) {
    if (!d) return 'Never';
    return new Date(d).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function statusBadgeClass(status) {
    const s = (status || '').toLowerCase();
    if (s.includes('active') || s.includes('approved')) return 'badge-green';
    if (s.includes('pending') || s.includes('review')) return 'badge-amber';
    if (s.includes('rejected') || s.includes('cancel') || s.includes('terminat')) return 'badge-red';
    return 'badge-gray';
}

function progressColor(actual, expected) {
    if (actual == null || expected == null) return '';
    if (actual >= expected) return 'up';
    if (actual >= expected - 15) return 'warn';
    return 'down';
}

if (!dealNumber) {
    document.getElementById('deal-name-label').textContent = 'No deal specified';
} else {
    loadDeal();
}

async function loadDeal() {
    try {
        const resp = await apiGet(`/api/facilitator/deals/${dealNumber}`);
        const { deal, learners } = resp;

        document.getElementById('deal-name-label').textContent = deal.sponsor || 'Untitled deal';
        document.getElementById('deal-number-label').textContent = `#${deal.deal_number}`;
        document.getElementById('deal-qualification-label').textContent =
            deal.qualification ? `${deal.qualification}${deal.nqf_level ? ' · ' + deal.nqf_level : ''}` : 'No qualification linked';

        const statusBadge = document.getElementById('deal-status-badge');
        statusBadge.textContent = deal.registration_status || 'unknown';
        statusBadge.className = `badge ${statusBadgeClass(deal.registration_status)}`;

        document.getElementById('learner-count-label').textContent =
            `${learners.length} learner${learners.length === 1 ? '' : 's'}`;

        const tbody = document.getElementById('learners-rows');
        if (!learners.length) {
            tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No learners assigned to this deal yet.</td></tr>`;
            return;
        }

        tbody.innerHTML = learners.map(l => {
            const actual = l.progress_pct != null ? Math.round(l.progress_pct) : null;
            const expected = l.expected_pct;
            const colorClass = progressColor(actual, expected);
            return `
                <tr>
                    <td><span class="avatar-init" style="margin-right: 8px;">${initials(l.name, l.surname)}</span>${l.name} ${l.surname}</td>
                    <td>${l.email || '—'}</td>
                    <td>${l.phone_number || '—'}</td>
                    <td class="${colorClass}">${actual != null ? actual + '%' : '—'}</td>
                    <td>${expected != null ? expected + '%' : '—'}</td>
                    <td>${fmtDateTime(l.last_login)}</td>
                    <td style="white-space: nowrap;">
                        <button class="btn btn-sm" onclick="openAttendanceModal('${l.user_id}', '${l.name} ${l.surname}')">Attendance</button>
                        <button class="btn btn-primary btn-sm" onclick="openLearnerModal('${l.user_id}')">View details</button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        console.error('loadDeal error:', err);
        document.getElementById('deal-name-label').textContent = 'Deal not found';
        document.getElementById('learners-rows').innerHTML =
            `<tr><td colspan="7" class="empty-state">Couldn't load this deal.</td></tr>`;
    }
}

// ── Learner details modal ────────────────────────────────────
async function openLearnerModal(learnerId) {
    const modal = document.getElementById('learnerModal');
    const body = document.getElementById('learnerModalBody');
    body.innerHTML = 'Loading…';
    modal.classList.add('show');

    try {
        const resp = await apiGet(`/api/facilitator/learners/${learnerId}`);
        const l = resp.learner;
        body.innerHTML = `
            <div style="display:flex; align-items:center; gap:12px; margin-bottom:16px;">
                <span class="avatar-init" style="width:44px;height:44px;font-size:16px;">${initials(l.name, l.surname)}</span>
                <div>
                    <div style="font-weight:600; font-size:16px;">${l.name} ${l.surname}</div>
                    <div class="card-sub">${l.email || '—'}</div>
                </div>
            </div>
            <div class="grid-3cols" style="gap:14px; margin-bottom:14px;">
                <div><div class="form-label">Contact</div>${l.phone_number || '—'}</div>
                <div><div class="form-label">Alt. contact</div>${l.alternative_number || '—'}</div>
                <div><div class="form-label">Status</div><span class="badge ${statusBadgeClass(l.status)}">${l.status || '—'}</span></div>
            </div>
            <div class="grid-3cols" style="gap:14px; margin-bottom:14px;">
                <div><div class="form-label">Qualification</div>${l.qualification || '—'}</div>
                <div><div class="form-label">Enrolled</div>${fmtDate(l.enrolment_start)}</div>
                <div><div class="form-label">Expected end</div>${fmtDate(l.expected_end_date)}</div>
            </div>
            <div class="grid-3cols" style="gap:14px; margin-bottom:14px;">
                <div><div class="form-label">Progress</div>${l.progress_pct != null ? Math.round(l.progress_pct) + '%' : '—'}</div>
                <div><div class="form-label">Last login</div>${fmtDateTime(l.last_login)}</div>
                <div><div class="form-label">Risk level</div>${l.risk_level ? `<span class="badge ${l.risk_level === 'high' ? 'badge-red' : l.risk_level === 'medium' ? 'badge-amber' : 'badge-gray'}">${l.risk_level}</span>` : '<span class="badge badge-green">none</span>'}</div>
            </div>
            ${l.employer_name ? `<div style="margin-bottom:14px;"><div class="form-label">Host employer</div>${l.employer_name}${l.workplace_address ? ' — ' + l.workplace_address : ''}</div>` : ''}
            ${(l.flag_low_attendance || l.flag_behind_schedule || l.flag_no_login || l.flag_poe_overdue) ? `
                <div>
                    <div class="form-label">Flags</div>
                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                        ${l.flag_low_attendance ? '<span class="risk-flag">low attendance</span>' : ''}
                        ${l.flag_behind_schedule ? '<span class="risk-flag">behind schedule</span>' : ''}
                        ${l.flag_no_login ? '<span class="risk-flag">inactive</span>' : ''}
                        ${l.flag_poe_overdue ? '<span class="risk-flag">PoE overdue</span>' : ''}
                    </div>
                </div>` : ''}
        `;
    } catch (err) {
        console.error('openLearnerModal error:', err);
        body.innerHTML = `<div class="empty-state">Couldn't load learner details.</div>`;
    }
}

function closeLearnerModal() {
    document.getElementById('learnerModal').classList.remove('show');
}

// ── Attendance modal ─────────────────────────────────────────
async function openAttendanceModal(learnerId, learnerName) {
    const modal = document.getElementById('attendanceModal');
    const tbody = document.getElementById('attendanceModalRows');
    document.getElementById('attendanceModalTitle').textContent = `Attendance · ${learnerName}`;
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Loading…</td></tr>`;
    modal.classList.add('show');

    try {
        const resp = await apiGet(`/api/facilitator/learners/${learnerId}/attendance`);
        const records = resp.records || [];

        if (!records.length) {
            tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No attendance records yet.</td></tr>`;
            return;
        }

        tbody.innerHTML = records.map(r => `
            <tr>
                <td>${fmtDate(r.attendance_date)}</td>
                <td><span class="badge ${statusBadgeClass(r.status)}">${r.status}</span></td>
                <td>${r.check_in_time ? new Date(r.check_in_time).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                <td>${r.geo_verified ? '<span class="geo-pill">verified</span>' : '—'}</td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('openAttendanceModal error:', err);
        tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Couldn't load attendance.</td></tr>`;
    }
}

function closeAttendanceModal() {
    document.getElementById('attendanceModal').classList.remove('show');
}

window.addEventListener('click', (e) => {
    if (e.target === document.getElementById('learnerModal')) closeLearnerModal();
    if (e.target === document.getElementById('attendanceModal')) closeAttendanceModal();
});

(async function initFacilitatorAvatar() {
    try {
        const resp = await apiGet('/api/facilitator/me');
        const el = document.getElementById('facilitator-initials');
        if (el && resp.facilitator) el.textContent = initials(resp.facilitator.name, resp.facilitator.surname);
    } catch (err) {
        // Non-critical
    }
})();