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
                        <button class="btn btn-primary btn-sm" onclick="window.location.href='learner-detail.html?id=${l.user_id}&deal=${dealNumber}'">View details</button>
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