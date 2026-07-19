/* ── Sidebar active state ── */
function setActive(el) {
    document.querySelectorAll('.sitem').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
}

/* Navigate and set active */
function navigateTo(el, url) {
    setActive(el);
    window.location.href = url;
}

/* ── Logout ── */
function handleLogout() {
    if (confirm('Are you sure you want to log out?')) {
        window.location.href = '/logout';
    }
}

/* ── Load user from session via /api/me ── */
async function loadUser() {
    try {
        const res  = await fetch('/api/me');
        if (!res.ok) {
            // Not authenticated — send back to login
            window.location.href = '/login';
            return;
        }
        const user = await res.json();

        const fullName = [user.name, user.surname].filter(Boolean).join(' ') || user.email || 'Learner';
        const initials = fullName.split(' ').slice(0, 2).map(p => p[0].toUpperCase()).join('');

        document.getElementById('welcome-name').textContent = fullName;
        document.getElementById('welcome-av-initials').textContent = initials;
        document.getElementById('header-initials').textContent = initials;

        return user;
    } catch (err) {
        console.error('Could not load user:', err);
    }
}

/* ── Qualification name for the welcome bar (replaces the old hardcoded "MICT SETA") ── */
async function loadQualification() {
    const subEl = document.getElementById('welcome-sub');
    try {
        const res = await fetch('/api/learner/qualification');
        if (!res.ok) throw new Error('Failed to load qualification');
        const data = await res.json();

        if (!data.qualification) {
            subEl.textContent = 'No active qualification on record';
            return;
        }
        subEl.textContent = data.qualification.title;
    } catch (err) {
        console.error('loadQualification error:', err);
        subEl.textContent = '';
    }
}

/* ── Load today's attendance status to update the button — UNCHANGED ── */
async function loadTodayStatus() {
    try {
        const res = await fetch('/api/attendance/today-status');
        if (!res.ok) return;
        const data = await res.json();

        const dot   = document.getElementById('attend-dot');
        const label = document.getElementById('attend-btn-label');
        const btn   = document.getElementById('attend-btn');

        if (data.signedIn && data.signedOut) {
            dot.style.background   = '#1d9e75';
            label.textContent      = 'Attendance recorded ✓';
            btn.style.background   = '#e6f7ec';
            btn.style.color        = '#0f7b4c';
            btn.style.borderColor  = '#1d9e75';
        } else if (data.signedIn) {
            dot.style.background = '#f59e0b';
            label.textContent    = 'Sign out when leaving';
        } else {
            dot.style.background = '#e24b4a';
            label.textContent    = 'Capture attendance';
        }
    } catch {
        // API not ready — button stays as default
    }
}

/* ── Load attendance rate into stat card — UNCHANGED ── */
async function loadAttendanceRate() {
    try {
        const res = await fetch('/api/attendance/history');
        if (!res.ok) return;
        const data    = await res.json();
        const records = data.records || [];

        const sched   = records.filter(r => r.scheduled);
        const present = sched.filter(r => r.status === 'present').length;
        const late    = sched.filter(r => r.status === 'late').length;
        const total   = sched.length;
        const rate    = total ? Math.round(((present + late) / total) * 100) : null;

        const rateEl = document.getElementById('dash-attend-rate');
        const subEl  = document.getElementById('dash-attend-sub');

        if (rate === null) {
            rateEl.textContent = '—';
            subEl.textContent  = 'No data yet';
        } else {
            rateEl.textContent = rate + '%';
            if (rate >= 80) {
                subEl.textContent  = 'Above minimum';
                subEl.style.color  = 'var(--c-green, #0f7b4c)';
            } else {
                subEl.textContent  = 'Below 80% minimum';
                subEl.style.color  = '#b91c1c';
            }
        }
    } catch {
        // leave as is
    }
}

