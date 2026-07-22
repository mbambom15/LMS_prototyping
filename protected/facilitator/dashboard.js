// ── Nav ────────────────────────────────────────────────────────
const loadedPages = new Set();

function switchToPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(`page-${pageId}`);
    if (target) target.classList.add('active');

    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    const activeNav = Array.from(document.querySelectorAll('.nav-item')).find(
        nav => nav.getAttribute('data-page') === pageId
    );
    if (activeNav) activeNav.classList.add('active');

    if (!loadedPages.has(pageId)) {
        loadedPages.add(pageId);
        if (pageId === 'dashboard') loadDashboard();
        if (pageId === 'deals') loadDeals();
        if (pageId === 'grading') loadGrading();
        if (pageId === 'risk') loadRiskLearners();
        if (pageId === 'attendance') { populateDealFilter(); loadAttendance(); }
        if (pageId === 'feedback-history') loadFeedbackHistory();
        if (pageId === 'messages') loadMessages();
    }
}

document.querySelectorAll('.nav-item').forEach(nav => {
    nav.addEventListener('click', () => {
        const page = nav.getAttribute('data-page');
        if (page) switchToPage(page);
    });
});

function logoutAction() {
    window.location.href = '/logout';
}

// ── Helpers ───────────────────────────────────────────────────
function initials(name, surname) {
    return `${(name || '?')[0] || ''}${(surname || '?')[0] || ''}`.toUpperCase();
}

function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

function statusBadgeClass(status) {
    const s = (status || '').toLowerCase();
    if (s.includes('active') || s.includes('approved')) return 'badge-green';
    if (s.includes('pending') || s.includes('review')) return 'badge-amber';
    if (s.includes('rejected') || s.includes('cancel') || s.includes('terminat')) return 'badge-red';
    return 'badge-gray';
}

function riskBadge(level) {
    if (level === 'high') return '<span class="badge badge-red">Critical</span>';
    if (level === 'medium') return '<span class="badge badge-amber">Moderate risk</span>';
    return '<span class="badge badge-gray">Low</span>';
}

async function apiGet(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return res.json();
}

async function apiPost(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Request failed: ${res.status}`);
    return data;
}

// ── Dashboard ─────────────────────────────────────────────────
async function loadDashboard() {
    try {
        const [statsResp, riskResp] = await Promise.all([
            apiGet('/api/facilitator/dashboard-stats'),
            apiGet('/api/facilitator/at-risk-learners')
        ]);

        const s = statsResp.stats || {};
        const statVals = document.querySelectorAll('#dashboard-stats .stat-val');
        const values = [s.total_learners, s.on_track, s.behind_schedule, s.at_risk,
            s.avg_attendance != null ? `${s.avg_attendance}%` : '—'];
        statVals.forEach((el, i) => { el.textContent = values[i] ?? '0'; });

        const learners = (riskResp.learners || []).slice(0, 5);
        const badge = document.getElementById('risk-count-badge');
        badge.textContent = riskResp.learners ? riskResp.learners.length : '';

        const tbody = document.getElementById('dashboard-risk-rows');
        if (!learners.length) {
            tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No at-risk learners right now.</td></tr>`;
            return;
        }
        tbody.innerHTML = learners.map(l => `
            <tr class="clickable-row" onclick="window.location.href='learner-detail.html?id=${l.user_id}&deal=${l.deal_number ?? ''}'">
                <td><span class="avatar-init" style="margin-right: 8px;">${initials(l.name, l.surname)}</span>${l.name} ${l.surname}</td>
                <td>${l.deal_number ?? '—'}</td>
                <td>${l.attendance_pct != null ? l.attendance_pct + '%' : '—'}</td>
                <td>${l.progress_pct != null ? l.progress_pct + '%' : '—'}</td>
                <td>${riskBadge(l.risk_level)}</td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('loadDashboard error:', err);
        document.getElementById('dashboard-risk-rows').innerHTML =
            `<tr><td colspan="5" class="empty-state">Couldn't load dashboard data.</td></tr>`;
    }
}

