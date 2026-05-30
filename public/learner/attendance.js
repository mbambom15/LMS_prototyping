// ── CONFIGURATION ──────────────────────────────────────────────
const CONFIG = {
    scheduledDays:    [1, 3],          // Tue=1, Thu=3  (Mon=0)
    venue: {
        lat: -25.82731638243808,
        lng:  28.2034515438192
    },
    maxGeoKm:         0.05,            // 50 m radius
    lateThresholdMin: 7 * 60 + 30,    // 07:30 → late
    signInOpenMin:    7 * 60,          // 07:00 sign-in opens
    signOutOpenMin:   14 * 60 + 30,   // 14:30 sign-out opens
    signOutCloseMin:  15 * 60,        // 15:00 sign-out closes
    sessionName:      'Data Science 101'
};

const DAYS_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

// ── STATE ──────────────────────────────────────────────────────
let permissionGranted = false;
let signedIn          = false;
let signedOut         = false;
let signInTimeObj     = null;
let signOutTimeObj    = null;
let isLateFlag        = false;
let currentUser       = null; // set after login/session check

// ── MOCK HISTORY (replace with API call once backend ready) ────
let attendanceLog = [];

// ── HELPERS ───────────────────────────────────────────────────
function getCurrentMinutes() {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
}

function formatTime(date) {
    if (!date) return '—';
    return date.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── CLOCK ─────────────────────────────────────────────────────
function initClock() {
    function tick() {
        const d = new Date();
        document.getElementById('clock').textContent =
            d.toLocaleTimeString('en-ZA', { hour12: false });
        document.getElementById('date').textContent =
            d.toLocaleDateString('en-ZA', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    }
    tick();
    setInterval(tick, 1000);
}

// ── USER DISPLAY ──────────────────────────────────────────────
function setUserDisplay(name) {
    const initials = name
        ? name.split(' ').slice(0,2).map(p => p[0]).join('').toUpperCase()
        : '?';
    document.getElementById('user-display-name').textContent = name || 'Learner';
    const av = document.getElementById('user-avatar-initials');
    if (av) av.textContent = initials;
}

async function fetchCurrentUser() {
    try {
        const res = await fetch('/api/me');
        if (res.ok) {
            const data = await res.json();
            currentUser = data;
            setUserDisplay(`${data.name} ${data.surname}`);
            loadAttendanceHistory();
        } else {
            setUserDisplay('Learner');
        }
    } catch {
        setUserDisplay('Learner');
    }
}

// ── SCHEDULED DAYS CHIPS ─────────────────────────────────────
function renderScheduledDays() {
    const todayDow = (new Date().getDay() + 6) % 7; // Mon=0
    const container = document.getElementById('sched-days-display');
    container.innerHTML = DAYS_NAMES.map((day, idx) => {
        const active  = CONFIG.scheduledDays.includes(idx);
        const isToday = (idx === todayDow);
        const outline = (isToday && active) ? ' style="outline:2px solid #10b981;outline-offset:2px;"' : '';
        return `<span class="day-chip ${active ? '' : 'off'}"${outline}>${day.slice(0,3)}${isToday ? ' ·today' : ''}</span>`;
    }).join('');
}

// ── BUTTON STATE ──────────────────────────────────────────────
function updateButtonsUI() {
    const signinBtn  = document.getElementById('signin-btn');
    const signoutBtn = document.getElementById('signout-btn');
    if (!permissionGranted) {
        signinBtn.disabled  = true;
        signoutBtn.disabled = true;
        return;
    }
    const nowMin           = getCurrentMinutes();
    const signInOpen       = nowMin >= CONFIG.signInOpenMin;   // no hard close
    const signOutWindowNow = nowMin >= CONFIG.signOutOpenMin && nowMin <= CONFIG.signOutCloseMin;

    if (signedIn && signedOut) {
        signinBtn.disabled  = true;
        signoutBtn.disabled = true;
    } else if (signedIn) {
        signinBtn.disabled  = true;
        signoutBtn.disabled = !signOutWindowNow;
        // If sign-out window closed without sign-out, disable permanently
        if (nowMin > CONFIG.signOutCloseMin) signoutBtn.disabled = true;
    } else {
        signinBtn.disabled  = !signInOpen;   // stays open all day — late alert handles it
        signoutBtn.disabled = true;
    }
}

// ── LATE ALERT BANNER ─────────────────────────────────────────
function showLateBanner(msg) {
    const banner = document.getElementById('late-alert-banner');
    const msgEl  = document.getElementById('late-alert-msg');
    msgEl.innerHTML = msg;
    banner.style.display = 'flex';
}

function hideLateBanner() {
    document.getElementById('late-alert-banner').style.display = 'none';
}

// ── STATS ─────────────────────────────────────────────────────
function updateStats() {
    const sched   = attendanceLog.filter(e => e.scheduled);
    const present = sched.filter(e => e.status === 'present').length;
    const late    = sched.filter(e => e.status === 'late').length;
    const absent  = sched.filter(e => e.status === 'absent').length;
    const total   = sched.length;
    const rate    = total ? Math.round(((present + late) / total) * 100) : 0;
    document.getElementById('stat-present').textContent = present;
    document.getElementById('stat-absent').textContent  = absent;
    document.getElementById('stat-late').textContent    = late;
    document.getElementById('stat-rate').textContent    = rate + '%';
}

// ── LOG TABLE ─────────────────────────────────────────────────
function renderLog() {
    const tbody = document.getElementById('log-tbody');
    if (!attendanceLog.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="log-empty">No attendance records yet.</td></tr>`;
        return;
    }
    tbody.innerHTML = attendanceLog.map(e => {
        const cls = e.status === 'present' ? 'badge-present' : e.status === 'late' ? 'badge-late' : 'badge-absent';
        const lbl = e.status.charAt(0).toUpperCase() + e.status.slice(1);
        const loc = (e.lat && e.lng)
            ? `<span class="loc-chip">${e.lat}, ${e.lng}</span>`
            : '<span style="color:#334155">—</span>';
        return `<tr class="${e.scheduled ? '' : 'unscheduled-row'}">
            <td>${e.date}</td>
            <td>${e.session}</td>
            <td>${e.signIn  || '—'}</td>
            <td>${e.signOut || '—'}</td>
            <td>${loc}</td>
            <td><span class="status-badge ${cls}">${lbl}</span></td>
        </tr>`;
    }).join('');
}

// Load from API
async function loadAttendanceHistory() {
    try {
        const res = await fetch('/api/attendance/history');
        if (res.ok) {
            const data = await res.json();
            attendanceLog = data.records || [];
            renderLog();
            updateStats();
        }
    } catch {
        // Keep mock data if API unavailable
        renderLog();
        updateStats();
    }
}

// ── SIGN IN ───────────────────────────────────────────────────
function doSignIn() {
    if (!permissionGranted || signedIn) return;
    const btn = document.getElementById('signin-btn');
    btn.textContent = '📍 Locating…';
    btn.disabled = true;

    navigator.geolocation.getCurrentPosition(position => {
        const now    = new Date();
        signInTimeObj = now;
        const nowMin  = now.getHours() * 60 + now.getMinutes();
        const dist    = haversineKm(position.coords.latitude, position.coords.longitude,
                                     CONFIG.venue.lat, CONFIG.venue.lng);
        const onSite  = dist <= CONFIG.maxGeoKm;
        isLateFlag    = nowMin > CONFIG.lateThresholdMin;

        signedIn = true;
        btn.textContent = '↓ Sign in';

        // ── LATE ALERT (soft warning, not a block) ──
        if (isLateFlag) {
            const lateMsg = nowMin > CONFIG.signInOpenMin
                ? `You signed in at <strong>${formatTime(now)}</strong> — this will be recorded as <strong>Late</strong>.`
                : `Sign-in registered at <strong>${formatTime(now)}</strong>.`;
            showLateBanner(lateMsg);
        }

        // ── OFF-SITE WARNING ──
        if (!onSite) {
            const distM = Math.round(dist * 1000);
            showLateBanner(`⚠ You appear to be <strong>${distM}m from the venue</strong> (max 50m). Your attendance will still be recorded but marked as unverified.`);
        }

        // ── UPDATE SIGN-IN CARD ──
        const recordedDiv = document.getElementById('signin-recorded');
        recordedDiv.style.display = 'block';
        recordedDiv.innerHTML = `✓ ${formatTime(now)} · ${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)}<br>${onSite ? '✅ On-site verified' : `⚠ ${Math.round(dist*1000)}m from venue`}${isLateFlag ? ' · <span style="color:#f59e0b">Late</span>' : ''}`;
        document.getElementById('tw-signin').style.borderColor = '#10b981';

        // ── POST TO BACKEND ──
        postSignIn(position.coords, now, onSite, isLateFlag);

        updateButtonsUI();
    }, (err) => {
        btn.textContent = '↓ Sign in';
        btn.disabled = false;
        alert('Location error: ' + (err.message || 'Could not read GPS. Check permissions.'));
    }, { enableHighAccuracy: true, timeout: 12000 });
}

async function postSignIn(coords, timestamp, geoVerified, isLate) {
    try {
        const res = await fetch('/api/attendance/signin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                geo_latitude:  coords.latitude,
                geo_longitude: coords.longitude,
                geo_verified:  geoVerified,
                check_in_time: timestamp.toISOString(),
                is_late:       isLate,
                session_name:  CONFIG.sessionName
            })
        });
        if (!res.ok) {
            const msg = await res.text();
            throw new Error(`Sign‑in failed (${res.status}): ${msg}`);
        }
    } catch (e) {
        console.error(e);
        //revert UI changes and show an alert
        signedIn = false;
        document.getElementById('signin-btn').disabled = false;
        alert('Attendance sign‑in failed. Please try again. ' + e.message);
    }
}

// ── SIGN OUT ──────────────────────────────────────────────────
function doSignOut() {
    if (!permissionGranted || !signedIn || signedOut) return;
    const btn = document.getElementById('signout-btn');
    btn.textContent = '📍 Finalizing…';
    btn.disabled = true;

    navigator.geolocation.getCurrentPosition(pos => {
        const now          = new Date();
        signOutTimeObj     = now;
        signedOut          = true;

        const signInStr    = formatTime(signInTimeObj);
        const signOutStr   = formatTime(now);
        const statusFinal  = isLateFlag ? 'late' : 'present';
        const dateStr      = now.toLocaleDateString('en-ZA', { day:'numeric', month:'short', year:'numeric' });

        attendanceLog.unshift({
            date:      dateStr,
            session:   CONFIG.sessionName,
            signIn:    signInStr,
            signOut:   signOutStr,
            lat:       pos.coords.latitude.toFixed(4),
            lng:       pos.coords.longitude.toFixed(4),
            status:    statusFinal,
            scheduled: true
        });

        renderLog();
        updateStats();

        const outDiv = document.getElementById('signout-recorded');
        outDiv.style.display = 'block';
        outDiv.innerHTML = `✓ ${signOutStr} · recorded`;
        document.getElementById('tw-signout').style.borderColor = '#10b981';

        btn.textContent = '↑ Sign out';
        updateButtonsUI();

        postSignOut(pos.coords, now);
        hideLateBanner();
    }, () => {
        btn.textContent = '↑ Sign out';
        btn.disabled = false;
        alert('Could not get location for sign-out. Please try again.');
    }, { enableHighAccuracy: true, timeout: 12000 });
}

async function postSignOut(coords, timestamp) {
    try {
        const res = await fetch('/api/attendance/signout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                geo_latitude:   coords.latitude,
                geo_longitude:  coords.longitude,
                check_out_time: timestamp.toISOString(),
                session_name:   CONFIG.sessionName
            })
        });
        if (!res.ok) {
            const msg = await res.text();
            throw new Error(`Sign‑in failed (${res.status}): ${msg}`);
        }
    } catch (e) {
       console.error(e);
        // 👇 revert UI changes and show an alert
        signedIn = false;
        document.getElementById('signin-btn').disabled = false;
        alert('Attendance sign‑in failed. Please try again. ' + e.message);
    }
}

// ── PERMISSION FLOW ───────────────────────────────────────────
function requestLocationPermission() {
    const btn = document.getElementById('allow-location-btn');
    btn.textContent = 'Requesting…';
    btn.disabled = true;

    navigator.geolocation.getCurrentPosition(
        () => {
            permissionGranted = true;
            document.getElementById('permission-gate').style.display = 'none';
            document.getElementById('denied-state').style.display    = 'none';
            updateButtonsUI();
        },
        () => {
            permissionGranted = false;
            document.getElementById('permission-gate').style.display = 'none';
            document.getElementById('denied-state').style.display    = 'block';
            btn.textContent = 'Allow location access';
            btn.disabled = false;
            updateButtonsUI();
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

function denyLocation() {
    permissionGranted = false;
    document.getElementById('permission-gate').style.display = 'none';
    document.getElementById('denied-state').style.display    = 'block';
    updateButtonsUI();
}

function retryPermission() {
    document.getElementById('denied-state').style.display    = 'none';
    document.getElementById('permission-gate').style.display = 'flex';
}

function checkInitialPermissions() {
    if (!('geolocation' in navigator)) {
        document.getElementById('permission-gate').style.display = 'flex';
        return;
    }
    navigator.permissions.query({ name: 'geolocation' }).then(perm => {
        if (perm.state === 'granted') {
            permissionGranted = true;
            document.getElementById('permission-gate').style.display = 'none';
            updateButtonsUI();
        } else if (perm.state === 'denied') {
            document.getElementById('permission-gate').style.display = 'none';
            document.getElementById('denied-state').style.display    = 'block';
        } else {
            document.getElementById('permission-gate').style.display = 'flex';
        }
        perm.onchange = () => { if (perm.state === 'granted') location.reload(); };
    }).catch(() => {
        document.getElementById('permission-gate').style.display = 'flex';
    });
}

// ── INIT ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
    initClock();
    renderScheduledDays();
    renderLog();
    updateStats();
    checkInitialPermissions();
    fetchCurrentUser();

    document.getElementById('allow-location-btn').addEventListener('click', requestLocationPermission);
    document.getElementById('deny-location-btn').addEventListener('click', denyLocation);
    document.getElementById('retry-perm-btn').addEventListener('click', retryPermission);
    document.getElementById('signin-btn').addEventListener('click', doSignIn);
    document.getElementById('signout-btn').addEventListener('click', doSignOut);
    document.getElementById('dismiss-late-banner').addEventListener('click', hideLateBanner);

    setInterval(updateButtonsUI, 1000);
});