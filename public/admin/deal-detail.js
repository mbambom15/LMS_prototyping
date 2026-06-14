
document.addEventListener('click', e => {
    if (!e.target.closest('.more-actions-wrap')) {
        document.querySelectorAll('.more-dropdown.open').forEach(d => d.classList.remove('open'));
    }
});

/* ══════════════════════════════════════════════════════════
   deal-detail.js — embedded
══════════════════════════════════════════════════════════ */

let dealData = null;
let allLearners = [];

/* ── Read deal number from URL ── */
function getDealNumber() {
    const params = new URLSearchParams(window.location.search);
    return params.get('deal');
}

/* ── Boot ── */
document.addEventListener('DOMContentLoaded', async () => {
    const dealNumber = getDealNumber();
    if (!dealNumber) {
        document.getElementById('deal-title').textContent = 'No deal specified.';
        return;
    }
    await loadDeal(dealNumber);
});

/* ── Fetch + render ── */
async function loadDeal(dealNumber) {
    try {
        const res = await fetch(`/api/deals/${dealNumber}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message);

        dealData = data.deal;
        allLearners = data.learners;

        renderHeader(data.deal);
        renderStats(data.deal, data.learners);
        renderTable(data.learners);
    } catch (err) {
        document.getElementById('deal-title').textContent = 'Failed to load deal.';
        document.getElementById('deal-meta-row').innerHTML =
            `<span style="color:var(--red);font-size:13px">${escHtml(err.message)}</span>`;
        document.getElementById('learner-tbody').innerHTML = `
      <tr><td colspan="7"><div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <div class="empty-title">Could not load learners</div>
        <div class="empty-sub">${escHtml(err.message)}</div>
      </div></td></tr>`;
    }
}

function renderHeader(deal) {
    document.title = `Deal #${deal.deal_number} — ${deal.sponsor} | Nkanyezi`;
    document.getElementById('bc-deal-name').textContent = deal.sponsor;
    document.getElementById('deal-eyebrow').textContent = `Deal #${deal.deal_number}`;
    document.getElementById('deal-title').textContent = deal.sponsor;

    const startFmt = deal.start_date
        ? new Date(deal.start_date).toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' })
        : null;

    const chips = [
        deal.qualification_title ? `<span class="meta-chip chip-qual"> ${escHtml(deal.qualification_title)}</span>` : '',
        deal.nqf_level ? `<span class="meta-chip chip-nqf">${escHtml(deal.nqf_level)}</span>` : '',
        deal.registration_status ? `<span class="meta-chip ${deal.registration_status === 'Registered' ? 'chip-status' : 'chip-pending'}">${escHtml(deal.registration_status)}</span>` : '',
        startFmt ? `<span class="meta-chip chip-date"> ${startFmt}</span>` : '',
    ].filter(Boolean).join('');

    document.getElementById('deal-meta-row').innerHTML = chips || '<span style="color:var(--text-3);font-size:12px">No metadata added</span>';
}

function renderStats(deal, learners) {
    const total = learners.length;
    const active = learners.filter(l => l.status === 'active').length;
    const progVals = learners.map(l => parseFloat(l.progress_pct) || 0);
    const avgProg = total ? (progVals.reduce((a, b) => a + b, 0) / total).toFixed(1) : 0;
    // treat >0 progress risk flags from enrolment as proxy (real flags need separate query)
    const atRisk = learners.filter(l => (parseFloat(l.progress_pct) || 0) < 20 && l.status === 'active').length;

    document.getElementById('stat-linked').textContent = total;
    document.getElementById('stat-expected').textContent = `of ${deal.learners_count ?? '—'} expected`;
    document.getElementById('stat-avg-prog').textContent = `${avgProg}%`;
    document.getElementById('stat-active').textContent = active;
    document.getElementById('stat-risk').textContent = atRisk;
}

function renderTable(learners) {
    const tbody = document.getElementById('learner-tbody');
    document.getElementById('learner-count').textContent = `${learners.length} learner${learners.length !== 1 ? 's' : ''}`;

    if (!learners.length) {
        tbody.innerHTML = `
      <tr><td colspan="7"><div class="empty-state">
        <div class="empty-icon">👥</div>
        <div class="empty-title">No learners linked yet</div>
        <div class="empty-sub">Use "Link learner" to assign learners to this deal.</div>
      </div></td></tr>`;
        return;
    }

    tbody.innerHTML = learners.map(l => renderLearnerRow(l)).join('');
}

function renderLearnerRow(l) {
    const name = [l.name, l.surname].filter(Boolean).join(' ') || '—';
    const prog = parseFloat(l.progress_pct) || 0;
    const progClass = prog >= 60 ? '' : prog >= 30 ? 'warn' : 'low';
    const isAtRisk = prog < 20 && l.status === 'active';

    const startFmt = l.enrolment_start
        ? new Date(l.enrolment_start).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: '2-digit' })
        : '—';

    // Last login: if the API adds it later it'll show; for now show enrolment date or dash
    const lastLogin = l.last_login_at
        ? formatRelativeDate(l.last_login_at)
        : '—';
    const loginStale = l.last_login_at && daysDiff(l.last_login_at) > 7;

    const statusClass = {
        active: 'status-active',
        inactive: 'status-inactive',
        suspended: 'status-suspended',
        completed: 'status-completed',
    }[l.status] || 'status-inactive';

    return `
    <tr data-id="${l.user_id}" data-name="${escHtml(name)}" data-status="${l.status}" data-prog="${prog}">
      <td>
        <div class="learner-id-cell">
          <div class="learner-avatar">${initials(name)}</div>
          <div>
            <div class="learner-name">${escHtml(name)}</div>
            <div class="learner-email">${escHtml(l.email || '—')}</div>
          </div>
        </div>
      </td>
      <td>
        <div class="progress-wrap">
          <div class="progress-bar-bg">
            <div class="progress-bar-fill ${progClass}" style="width:${prog}%"></div>
          </div>
          <span class="progress-pct" style="color:${prog >= 60 ? 'var(--green)' : prog >= 30 ? '#a55c00' : 'var(--red)'}">${prog.toFixed(0)}%</span>
        </div>
      </td>
      <td><span class="status-pill ${statusClass}">${escHtml(l.status || '—')}</span></td>
      <td><span class="last-login${loginStale ? ' stale' : ''}">${lastLogin}</span></td>
      <td>${isAtRisk
            ? `<span class="risk-flag risk-high">⚑ High</span>`
            : prog < 40 && l.status === 'active'
                ? `<span class="risk-flag risk-medium">⚑ Med</span>`
                : `<span class="risk-none">—</span>`
        }</td>
      <td style="font-size:12px;color:var(--text-2);font-family:'JetBrains Mono',monospace">${startFmt}</td>
      <td>
        <div class="action-group">
          <a class="ab ab-blue" href="/admin/learner-profile?id=${l.user_id}" title="View full profile">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
            Profile
          </a>
          <a class="ab" href="/admin/attendance?learner=${l.user_id}" title="View attendance">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            Attendance
          </a>
          <div class="more-actions-wrap">
            <button class="more-btn" onclick="toggleMore(this)" title="More actions">•••</button>
            <div class="more-dropdown">
              <a class="dd-item" href="/admin/assess?learner=${l.user_id}">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                Assess
              </a>
              <a class="dd-item" href="/admin/feedback?learner=${l.user_id}">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                Feedback
              </a>
              <a class="dd-item" href="/admin/documents?learner=${l.user_id}">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                View docs
              </a>
              <a class="dd-item" href="/admin/upload-docs?learner=${l.user_id}">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Upload docs
              </a>
              <div class="dd-sep"></div>
              <a class="dd-item" href="mailto:${escHtml(l.email || '')}">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                Email learner
              </a>
              <div class="dd-sep"></div>
              <span class="dd-item danger" onclick="confirmUnlink('${l.user_id}', '${escHtml(name)}')">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                Unlink from deal
              </span>
            </div>
          </div>
        </div>
      </td>
    </tr>`;
}