// ── Deal management ──────────────────────────────────────────
let dealsSearchTimer = null;
let allStatuses = [];

async function populateStatusFilter() {
    try {
        const resp = await apiGet('/api/facilitator/deals/statuses');
        allStatuses = resp.statuses || [];
        const select = document.getElementById('deals-status-filter');
        allStatuses.forEach(status => {
            const opt = document.createElement('option');
            opt.value = status;
            opt.textContent = status;
            select.appendChild(opt);
        });
    } catch (err) {
        console.error('populateStatusFilter error:', err);
    }
}

async function loadDeals() {
    await populateStatusFilter();

    const search = document.getElementById('deals-search');
    const statusFilter = document.getElementById('deals-status-filter');

    search.addEventListener('input', () => {
        clearTimeout(dealsSearchTimer);
        dealsSearchTimer = setTimeout(fetchDeals, 300);
    });
    statusFilter.addEventListener('change', fetchDeals);

    fetchDeals();
}

async function fetchDeals() {
    const search = document.getElementById('deals-search').value.trim();
    const status = document.getElementById('deals-status-filter').value;
    const tbody = document.getElementById('deals-rows');
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Loading…</td></tr>`;

    try {
        const params = new URLSearchParams();
        if (search) params.set('search', search);
        if (status && status !== 'all') params.set('status', status);

        const resp = await apiGet(`/api/facilitator/deals?${params.toString()}`);
        const deals = resp.deals || [];

        document.getElementById('deals-count-label').textContent =
            `${deals.length} deal${deals.length === 1 ? '' : 's'}`;

        if (!deals.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No deals match your filters.</td></tr>`;
            return;
        }

        tbody.innerHTML = deals.map(d => `
            <tr class="clickable-row" onclick="window.location.href='deal-detail.html?deal=${d.deal_number}'">
                <td>${d.deal_number}</td>
                <td>${d.sponsor || '—'}</td>
                <td>${d.qualification || '—'}</td>
                <td><span class="badge ${statusBadgeClass(d.registration_status)}">${d.registration_status || 'unknown'}</span></td>
                <td>${d.learners_count ?? 0}</td>
                <td>${fmtDate(d.start_date)}</td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('fetchDeals error:', err);
        tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Couldn't load deals.</td></tr>`;
    }
}

// ── Grading ───────────────────────────────────────────────────
let gradingSearchTimer = null;
let gradingFiltersReady = false;

async function loadGrading() {
    if (!gradingFiltersReady) {
        gradingFiltersReady = true;

        try {
            const dealsResp = await apiGet('/api/facilitator/deals');
            const dealSelect = document.getElementById('grading-deal-filter');
            (dealsResp.deals || []).forEach(d => {
                const opt = document.createElement('option');
                opt.value = d.deal_number;
                opt.textContent = `${d.deal_number} — ${d.sponsor || 'Untitled'}`;
                dealSelect.appendChild(opt);
            });
        } catch (err) {
            console.error('grading deal filter error:', err);
        }

        document.getElementById('grading-search').addEventListener('input', () => {
            clearTimeout(gradingSearchTimer);
            gradingSearchTimer = setTimeout(fetchSubmissions, 300);
        });
        document.getElementById('grading-status-filter').addEventListener('change', fetchSubmissions);
        document.getElementById('grading-deal-filter').addEventListener('change', fetchSubmissions);
    }

    fetchSubmissions();
}

