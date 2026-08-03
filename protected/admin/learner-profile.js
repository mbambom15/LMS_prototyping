// admin/learner-profile.js

function getLearnerId() {
    return new URLSearchParams(window.location.search).get('id');
}

document.addEventListener('DOMContentLoaded', async () => {
    const id = getLearnerId();
    if (!id) {
        document.getElementById('learner-name').textContent = 'No learner specified.';
        return;
    }
    await loadProfile(id);
});

async function loadProfile(id) {
    try {
        const res = await fetch(`/api/learners/${id}/profile`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message);

        renderHeader(data.learner);
        renderAttendanceStats(data.attendance_summary);
        renderDetails(data.learner);
    } catch (err) {
        document.getElementById('learner-name').textContent = 'Failed to load learner.';
        document.getElementById('learner-meta-row').innerHTML =
            `<span style="color:var(--red);font-size:13px">${escHtml(err.message)}</span>`;
    }
}

function renderHeader(l) {
    const name = [l.name, l.surname].filter(Boolean).join(' ') || '—';
    document.title = `${name} — Nkanyezi`;
    document.getElementById('learner-name').textContent = name;
    document.getElementById('bc-learner-name').textContent = name;
    document.getElementById('learner-eyebrow').textContent = l.deal_number ? `Deal #${l.deal_number}` : 'No deal linked';

    const dealLink = document.getElementById('bc-deal-link');
    const backLink = document.getElementById('back-link');
    if (l.deal_number) {
        dealLink.textContent = l.sponsor || `Deal #${l.deal_number}`;
        dealLink.href = `deal-details.html?deal=${l.deal_number}`;
        backLink.href = `deal-details.html?deal=${l.deal_number}`;
    } else {
        dealLink.textContent = 'Unassigned';
        dealLink.removeAttribute('href');
        backLink.href = 'dashboard.html';
    }

    document.getElementById('attendance-link').href = `attendance.html?learner=${l.user_id}`;

    const statusClass = { active: 'chip-status', inactive: 'chip-pending', suspended: 'chip-pending', completed: 'chip-status', terminated: 'chip-pending' }[l.status] || 'chip-pending';
    const chips = [
        l.qualification_title ? `<span class="meta-chip chip-qual">${escHtml(l.qualification_title)}</span>` : '',
        l.nqf_level ? `<span class="meta-chip chip-nqf">${escHtml(l.nqf_level)}</span>` : '',
        l.status ? `<span class="meta-chip ${statusClass}">${escHtml(l.status)}</span>` : '',
    ].filter(Boolean).join('');
    document.getElementById('learner-meta-row').innerHTML = chips || '<span style="color:var(--text-3);font-size:12px">No metadata</span>';
}

function renderAttendanceStats(summary) {
    const present = parseInt(summary?.present_count, 10) || 0;
    const absent = parseInt(summary?.absent_count, 10) || 0;
    const late = parseInt(summary?.late_count, 10) || 0;
    const total = parseInt(summary?.total_days, 10) || 0;
    const rate = total ? ((present / total) * 100).toFixed(1) : '0.0';

    document.getElementById('stat-present').textContent = present;
    document.getElementById('stat-absent').textContent = absent;
    document.getElementById('stat-late').textContent = late;
    document.getElementById('stat-rate').textContent = `${rate}%`;
}

function renderDetails(l) {
    const fmtDate = d => d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
    const fmtDateTime = d => d ? new Date(d).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

    set('pf-email', l.email);
    set('pf-phone', l.phone_number);
    set('pf-alt-phone', l.alternative_number);
    set('pf-status', l.status);
    set('pf-last-login', fmtDateTime(l.last_login));
    set('pf-created', fmtDate(l.created_at));

    set('pf-qual', l.qualification_title);
    set('pf-nqf', l.nqf_level);
    set('pf-deal', l.deal_number ? `#${l.deal_number} — ${l.sponsor || ''}` : 'Unassigned');
    set('pf-enrol-status', l.enrolment_status);
    set('pf-progress', l.progress_pct != null ? `${parseFloat(l.progress_pct).toFixed(1)}%` : '—');
    set('pf-start', fmtDate(l.enrolment_start));
}

function set(id, val) {
    document.getElementById(id).textContent = (val === null || val === undefined || val === '') ? '—' : val;
}

function escHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}