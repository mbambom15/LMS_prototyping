const params = new URLSearchParams(window.location.search);
const submissionId = params.get('id');

function logoutAction() {
    window.location.href = '/logout';
}

function initials(name, surname) {
    return `${(name || '?')[0] || ''}${(surname || '?')[0] || ''}`.toUpperCase();
}

function fmtDateTime(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtSize(bytes) {
    if (!bytes) return '';
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

async function apiGet(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || `Request failed: ${res.status}`);
    return data;
}

async function apiPost(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || `Request failed: ${res.status}`);
    return data;
}

let currentSubmission = null;

if (!submissionId) {
    document.getElementById('pg-loading-card').innerHTML =
        `<div class="empty-state" style="padding: 40px;">No submission specified.</div>`;
} else {
    loadSubmission();
}

async function loadSubmission() {
    try {
        const resp = await apiGet(`/api/facilitator/project-submissions/${submissionId}`);
        currentSubmission = resp.submission;
        renderSubmission(currentSubmission);
    } catch (err) {
        console.error('loadSubmission error:', err);
        document.getElementById('pg-loading-card').innerHTML =
            `<div class="empty-state" style="padding: 40px;">Couldn't load this submission: ${err.message}</div>`;
    }
}

function renderSubmission(s) {
    document.getElementById('pg-loading-card').style.display = 'none';
    ['pg-content-card', 'pg-project-card', 'pg-submission-card', 'pg-grade-card'].forEach(id => {
        document.getElementById(id).style.display = 'block';
    });

    document.getElementById('pg-learner-name').textContent = `${s.name} ${s.surname}`;
    document.getElementById('pg-status-badge').textContent = s.status;
    document.getElementById('pg-status-badge').className = `badge ${s.status === 'graded' ? 'badge-green' : 'badge-amber'}`;
    document.getElementById('pg-learner-email').textContent = s.email || '—';
    document.getElementById('pg-deal').textContent = s.deal_number ? `#${s.deal_number} — ${s.sponsor || ''}` : '—';
    document.getElementById('pg-unit').textContent = `Unit ${s.unit_number}: ${s.unit_title}`;
    document.getElementById('pg-submitted').textContent = fmtDateTime(s.submitted_at);

    document.getElementById('pg-project-title').textContent = s.project_title;
    document.getElementById('pg-project-desc').textContent = s.project_description || '';
    document.getElementById('pg-total-marks').textContent = s.total_marks;
    document.getElementById('pg-pass-mark').textContent = `${s.pass_mark_pct}%`;

    if (s.brief_url) {
        document.getElementById('pg-brief-row').style.display = 'block';
        document.getElementById('pg-brief-link').href = s.brief_url;
    }

    document.getElementById('pg-submission-filename').textContent =
        s.submission_file_name ? `${s.submission_file_name} (${fmtSize(s.file_size_bytes)})` : 'No file on record';
    if (s.submission_file_view_url) document.getElementById('pg-view-link').href = s.submission_file_view_url;
    if (s.submission_file_download_url) document.getElementById('pg-download-link').href = s.submission_file_download_url;

    document.getElementById('pg-score-max').textContent = s.total_marks;
    const scoreInput = document.getElementById('pg-score-input');
    scoreInput.max = s.total_marks;
    if (s.score != null) scoreInput.value = s.score;

    const commentInput = document.getElementById('pg-comment-input');
    if (s.feedback) commentInput.value = s.feedback;

    const finishBtn = document.getElementById('pg-finish-btn');
    finishBtn.textContent = s.status === 'graded' ? 'Update grade' : 'Finish grading';
}

async function finishGrading() {
    const scoreInput = document.getElementById('pg-score-input');
    const commentInput = document.getElementById('pg-comment-input');
    const statusEl = document.getElementById('pg-save-status');
    const btn = document.getElementById('pg-finish-btn');

    const score = scoreInput.value;
    if (score === '' || Number.isNaN(Number(score))) {
        alert('Please enter a numeric score.');
        return;
    }
    if (Number(score) < 0 || Number(score) > Number(currentSubmission.total_marks)) {
        alert(`Score must be between 0 and ${currentSubmission.total_marks}.`);
        return;
    }

    btn.disabled = true;
    statusEl.textContent = 'Saving…';
    try {
        await apiPost(`/api/facilitator/project-submissions/${submissionId}/grade`, {
            score: Number(score),
            feedback: commentInput.value.trim(),
        });
        statusEl.textContent = 'Saved — grading complete.';
        document.getElementById('pg-status-badge').textContent = 'graded';
        document.getElementById('pg-status-badge').className = 'badge badge-green';
        btn.textContent = 'Update grade';
        btn.disabled = false;
    } catch (err) {
        console.error('finishGrading error:', err);
        statusEl.textContent = '';
        btn.disabled = false;
        alert(err.message || "Couldn't save the grade.");
    }
}

(async function initFacilitatorAvatar() {
    try {
        const resp = await apiGet('/api/facilitator/me');
        const el = document.getElementById('facilitator-initials');
        if (el && resp.facilitator) el.textContent = initials(resp.facilitator.name, resp.facilitator.surname);
    } catch (err) {
        // Non-critical
    }
})();