async function fetchSubmissions() {
    const search = document.getElementById('grading-search').value.trim();
    const status = document.getElementById('grading-status-filter').value;
    const dealNumber = document.getElementById('grading-deal-filter').value;
    const container = document.getElementById('grading-list');
    container.innerHTML = `<div class="empty-state">Loading…</div>`;

    try {
        const params = new URLSearchParams();
        if (search) params.set('search', search);
        if (status && status !== 'all') params.set('status', status);
        if (dealNumber) params.set('deal_number', dealNumber);

        const resp = await apiGet(`/api/facilitator/submissions?${params.toString()}`);
        const submissions = resp.submissions || [];

        document.getElementById('grading-count-label').textContent =
            `${submissions.length} submission${submissions.length === 1 ? '' : 's'}`;
        const badge = document.getElementById('grading-count-badge');
        badge.textContent = submissions.filter(s => s.status === 'pending').length || '';

        if (!submissions.length) {
            container.innerHTML = `<div class="empty-state">No submissions match your filters.</div>`;
            return;
        }

        container.innerHTML = submissions.map(s => renderSubmissionCard(s)).join('');
    } catch (err) {
        console.error('fetchSubmissions error:', err);
        container.innerHTML = `<div class="empty-state">Couldn't load submissions.</div>`;
    }
}

function renderSubmissionCard(s) {
    const isGraded = s.status === 'graded';
    return `
        <div class="fb-card" id="submission-${s.id}">
            <div class="fb-learner">
                <span class="avatar-init">${initials(s.name, s.surname)}</span>
                <div style="flex:1;">
                    <strong>${s.name} ${s.surname}</strong>
                    <div class="card-sub">${s.assessment_title} · Unit ${s.unit_number}: ${s.unit_title} · Deal ${s.deal_number}</div>
                </div>
                <span class="badge ${isGraded ? 'badge-green' : 'badge-amber'}">${isGraded ? 'graded' : 'pending'}</span>
            </div>
            <div class="card-sub" style="margin-bottom:10px;">
                Submitted ${fmtDate(s.submitted_at)} · Max score ${s.max_score} · Pass mark ${s.pass_mark}
                ${s.file_url ? ` · <a href="${s.file_url}" target="_blank" rel="noopener">View submission file</a>` : ''}
            </div>
            <div style="display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap;">
                <div style="width:100px;">
                    <label class="form-label">Score</label>
                    <input type="number" id="score-${s.id}" min="0" max="${s.max_score}" value="${s.score ?? ''}">
                </div>
                <div style="flex:1; min-width:220px;">
                    <label class="form-label">Feedback</label>
                    <input type="text" id="feedback-${s.id}" value="${s.feedback ? s.feedback.replace(/"/g, '&quot;') : ''}" placeholder="Optional feedback for the learner">
                </div>
                <button class="btn btn-primary btn-sm" onclick="submitGrade('${s.id}')">${isGraded ? 'Update grade' : 'Save grade'}</button>
            </div>
            <div id="grade-toast-${s.id}" class="toast" style="display:none;">Saved</div>
        </div>
    `;
}

async function submitGrade(submissionId) {
    const scoreInput = document.getElementById(`score-${submissionId}`);
    const feedbackInput = document.getElementById(`feedback-${submissionId}`);
    const score = scoreInput.value;
    const feedback = feedbackInput.value;

    if (score === '' || Number.isNaN(Number(score))) {
        alert('Please enter a numeric score.');
        return;
    }

    try {
        await apiPost(`/api/facilitator/submissions/${submissionId}/grade`, { score: Number(score), feedback });
        const toast = document.getElementById(`grade-toast-${submissionId}`);
        toast.style.display = 'inline-block';
        setTimeout(() => { toast.style.display = 'none'; }, 2000);
        fetchSubmissions();
    } catch (err) {
        console.error('submitGrade error:', err);
        alert(err.message || "Couldn't save grade.");
    }
}

