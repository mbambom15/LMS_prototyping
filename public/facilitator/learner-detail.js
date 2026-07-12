const params = new URLSearchParams(window.location.search);
const learnerId = params.get('id');
const dealNumber = params.get('deal');

document.getElementById('back-to-deal-btn').onclick = goBackToDeal;
document.getElementById('back-to-deal-btn-2').onclick = goBackToDeal;

function goBackToDeal() {
    window.location.href = dealNumber ? `deal-detail.html?deal=${dealNumber}` : 'fdashboard.html';
}

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
    return new Date(d).toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusBadgeClass(status) {
    const s = (status || '').toLowerCase();
    if (s.includes('active') || s.includes('approved')) return 'badge-green';
    if (s.includes('pending') || s.includes('review')) return 'badge-amber';
    if (s.includes('rejected') || s.includes('cancel') || s.includes('terminat')) return 'badge-red';
    return 'badge-gray';
}

function field(label, value) {
    return { label, value };
}

if (!learnerId) {
    document.getElementById('ld-name').textContent = 'No learner specified';
} else {
    loadLearner();
}

async function loadLearner() {
    try {
        const resp = await apiGet(`/api/facilitator/learners/${learnerId}`);
        const l = resp.learner;

        document.getElementById('ld-avatar').textContent = initials(l.name, l.surname);
        document.getElementById('ld-name').textContent = `${l.name} ${l.surname}`;
        document.getElementById('ld-deal-sub').textContent =
            `${l.sponsor || 'Deal'} #${l.deal_number}${l.qualification ? ' · ' + l.qualification : ''}`;

        const statusBadge = document.getElementById('ld-status-badge');
        statusBadge.textContent = l.status || 'unknown';
        statusBadge.className = `badge ${statusBadgeClass(l.status)}`;

        const flags = [];
        if (l.flag_low_attendance) flags.push('low attendance');
        if (l.flag_behind_schedule) flags.push('behind schedule');
        if (l.flag_no_login) flags.push('inactive');
        if (l.flag_poe_overdue) flags.push('PoE overdue');
        if (l.never_attended) flags.push('never signed attendance');

        function riskBadge() {
            if (l.never_attended) return '<span class="badge badge-red">At risk — no attendance</span>';
            if (l.risk_status === 'at-risk') return '<span class="badge badge-red">At risk</span>';
            if (l.risk_status === 'watch') return '<span class="badge badge-amber">Watch</span>';
            return '<span class="badge badge-green">On track</span>';
        }

        const fieldList = [
            field('Display name', `${l.name} ${l.surname}`),
            field('Email', l.email || '—'),
            field('Contact number', l.phone_number || '—'),
            field('Alternative contact', l.alternative_number || '—'),
            field('SA ID', l.sa_id || '—'),
            field('Gender', l.gender || '—'),
            field('Qualification', l.qualification ? `${l.qualification}${l.nqf_level ? ' (' + l.nqf_level + ')' : ''}` : '—'),
            field('Deal', `#${l.deal_number} — ${l.sponsor || '—'}`),
            field('Enrolment start', fmtDate(l.enrolment_start)),
            field('Expected end date', fmtDate(l.expected_end_date)),
            field('Percentage done', l.progress_pct != null ? Math.round(l.progress_pct) + '%' : '—'),
            field('Expected percentage', l.expected_pct != null ? l.expected_pct + '%' : '—'),
            field('Last logged in', fmtDateTime(l.last_login)),
            field('Learnership status', `<span class="badge ${statusBadgeClass(l.status)}">${l.status || '—'}</span>`),
            field('Employment status', l.employer_name ? `Employed — ${l.employer_name}` : 'Unemployed'),
            field('Risk level', riskBadge()),
            field('Flags', flags.length ? flags.map(f => `<span class="risk-flag">${f}</span>`).join(' ') : '—'),
        ];

        document.getElementById('ld-fields-head').innerHTML =
            fieldList.map(f => `<th>${f.label}</th>`).join('');
        document.getElementById('ld-fields-body').innerHTML =
            fieldList.map(f => `<td>${f.value}</td>`).join('');
    } catch (err) {
        console.error('loadLearner error:', err);
        document.getElementById('ld-name').textContent = 'Learner not found';
        document.getElementById('ld-fields-body').innerHTML =
            `<td class="empty-state">Couldn't load this learner.</td>`;
    }
}