/* ── Filter ── */
function filterLearners() {
    const search = document.getElementById('learner-search').value.toLowerCase().trim();
    const status = document.getElementById('filter-status').value;
    const risk = document.getElementById('filter-risk').value;

    const filtered = allLearners.filter(l => {
        const name = [l.name, l.surname, l.email].join(' ').toLowerCase();
        if (search && !name.includes(search)) return false;
        if (status && l.status !== status) return false;
        if (risk) {
            const prog = parseFloat(l.progress_pct) || 0;
            const isHigh = prog < 20 && l.status === 'active';
            const isMed = prog < 40 && prog >= 20 && l.status === 'active';
            if (risk === 'high' && !isHigh) return false;
            if (risk === 'medium' && !isMed) return false;
            if (risk === 'low' && (isHigh || isMed)) return false;
        }
        return true;
    });

    const tbody = document.getElementById('learner-tbody');
    document.getElementById('learner-count').textContent = `${filtered.length} of ${allLearners.length} learner${allLearners.length !== 1 ? 's' : ''}`;

    if (!filtered.length) {
        tbody.innerHTML = `
      <tr><td colspan="7"><div class="empty-state">
        <div class="empty-icon">🔍</div>
        <div class="empty-title">No matches</div>
        <div class="empty-sub">Try adjusting your search or filters.</div>
      </div></td></tr>`;
        return;
    }
    tbody.innerHTML = filtered.map(l => renderLearnerRow(l)).join('');
}

/* ── More dropdown toggle ── */
function toggleMore(btn) {
    const dd = btn.nextElementSibling;
    const wasOpen = dd.classList.contains('open');
    document.querySelectorAll('.more-dropdown.open').forEach(d => d.classList.remove('open'));
    if (!wasOpen) dd.classList.add('open');
}

/* ── Unlink learner ── */
async function confirmUnlink(learnerId, name) {
    const dealNumber = getDealNumber();
    if (!confirm(`Remove "${name}" from Deal #${dealNumber}?\n\nThis unlinks them from the deal but keeps their account.`)) return;

    try {
        const res = await fetch(`/api/deals/${dealNumber}/learners/${learnerId}`, { method: 'DELETE' });
        const data = await res.json();
        if (!data.success) throw new Error(data.message);

        // Remove from local array + re-render
        allLearners = allLearners.filter(l => l.user_id !== learnerId);
        renderTable(allLearners);
        if (dealData) renderStats(dealData, allLearners);
        showToast(`${name} unlinked from deal.`);
    } catch (err) {
        showToast(`Error: ${err.message}`);
    }
}

/* ── Link learner (redirect back to admin with deal pre-selected) ── */
function openLinkLearnersForDeal() {
    const deal = getDealNumber();
    window.location.href = `/admin?action=link-learners&deal=${deal}`;
}

/* ── Toast ── */
function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ── Helpers ── */
function initials(name) {
    return name.split(' ').filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');
}

function formatRelativeDate(dateStr) {
    const d = new Date(dateStr);
    const diff = Math.round((Date.now() - d) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return `${diff}d ago`;
    return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' });
}

function daysDiff(dateStr) {
    return Math.round((Date.now() - new Date(dateStr)) / 86400000);
}

function escHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