// ── At-risk learners ─────────────────────────────────────────
async function loadRiskLearners() {
    const container = document.getElementById('risk-list');
    try {
        const resp = await apiGet('/api/facilitator/at-risk-learners');
        const learners = resp.learners || [];

        if (!learners.length) {
            container.innerHTML = `<div class="empty-state">No at-risk learners right now.</div>`;
            return;
        }

        container.innerHTML = learners.map(l => `
            <div class="card clickable-card" style="margin-bottom: 16px;" onclick="window.location.href='learner-detail.html?id=${l.user_id}&deal=${l.deal_number ?? ''}'">
                <div class="card-header">
                    <div><span class="avatar-init" style="margin-right: 10px;">${initials(l.name, l.surname)}</span>
                    <strong>${l.name} ${l.surname}</strong> ${riskBadge(l.risk_level)}</div>
                    <span class="card-sub">Deal ${l.deal_number ?? '—'}</span>
                </div>
                <div class="card-body">
                    <div class="grid-3cols" style="gap: 12px;">
                        <div>
                            <div class="form-label">Attendance</div>
                            <div style="font-size: 24px; font-weight:600;">${l.attendance_pct != null ? l.attendance_pct + '%' : '—'}</div>
                        </div>
                        <div>
                            <div class="form-label">Progress</div>
                            <div style="font-size: 24px; font-weight:600;">${l.progress_pct != null ? l.progress_pct + '%' : '—'}</div>
                        </div>
                        <div>
                            <div class="form-label">Last login</div>
                            <div style="font-size: 20px; font-weight:500;">${l.days_since_login != null ? l.days_since_login + ' days ago' : '—'}</div>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('loadRiskLearners error:', err);
        container.innerHTML = `<div class="empty-state">Couldn't load at-risk learners.</div>`;
    }
}

// ── Attendance records ───────────────────────────────────────
async function populateDealFilter() {
    try {
        const resp = await apiGet('/api/facilitator/deals');
        const select = document.getElementById('att-deal-filter');
        (resp.deals || []).forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.deal_number;
            opt.textContent = `${d.deal_number} — ${d.sponsor || 'Untitled'}`;
            select.appendChild(opt);
        });
    } catch (err) {
        console.error('populateDealFilter error:', err);
    }

    const periodSelect = document.getElementById('att-period');
    if (periodSelect && !periodSelect.dataset.wired) {
        periodSelect.dataset.wired = '1';
        periodSelect.addEventListener('change', () => {
            applyPeriodPreset(periodSelect.value);
            loadAttendance();
        });
    }
}

function applyPeriodPreset(period) {
    const fmt = dt => dt.toISOString().slice(0, 10);
    const today = new Date();
    let from, to;

    if (period === 'week') {
        const day = today.getDay();
        const diffToMonday = day === 0 ? -6 : 1 - day;
        from = new Date(today);
        from.setDate(today.getDate() + diffToMonday);
        to = today;
    } else if (period === 'month') {
        from = new Date(today.getFullYear(), today.getMonth(), 1);
        to = today;
    } else {
        return;
    }

    document.getElementById('att-from').value = fmt(from);
    document.getElementById('att-to').value = fmt(to);
}

async function loadAttendance() {
    const tbody = document.getElementById('attendance-rows');
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Loading…</td></tr>`;

    try {
        const dealNumber = document.getElementById('att-deal-filter').value;
        const from = document.getElementById('att-from').value;
        const to = document.getElementById('att-to').value;

        const params = new URLSearchParams();
        if (dealNumber) params.set('deal_number', dealNumber);
        if (from) params.set('from', from);
        if (to) params.set('to', to);

        const resp = await apiGet(`/api/facilitator/attendance?${params.toString()}`);
        const records = resp.records || [];

        if (!records.length) {
            tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No attendance records found.</td></tr>`;
            return;
        }

        tbody.innerHTML = records.map(r => `
            <tr>
                <td>${r.name} ${r.surname}</td>
                <td>${r.deal_number}</td>
                <td>${fmtDate(r.attendance_date)}</td>
                <td><span class="badge ${statusBadgeClass(r.status)}">${r.status}${r.is_computed ? '*' : ''}</span></td>
                <td>${r.check_in_time ? new Date(r.check_in_time).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                <td>${r.check_out_time ? new Date(r.check_out_time).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                <td>${r.geo_verified ? '<span class="geo-pill">verified</span>' : '—'}</td>
            </tr>
        `).join('');

        if (records.some(r => r.is_computed)) {
            tbody.innerHTML += `<tr><td colspan="7" class="card-sub" style="padding: 8px 12px;">* not captured on a scheduled day — shown as absent automatically</td></tr>`;
        }
    } catch (err) {
        console.error('loadAttendance error:', err);
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Couldn't load attendance records.</td></tr>`;
    }
}