/* ── Build attendance calendar for current month — UNCHANGED ── */
async function buildCalendar() {
    const grid  = document.getElementById('cal-grid');
    const now   = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth();
    const today = now.getDate();

    document.getElementById('cal-month').textContent =
        now.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDow = new Date(year, month, 1).getDay();
    const offset   = (firstDow + 6) % 7;

    let presentDays = [];
    let lateDays    = [];
    let absentDays  = [];

    try {
        const res = await fetch('/api/attendance/history');
        if (res.ok) {
            const data = (await res.json()).records || [];
            data.forEach(r => {
                const d = new Date(r.date);
                if (d.getFullYear() === year && d.getMonth() === month) {
                    const day = d.getDate();
                    if (r.status === 'present') presentDays.push(day);
                    else if (r.status === 'late') lateDays.push(day);
                    else absentDays.push(day);
                }
            });
        }
    } catch { /* use empty arrays */ }

    for (let i = 0; i < offset; i++) {
        const blank = document.createElement('div');
        blank.style.height = '23px';
        grid.appendChild(blank);
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const cell = document.createElement('div');
        cell.classList.add('cal-day');

        let bg    = 'var(--bg-secondary)';
        let color = 'var(--text-tertiary)';
        let fw    = '400';
        let title = `${d} — No session`;

        if (presentDays.includes(d))     { bg = '#1d9e75'; color = '#fff'; title = `${d} — Present`; }
        else if (lateDays.includes(d))   { bg = '#f59e0b'; color = '#fff'; title = `${d} — Late`; }
        else if (absentDays.includes(d)) { bg = '#e24b4a'; color = '#fff'; title = `${d} — Absent`; }

        if (d === today) { fw = '700'; }

        cell.style.cssText = `background:${bg};color:${color};font-weight:${fw};` +
            (d === today ? 'outline:2px solid #185fa5;outline-offset:1px;' : '');
        cell.textContent = d;
        cell.title       = title;
        grid.appendChild(cell);
    }
}

/* ── Feedback ── */
function timeAgo(dateStr) {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diffMs / 86400000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return `${days} days ago`;
}

function renderFeedbackItem(f) {
    const fromName = [f.from_name, f.from_surname].filter(Boolean).join(' ') || 'Facilitator';
    return `
      <div class="notif-item">
        <div class="ndot" style="background:#185fa5"></div>
        <div>
          <div class="ntext"><strong>${fromName}</strong>${f.subject ? ' — ' + f.subject : ''}</div>
          <div class="ntext" style="color:var(--text-secondary);margin-top:2px">${f.message}</div>
          <div class="ntime">${timeAgo(f.sent_at)}</div>
        </div>
      </div>`;
}

async function loadFeedbackPreview() {
    const previewEl = document.getElementById('feedback-preview');
    const countEl = document.getElementById('dash-feedback-count');
    const subEl = document.getElementById('dash-feedback-sub');

    try {
        const res = await fetch('/api/learner/feedback?limit=3');
        if (!res.ok) throw new Error('Failed to load feedback');
        const data = await res.json();
        const items = data.feedback || [];

        if (!items.length) {
            previewEl.innerHTML = '<div style="padding:16px 18px;font-size:12.5px;color:var(--text-tertiary)">No feedback yet.</div>';
            countEl.textContent = '0';
            subEl.textContent = 'No feedback yet';
            return;
        }

        previewEl.innerHTML = items.map(renderFeedbackItem).join('');
        countEl.textContent = items.length;
        subEl.textContent = `Latest: ${timeAgo(items[0].sent_at)}`;
    } catch (err) {
        console.error('loadFeedbackPreview error:', err);
        previewEl.innerHTML = '<div style="padding:16px 18px;font-size:12.5px;color:var(--text-danger)">Could not load feedback.</div>';
    }
}

/* ── Messages modal — full feedback history ── */
async function openMessagesModal() {
    const modal = document.getElementById('messages-modal');
    const listEl = document.getElementById('messages-list');
    modal.style.display = 'flex';
    listEl.innerHTML = '<div style="padding:16px 18px;font-size:12.5px;color:var(--text-tertiary)">Loading…</div>';

    try {
        const res = await fetch('/api/learner/feedback');
        if (!res.ok) throw new Error('Failed to load messages');
        const data = await res.json();
        const items = data.feedback || [];

        listEl.innerHTML = items.length
            ? items.map(renderFeedbackItem).join('')
            : '<div style="padding:16px 18px;font-size:12.5px;color:var(--text-tertiary)">No messages yet.</div>';
    } catch (err) {
        console.error('openMessagesModal error:', err);
        listEl.innerHTML = '<div style="padding:16px 18px;font-size:12.5px;color:var(--text-danger)">Could not load messages.</div>';
    }
}

function closeMessagesModal() {
    document.getElementById('messages-modal').style.display = 'none';
}

/* ── Init ── */
window.addEventListener('DOMContentLoaded', async () => {
    await loadUser();
    loadQualification();
    loadTodayStatus();
    loadAttendanceRate();
    buildCalendar();
    loadFeedbackPreview();
});