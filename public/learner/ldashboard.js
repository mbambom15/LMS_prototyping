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

        // Full name
        const fullName = [user.name, user.surname].filter(Boolean).join(' ') || user.email || 'Learner';

        // Initials (up to 2 chars)
        const initials = fullName
            .split(' ')
            .slice(0, 2)
            .map(p => p[0].toUpperCase())
            .join('');

        // Populate welcome bar
        document.getElementById('welcome-name').textContent   = fullName;
        document.getElementById('welcome-av-initials').textContent = initials;
        document.getElementById('header-initials').textContent     = initials;

        // Qualification / SETA sub-line (extend when API returns it)
        if (user.qualification) {
            document.getElementById('welcome-sub').textContent =
                ` · ${user.qualification} · `;
        }

        return user;
    } catch (err) {
        console.error('Could not load user:', err);
    }
}

/* ── Load today's attendance status to update the button ── */
async function loadTodayStatus() {
    try {
        const res = await fetch('/api/attendance/today-status');
        if (!res.ok) return;
        const data = await res.json();

        const dot   = document.getElementById('attend-dot');
        const label = document.getElementById('attend-btn-label');
        const btn   = document.getElementById('attend-btn');

        if (data.signedIn && data.signedOut) {
            // Fully done for today
            dot.style.background   = '#1d9e75';
            label.textContent      = 'Attendance recorded ✓';
            btn.style.background   = '#e6f7ec';
            btn.style.color        = '#0f7b4c';
            btn.style.borderColor  = '#1d9e75';
        } else if (data.signedIn) {
            // Signed in, not out yet
            dot.style.background = '#f59e0b';
            label.textContent    = 'Sign out when leaving';
        } else {
            // Not yet signed in
            dot.style.background = '#e24b4a';
            label.textContent    = 'Capture attendance';
        }
    } catch {
        // API not ready — button stays as default
    }
}

/* ── Load attendance rate into stat card ── */
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

/* ── Build attendance calendar for current month ── */
async function buildCalendar() {
    const grid  = document.getElementById('cal-grid');
    const now   = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth();         // 0-indexed
    const today = now.getDate();

    // Update header label
    document.getElementById('cal-month').textContent =
        now.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });

    // Days in month
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Mon-first start offset: getDay() returns 0=Sun, we want Mon=0
    const firstDow = new Date(year, month, 1).getDay();
    const offset   = (firstDow + 6) % 7;   // Mon-first

    // Try to get real records from API
    let presentDays = [];
    let lateDays    = [];
    let absentDays  = [];

    try {
        const res = await fetch('/api/attendance/history');
        if (res.ok) {
            const data = (await res.json()).records || [];
            data.forEach(r => {
                // r.date is like "01 May 2025" — parse day if same month/year
                const d   = new Date(r.date);
                if (d.getFullYear() === year && d.getMonth() === month) {
                    const day = d.getDate();
                    if (r.status === 'present') presentDays.push(day);
                    else if (r.status === 'late') lateDays.push(day);
                    else absentDays.push(day);
                }
            });
        }
    } catch { /* use empty arrays */ }

    // Blank cells before day 1
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

/* ── Init ── */
window.addEventListener('DOMContentLoaded', async () => {
    await loadUser();
    loadTodayStatus();
    loadAttendanceRate();
    buildCalendar();
});