function downloadAttendancePdf() {
    const dealNumber = document.getElementById('att-deal-filter').value;
    const from = document.getElementById('att-from').value;
    const to = document.getElementById('att-to').value;

    if (!from || !to) {
        alert('Please select a From and To date (or choose a Week/Month preset) before generating a PDF.');
        return;
    }

    const params = new URLSearchParams();
    if (dealNumber) params.set('deal_number', dealNumber);
    params.set('from', from);
    params.set('to', to);

    window.location.href = `/api/facilitator/attendance/report.pdf?${params.toString()}`;
}

// ── Init ─────────────────────────────────────────────────────
(function setDefaultDates() {
    const d = new Date();
    const from = new Date(d.getFullYear(), d.getMonth(), 1);
    const fmt = dt => dt.toISOString().slice(0, 10);
    const fromInput = document.getElementById('att-from');
    const toInput = document.getElementById('att-to');
    if (fromInput) fromInput.value = fmt(from);
    if (toInput) toInput.value = fmt(d);
})();

// ── Feedback history ──────────────────────────────────────────
let fhSearchTimer = null;
let fhFiltersReady = false;
let fhCache = [];

async function loadFeedbackHistory() {
    if (!fhFiltersReady) {
        fhFiltersReady = true;

        try {
            const dealsResp = await apiGet('/api/facilitator/deals');
            const dealSelect = document.getElementById('fh-deal-filter');
            (dealsResp.deals || []).forEach(d => {
                const opt = document.createElement('option');
                opt.value = d.deal_number;
                opt.textContent = `${d.deal_number} — ${d.sponsor || 'Untitled'}`;
                dealSelect.appendChild(opt);
            });
        } catch (err) {
            console.error('fh deal filter error:', err);
        }

        document.getElementById('fh-search').addEventListener('input', () => {
            clearTimeout(fhSearchTimer);
            fhSearchTimer = setTimeout(fetchFeedbackHistory, 300);
        });
        document.getElementById('fh-deal-filter').addEventListener('change', fetchFeedbackHistory);
    }

    fetchFeedbackHistory();
}

async function fetchFeedbackHistory() {
    const search = document.getElementById('fh-search').value.trim();
    const dealNumber = document.getElementById('fh-deal-filter').value;
    const tbody = document.getElementById('feedback-history-rows');
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Loading…</td></tr>`;

    try {
        const params = new URLSearchParams();
        if (search) params.set('search', search);
        if (dealNumber) params.set('deal_number', dealNumber);

        const resp = await apiGet(`/api/facilitator/feedback/history?${params.toString()}`);
        fhCache = resp.history || [];

        document.getElementById('feedback-history-count-label').textContent =
            `${fhCache.length} message${fhCache.length === 1 ? '' : 's'}`;

        if (!fhCache.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No feedback sent yet.</td></tr>`;
            return;
        }

        tbody.innerHTML = fhCache.map(f => `
            <tr>
                <td>${fmtDateTimeFull(f.sent_at || f.created_at)}</td>
                <td>${f.sender_name} ${f.sender_surname}</td>
                <td>${f.receiver_name} ${f.receiver_surname}</td>
                <td>${f.subject || '—'}${f.is_auto_generated ? ' <span class="badge badge-gray">auto</span>' : ''}</td>
                <td>${f.deal_number ? `#${f.deal_number}` : '—'}</td>
                <td><button class="btn btn-sm" onclick="openFhModal('${f.id}')">View</button></td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('fetchFeedbackHistory error:', err);
        tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Couldn't load feedback history.</td></tr>`;
    }
}

