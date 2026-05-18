function updateDateTime() {
    const now = new Date();
    const options = { timeZone: "Africa/Johannesburg" };

    const time = now.toLocaleTimeString("en-ZA", { ...options, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const date = now.toLocaleDateString("en-ZA", { ...options, weekday: "long", day: "numeric", month: "long", year: "numeric" });

    document.getElementById("clock").textContent = time;
    document.getElementById("date").textContent = date;
}

setInterval(updateDateTime, 1000);
updateDateTime();

// SpecCon reference point (your coordinates)
const SPECCON_LAT = -25.82731638243808;
const SPECCON_LNG = 28.2034515438192;
const ALLOWED_RADIUS_M = 50

    ;
//this is going to be the javascript to build ui interactiveness
// ---------- CONFIGURATION ----------
const CONFIG = {
    scheduledDays: [1, 3],     // Tuesday (1) + Thursday (3) -> Monday=0
    venue: { lat: -25.82731638243808, lng: 28.2034515438192 },
    maxGeoKm: 0.2,
    signInDeadlineMin: 9 * 60,    // 09:00
    signOutDeadlineMin: 15 * 60,  // 15:00
    signOutOpenMin: 14 * 60 + 30, // 14:30
    sessionName: 'Data Science 101'
};

const DAYS_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

// Global state
let permissionGranted = false;
let signedIn = false;
let signedOut = false;
let signInTimeObj = null;
let signOutTimeObj = null;
let signInCoords = null;
let signOutCoords = null;
let isLateFlag = false;

// attendance log (mock historical)
let attendanceLog = []

// helper: minutes since midnight
function getCurrentMinutes() {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
}

// format HH:MM
function formatTime(date) {
    if (!date) return '—';
    return date.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// haversine distance
function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Update UI buttons depending on state & time
function updateButtonsUI() {
    const signinBtn = document.getElementById('signin-btn');
    const signoutBtn = document.getElementById('signout-btn');
    if (!permissionGranted) {
        signinBtn.disabled = true;
        signoutBtn.disabled = true;
        return;
    }
    const nowMin = getCurrentMinutes();
    const canSignIn = (!signedIn && nowMin <= CONFIG.signInDeadlineMin && nowMin >= 7 * 60);
    const signOutWindowOpen = (nowMin >= CONFIG.signOutOpenMin && nowMin <= CONFIG.signOutDeadlineMin);
    if (signedIn && !signedOut) {
        signinBtn.disabled = true;
        signoutBtn.disabled = !signOutWindowOpen;
    } else if (signedOut || (signedIn && signedOut)) {
        signinBtn.disabled = true;
        signoutBtn.disabled = true;
    } else {
        signinBtn.disabled = !canSignIn;
        signoutBtn.disabled = true;
    }

    // extra: if deadline passed disable signin forever
    if (nowMin > CONFIG.signInDeadlineMin && !signedIn) signinBtn.disabled = true;
    if (nowMin > CONFIG.signOutDeadlineMin && signedIn && !signedOut) signoutBtn.disabled = true;
}

// update stats based on scheduled days only
function updateStats() {
    const scheduledEntries = attendanceLog.filter(e => e.scheduled === true);
    const present = scheduledEntries.filter(e => e.status === 'present').length;
    const late = scheduledEntries.filter(e => e.status === 'late').length;
    const absent = scheduledEntries.filter(e => e.status === 'absent').length;
    const total = scheduledEntries.length;
    const rate = total ? Math.round(((present + late) / total) * 100) : 0;
    document.getElementById('stat-present').innerText = present;
    document.getElementById('stat-absent').innerText = absent;
    document.getElementById('stat-late').innerText = late;
    document.getElementById('stat-rate').innerText = rate + '%';
}

// render attendance log table
function renderLog() {
    const tbody = document.getElementById('log-tbody');
    tbody.innerHTML = attendanceLog.map(entry => {
        let statusClass = '';
        let statusLabel = '';
        if (entry.status === 'present') { statusClass = 'badge-present'; statusLabel = 'Present'; }
        else if (entry.status === 'late') { statusClass = 'badge-late'; statusLabel = 'Late'; }
        else { statusClass = 'badge-absent'; statusLabel = 'Absent'; }

        const locHtml = (entry.lat && entry.lng) ? `<span class="loc-chip">${entry.lat}, ${entry.lng}</span>` : '<span style="color:#94a3b8;">—</span>';
        const rowClass = entry.scheduled ? '' : 'unscheduled-row';
        return `<tr class="${rowClass}">
                    <td>${entry.date}</td>
                    <td>${entry.session}</td>
                    <td>${entry.signIn || '—'}</td>
                    <td>${entry.signOut || '—'}</td>
                    <td>${locHtml}</td>
                    <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                </tr>`;
    }).join('');
}

// show scheduled days chips
function renderScheduledDays() {
    const todayDow = (new Date().getDay() + 6) % 7; // mon=0
    const container = document.getElementById('sched-days-display');
    container.innerHTML = DAYS_NAMES.slice(0, 5).map((day, idx) => {
        const active = CONFIG.scheduledDays.includes(idx);
        const isToday = (idx === todayDow);
        let extra = '';
        if (isToday && active) extra = ' style="outline:2px solid #0f7b4c; outline-offset:2px;"';
        return `<span class="day-chip ${active ? '' : 'off'}" ${extra}>${day.slice(0, 3)}${isToday ? ' (today)' : ''}</span>`;
    }).join('');
}

// record sign in with location
function doSignIn() {
    if (!permissionGranted) return;
    if (signedIn) return;
    const btn = document.getElementById('signin-btn');
    btn.innerText = '📍 Locating...';
    btn.disabled = true;
    navigator.geolocation.getCurrentPosition(position => {
        const now = new Date();
        signInTimeObj = now;
        signInCoords = position.coords;
        const dist = haversine(position.coords.latitude, position.coords.longitude, CONFIG.venue.lat, CONFIG.venue.lng);
        const verified = dist <= CONFIG.maxGeoKm;
        const minutesNow = now.getHours() * 60 + now.getMinutes();
        const lateArrival = minutesNow > CONFIG.signInDeadlineMin;
        isLateFlag = lateArrival;
        signedIn = true;

        const timeStr = formatTime(now);
        const recordedDiv = document.getElementById('signin-recorded');
        recordedDiv.style.display = 'block';
        recordedDiv.innerHTML = `✓ ${timeStr} · ${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)} ${verified ? '✓ On-site' : '⚠ Distance ' + dist.toFixed(2) + 'km'}`;
        document.getElementById('tw-signin').style.border = '1px solid #0f7b4c';
        btn.innerText = '↓ Sign in';
        updateButtonsUI();

        // auto update status later
    }, (err) => {
        btn.innerText = '↓ Sign in';
        btn.disabled = false;
        alert('Location error: could not verify sign-in. Check GPS permissions.');
    }, { enableHighAccuracy: true, timeout: 10000 });
}

function doSignOut() {
    if (!permissionGranted || !signedIn || signedOut) return;
    const btn = document.getElementById('signout-btn');
    btn.innerText = '📍 Finalizing...';
    btn.disabled = true;
    navigator.geolocation.getCurrentPosition(pos => {
        const now = new Date();
        signOutTimeObj = now;
        signOutCoords = pos.coords;
        signedOut = true;

        const signInTimeStr = formatTime(signInTimeObj);
        const signOutTimeStr = formatTime(now);
        const statusFinal = isLateFlag ? 'late' : 'present';
        const todayDateStr = new Date().toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
        // push new log entry
        attendanceLog.unshift({
            date: todayDateStr,
            session: CONFIG.sessionName,
            signIn: signInTimeStr,
            signOut: signOutTimeStr,
            lat: pos.coords.latitude.toFixed(4),
            lng: pos.coords.longitude.toFixed(4),
            status: statusFinal,
            scheduled: true
        });
        renderLog();
        updateStats();

        document.getElementById('signout-recorded').style.display = 'block';
        document.getElementById('signout-recorded').innerHTML = `✓ ${signOutTimeStr} · recorded`;
        document.getElementById('tw-signout').style.border = '1px solid #0f7b4c';
        btn.innerText = '↑ Sign out';
        updateButtonsUI();
    }, () => {
        btn.innerText = '↑ Sign out';
        btn.disabled = false;
        alert('Could not get location for sign-out');
    });
}

// ---------- LOCATION MODAL HANDLING ----------
function requestLocationPermission() {
    const permBtn = document.getElementById('allow-location-btn');
    permBtn.innerText = 'Requesting...';
    permBtn.disabled = true;
    navigator.geolocation.getCurrentPosition(
        (position) => {
            permissionGranted = true;
            document.getElementById('permission-gate').style.display = 'none';
            document.getElementById('denied-state').style.display = 'none';
            updateButtonsUI();
        },
        (error) => {
            permissionGranted = false;
            document.getElementById('permission-gate').style.display = 'none';
            document.getElementById('denied-state').style.display = 'block';
            updateButtonsUI();
        },
        { enableHighAccuracy: true, timeout: 8000 }
    );
}

function denyLocation() {
    permissionGranted = false;
    document.getElementById('permission-gate').style.display = 'none';
    document.getElementById('denied-state').style.display = 'block';
    updateButtonsUI();
}

function retryPermission() {
    document.getElementById('denied-state').style.display = 'none';
    document.getElementById('permission-gate').style.display = 'flex';
}

// init clock and permissions check
function initClock() {
    function tick() {
        const d = new Date();
        document.getElementById('clock').innerText = d.toLocaleTimeString('en-ZA', { hour12: false });
        document.getElementById('date').innerText = d.toLocaleDateString('en-ZA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }
    tick();
    setInterval(tick, 1000);
}

function checkInitialPermissions() {
    if ('geolocation' in navigator) {
        navigator.permissions.query({ name: 'geolocation' }).then(permStatus => {
            if (permStatus.state === 'granted') {
                permissionGranted = true;
                document.getElementById('permission-gate').style.display = 'none';
                updateButtonsUI();
            } else if (permStatus.state === 'prompt') {
                document.getElementById('permission-gate').style.display = 'flex';
            } else {
                document.getElementById('permission-gate').style.display = 'none';
                document.getElementById('denied-state').style.display = 'block';
            }
            permStatus.onchange = () => {
                if (permStatus.state === 'granted') location.reload();
            };
        }).catch(() => {
            document.getElementById('permission-gate').style.display = 'flex';
        });
    } else {
        document.getElementById('permission-gate').style.display = 'flex';
    }
}

// attach event listeners & UI
window.addEventListener('DOMContentLoaded', () => {
    initClock();
    renderScheduledDays();
    renderLog();
    updateStats();
    checkInitialPermissions();

    document.getElementById('allow-location-btn').addEventListener('click', requestLocationPermission);
    document.getElementById('deny-location-btn').addEventListener('click', denyLocation);
    document.getElementById('retry-perm-btn').addEventListener('click', retryPermission);
    document.getElementById('signin-btn').addEventListener('click', doSignIn);
    document.getElementById('signout-btn').addEventListener('click', doSignOut);

    setInterval(() => updateButtonsUI(), 1000);
});
