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

    // Lazy-load each page's data the first time it's opened
    if (!loadedPages.has(pageId)) {
        loadedPages.add(pageId);
        if (pageId === 'dashboard') loadDashboard();
        if (pageId === 'deals') loadDeals();
        if (pageId === 'risk') loadRiskLearners();
        if (pageId === 'attendance') { populateDealFilter(); loadAttendance(); }
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
            <tr>
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
            <div class="card" style="margin-bottom: 16px;">
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
}

async function loadAttendance() {
    const tbody = document.getElementById('attendance-rows');
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Loading…</td></tr>`;

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
            tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No attendance records found.</td></tr>`;
            return;
        }

        tbody.innerHTML = records.map(r => `
            <tr>
                <td>${r.name} ${r.surname}</td>
                <td>${r.deal_number}</td>
                <td>${fmtDate(r.attendance_date)}</td>
                <td><span class="badge ${statusBadgeClass(r.status)}">${r.status}</span></td>
                <td>${r.check_in_time ? new Date(r.check_in_time).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                <td>${r.geo_verified ? '<span class="geo-pill">verified</span>' : '—'}</td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('loadAttendance error:', err);
        tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Couldn't load attendance records.</td></tr>`;
    }
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