function fmtDateTimeFull(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function openFhModal(id) {
    const f = fhCache.find(x => String(x.id) === String(id));
    const modal = document.getElementById('fhModal');
    const body = document.getElementById('fhModalBody');
    if (!f) {
        body.innerHTML = `<div class="empty-state">Message not found.</div>`;
        modal.classList.add('show');
        return;
    }

    body.innerHTML = `
        <div class="grid-2cols" style="grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px;">
            <div><div class="form-label">Sender</div>${f.sender_name} ${f.sender_surname}<br><span class="card-sub">${f.sender_email || ''}</span></div>
            <div><div class="form-label">Receiver</div>${f.receiver_name} ${f.receiver_surname}<br><span class="card-sub">${f.receiver_email || ''}</span></div>
        </div>
        <div style="margin-bottom: 14px;"><div class="form-label">Sent</div>${fmtDateTimeFull(f.sent_at || f.created_at)}</div>
        <div style="margin-bottom: 14px;"><div class="form-label">Subject</div>${f.subject || '—'}</div>
        <div><div class="form-label">Message</div>
            <div class="fb-text" style="white-space: pre-wrap;">${(f.message || '').replace(/</g, '&lt;')}</div>
        </div>
    `;
    modal.classList.add('show');
}

function closeFhModal() {
    document.getElementById('fhModal').classList.remove('show');
}

// ── Messages (two-way threads) ─────────────────────────────────
let msgThreadsCache = [];
let composeLearnersLoaded = false;

async function loadMessages() {
    const tbody = document.getElementById('messages-rows');
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Loading…</td></tr>`;

    try {
        const resp = await apiGet('/api/facilitator/messages');
        const rows = resp.messages || [];
        msgThreadsCache = groupMessageThreads(rows);

        const learnerInitiatedUnanswered = msgThreadsCache.filter(t => t.latest.from_role === 'learner').length;
        document.getElementById('messages-count-badge').textContent = learnerInitiatedUnanswered || '';

        if (!msgThreadsCache.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No messages yet.</td></tr>`;
            return;
        }

        tbody.innerHTML = msgThreadsCache.map(t => {
            const preview = (t.latest.message || '').slice(0, 60);
            const fromLabel = t.latest.from_role === 'learner'
                ? `${t.root.learner_name} ${t.root.learner_surname}`
                : `${t.latest.from_name} ${t.latest.from_surname}`;
            return `
                <tr class="clickable-row" onclick="openMsgThreadModal('${t.root.id}')">
                    <td><span class="avatar-init" style="margin-right:8px;">${initials(t.root.learner_name, t.root.learner_surname)}</span>${t.root.learner_name} ${t.root.learner_surname}</td>
                    <td>${t.root.deal_number ? `#${t.root.deal_number}` : '—'}</td>
                    <td>${preview}${(t.latest.message || '').length > 60 ? '…' : ''}</td>
                    <td>${fromLabel}</td>
                    <td>${fmtDateTimeFull(t.latest.sent_at)}</td>
                    <td><button class="btn btn-sm">Open</button></td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        console.error('loadMessages error:', err);
        tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Couldn't load messages.</td></tr>`;
    }
}

function groupMessageThreads(rows) {
    const roots = rows.filter(r => !r.parent_id);
    const repliesByRoot = {};
    rows.filter(r => r.parent_id).forEach(r => {
        (repliesByRoot[r.parent_id] ||= []).push(r);
    });

    const threads = roots.map(root => {
        const replies = (repliesByRoot[root.id] || []).sort((a, b) => new Date(a.sent_at) - new Date(b.sent_at));
        const latest = replies.length ? replies[replies.length - 1] : root;
        return { root, replies, latest };
    });

    threads.sort((a, b) => new Date(b.latest.sent_at) - new Date(a.latest.sent_at));
    return threads;
}

function openMsgThreadModal(rootId) {
    const thread = msgThreadsCache.find(t => String(t.root.id) === String(rootId));
    const modal = document.getElementById('msgThreadModal');
    const body = document.getElementById('msgThreadBody');
    const title = document.getElementById('msgThreadTitle');
    if (!thread) return;

    title.textContent = `${thread.root.learner_name} ${thread.root.learner_surname}${thread.root.subject ? ' — ' + thread.root.subject : ''}`;
    const allMsgs = [thread.root, ...thread.replies];
    body.innerHTML = allMsgs.map(m => `
        <div style="margin-bottom:10px; padding-bottom:10px; border-bottom:1px solid #eee;">
            <strong>${m.from_role === 'learner' ? `${thread.root.learner_name} ${thread.root.learner_surname}` : `${m.from_name} ${m.from_surname}`}</strong>
            <span class="card-sub" style="margin-left:6px;">${fmtDateTimeFull(m.sent_at)}</span>
            <div style="margin-top:4px; white-space:pre-wrap;">${(m.message || '').replace(/</g, '&lt;')}</div>
        </div>
    `).join('');

    modal.dataset.rootId = thread.root.id;
    modal.classList.add('show');
}

function closeMsgThreadModal() {
    document.getElementById('msgThreadModal').classList.remove('show');
    document.getElementById('msgReplyInput').value = '';
}

async function sendMsgReply() {
    const modal = document.getElementById('msgThreadModal');
    const rootId = modal.dataset.rootId;
    const input = document.getElementById('msgReplyInput');
    const message = input.value.trim();
    if (!message || !rootId) return;

    try {
        await apiPost(`/api/facilitator/messages/${rootId}/reply`, { message });
        input.value = '';
        await loadMessages();
        openMsgThreadModal(rootId);
    } catch (err) {
        console.error('sendMsgReply error:', err);
        alert(err.message || "Couldn't send reply.");
    }
}

async function openComposeModal() {
    if (!composeLearnersLoaded) {
        composeLearnersLoaded = true;
        try {
            const resp = await apiGet('/api/facilitator/learners');
            const select = document.getElementById('compose-learner');
            (resp.learners || []).forEach(l => {
                const opt = document.createElement('option');
                opt.value = l.user_id;
                opt.textContent = `${l.name} ${l.surname} — Deal #${l.deal_number}`;
                select.appendChild(opt);
            });
        } catch (err) {
            console.error('openComposeModal learners error:', err);
        }
    }
    document.getElementById('composeModal').classList.add('show');
}

function closeComposeModal() {
    document.getElementById('composeModal').classList.remove('show');
}

async function sendComposeMessage() {
    const learnerId = document.getElementById('compose-learner').value;
    const subject = document.getElementById('compose-subject').value.trim();
    const message = document.getElementById('compose-message').value.trim();

    if (!learnerId) { alert('Please select a learner.'); return; }
    if (!message) { alert('Please enter a message.'); return; }

    try {
        await apiPost('/api/facilitator/messages', { learnerId, subject, message });
        document.getElementById('compose-subject').value = '';
        document.getElementById('compose-message').value = '';
        closeComposeModal();
        loadMessages();
    } catch (err) {
        console.error('sendComposeMessage error:', err);
        alert(err.message || "Couldn't send message.");
    }
}

window.addEventListener('click', (e) => {
    if (e.target === document.getElementById('fhModal')) closeFhModal();
    if (e.target === document.getElementById('msgThreadModal')) closeMsgThreadModal();
    if (e.target === document.getElementById('composeModal')) closeComposeModal();
});

(async function initFacilitatorAvatar() {
    try {
        const resp = await apiGet('/api/facilitator/me');
        const el = document.getElementById('facilitator-initials');
        if (el && resp.facilitator) el.textContent = initials(resp.facilitator.name, resp.facilitator.surname);
    } catch (err) {
        // Non-critical — leave the placeholder initials in place
    }
})();

loadDashboard();