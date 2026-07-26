/* ── Sidebar helpers — duplicated from ldashboard.js/materials.js on
   purpose, same reasoning as materials.js already documents: this page
   doesn't load those files, since their DOMContentLoaded handlers drive
   widgets (welcome bar, materials accordion) that don't exist here. ── */
function setActive(el) {
    document.querySelectorAll('.sitem').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
}

function navigateTo(el, url) {
    setActive(el);
    window.location.href = url;
}

function handleLogout() {
    if (confirm('Are you sure you want to log out?')) {
        window.location.href = '/logout';
    }
}

async function loadHeaderInitials() {
    try {
        const res = await fetch('/api/me');
        if (!res.ok) { window.location.href = '/login'; return; }
        const user = await res.json();
        const fullName = [user.name, user.surname].filter(Boolean).join(' ') || user.email || 'User';
        const initials = fullName.split(' ').slice(0, 2).map(p => p[0].toUpperCase()).join('');
        document.getElementById('header-initials').textContent = initials;
    } catch (err) {
        console.error('Could not load user:', err);
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    await loadHeaderInitials();

    const container = document.getElementById('assessments-units');
    // Sidebar clicks (navigateTo/setActive above) are independent of this —
    // they're already live the moment this script parses, regardless of
    // whether the assessments module below loads successfully. If this
    // block fails, it should never be able to make the rest of the page
    // unresponsive; the worst case is this one panel showing an error.
    try {
        if (typeof LearnerAssessments === 'undefined') {
            throw new Error('assessments.js did not load — check that the file exists at /learner/assessments.js');
        }
        await LearnerAssessments.init(container);
    } catch (err) {
        console.error('Could not start LearnerAssessments:', err);
        container.innerHTML = `<div class="panel" style="padding:16px;color:var(--text-danger);font-size:13px">
            Could not load assessments (${err.message}). Try refreshing the page.
        </div>`;
    }
});