// ── Attendance ────────────────────────────────────────────────
let attendanceCache = null;

async function loadAttendanceSummary() {
    try {
        const resp = await apiGet(`/api/facilitator/learners/${learnerId}/attendance`);
        attendanceCache = resp;
        const s = resp.summary || {};
        document.getElementById('att-present').textContent = s.days_present ?? '0';
        document.getElementById('att-absent').textContent = s.days_absent ?? '0';
        document.getElementById('att-rate').textContent = s.rate_pct != null ? s.rate_pct + '%' : '—';
    } catch (err) {
        console.error('loadAttendanceSummary error:', err);
    }
}

async function openAttendance() {
    const modal = document.getElementById('attendanceModal');
    const tbody = document.getElementById('attendanceModalRows');
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Loading…</td></tr>`;
    modal.classList.add('show');

    try {
        if (!attendanceCache) attendanceCache = await apiGet(`/api/facilitator/learners/${learnerId}/attendance`);
        const records = attendanceCache.records || [];

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
        console.error('openAttendance error:', err);
        tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Couldn't load attendance.</td></tr>`;
    }
}

function closeAttendanceModal() {
    document.getElementById('attendanceModal').classList.remove('show');
}

// ── Feedback email ────────────────────────────────────────────
const RISK_BADGE = {
    'at-risk': { cls: 'badge-red', label: 'At risk — urgent' },
    'watch': { cls: 'badge-amber', label: 'Watch — mid case' },
    'on-track': { cls: 'badge-green', label: 'On track — positive' },
};

async function openFeedbackModal() {
    const modal = document.getElementById('feedbackModal');
    const subjectInput = document.getElementById('feedback-subject');
    const messageInput = document.getElementById('feedback-message');
    const badgeEl = document.getElementById('feedback-category-badge');
    const note = document.getElementById('feedback-sending-note');

    subjectInput.value = '';
    messageInput.value = 'Generating draft…';
    badgeEl.innerHTML = '';
    note.textContent = '';
    modal.classList.add('show');

    try {
        const resp = await apiGet(`/api/facilitator/learners/${learnerId}/feedback/draft`);
        const { draft, context } = resp;

        subjectInput.value = draft.subject;
        messageInput.value = draft.body;

        const badge = RISK_BADGE[draft.category] || RISK_BADGE['on-track'];
        badgeEl.innerHTML = `<span class="badge ${badge.cls}">${badge.label}</span>`;
        note.textContent = context.learnerEmail
            ? `Will be sent to ${context.learnerEmail} from your own @nkanyezionline.co.za address.`
            : 'This learner has no email on file — sending will fail until one is added.';
    } catch (err) {
        console.error('openFeedbackModal error:', err);
        messageInput.value = '';
        note.textContent = "Couldn't generate a draft — you can still write feedback manually below.";
    }
}

function closeFeedbackModal() {
    document.getElementById('feedbackModal').classList.remove('show');
}

async function sendFeedbackEmail() {
    const subject = document.getElementById('feedback-subject').value.trim();
    const message = document.getElementById('feedback-message').value.trim();
    const sendBtn = document.getElementById('feedback-send-btn');

    if (!subject || !message) {
        alert('Subject and message are required.');
        return;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';

    try {
        const res = await fetch(`/api/facilitator/learners/${learnerId}/feedback/send`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject, message }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to send feedback email');

        alert(data.message);
        closeFeedbackModal();
    } catch (err) {
        console.error('sendFeedbackEmail error:', err);
        alert(err.message || "Couldn't send feedback email.");
    } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send email';
    }
}

window.addEventListener('click', (e) => {
    if (e.target === document.getElementById('attendanceModal')) closeAttendanceModal();
    if (e.target === document.getElementById('feedbackModal')) closeFeedbackModal();

});

if (learnerId) loadAttendanceSummary();

(async function initFacilitatorAvatar() {
    try {
        const resp = await apiGet('/api/facilitator/me');
        const el = document.getElementById('facilitator-initials');
        if (el && resp.facilitator) el.textContent = initials(resp.facilitator.name, resp.facilitator.surname);
    } catch (err) {
        // Non-critical
    }
})();