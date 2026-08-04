// admin/feedback.js

let learnerId = null;

function getLearnerId() {
  return new URLSearchParams(window.location.search).get('learner');
}

document.addEventListener('DOMContentLoaded', async () => {
  learnerId = getLearnerId();
  if (!learnerId) {
    document.getElementById('learner-name').textContent = 'No learner specified.';
    return;
  }
  document.getElementById('back-link').href = `learner-profile.html?id=${learnerId}`;
  document.getElementById('bc-learner-link').href = `learner-profile.html?id=${learnerId}`;

  await loadHeader();
  await loadThread();
});

async function loadHeader() {
  try {
    const res  = await fetch(`/api/learners/${learnerId}/profile`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    const l = data.learner;
    const name = [l.name, l.surname].filter(Boolean).join(' ') || '—';
    document.title = `Feedback — ${name}`;
    document.getElementById('learner-name').textContent = name;
    document.getElementById('bc-learner-link').textContent = name;

    const chips = [
      l.deal_number ? `<span class="meta-chip chip-qual">Deal #${l.deal_number}</span>` : '',
      l.qualification_title ? `<span class="meta-chip chip-nqf">${escHtml(l.qualification_title)}</span>` : '',
    ].filter(Boolean).join('');
    document.getElementById('learner-meta-row').innerHTML = chips || '<span style="color:var(--text-3);font-size:12px">No metadata</span>';

    if (!l.deal_number) {
      showFacilitatorWarning('This learner has no deal linked — link them to a deal with a facilitator before sending feedback.');
    }
  } catch (err) {
    document.getElementById('learner-name').textContent = 'Failed to load learner.';
  }
}

function showFacilitatorWarning(msg) {
  const el = document.getElementById('fb-facilitator-warning');
  el.textContent = msg;
  el.style.display = 'block';
  document.getElementById('fb-send-btn').disabled = true;
}

async function loadThread() {
  const thread = document.getElementById('fb-thread');
  try {
    const res  = await fetch(`/api/learners/${learnerId}/feedback`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    document.getElementById('fb-count').textContent = `${data.feedback.length} message${data.feedback.length !== 1 ? 's' : ''}`;

    if (!data.feedback.length) {
      thread.innerHTML = `
        <div class="empty-state">
          <div class="empty-title">No feedback yet</div>
          <div class="empty-sub">Messages sent to or from this learner will appear here.</div>
        </div>`;
      return;
    }

    thread.innerHTML = data.feedback.map(renderMessage).join('');
  } catch (err) {
    thread.innerHTML = `
      <div class="empty-state">
        <div class="empty-title">Could not load feedback</div>
        <div class="empty-sub">${escHtml(err.message)}</div>
      </div>`;
  }
}

function renderMessage(f) {
  const fromName = f.from_role === 'learner'
    ? [f.from_name, f.from_surname].filter(Boolean).join(' ') || 'Learner'
    : [f.from_name, f.from_surname].filter(Boolean).join(' ') || 'Staff';
  const when = f.sent_at
    ? new Date(f.sent_at).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

  return `
    <div class="fb-msg">
      <div class="fb-msg-head">
        <span class="fb-msg-from ${f.from_role === 'learner' ? 'learner' : ''}">${escHtml(fromName)}${f.from_role === 'learner' ? ' (learner)' : ''}</span>
        <span class="fb-msg-time">${when}</span>
      </div>
      ${f.subject ? `<div class="fb-msg-subject">${escHtml(f.subject)}</div>` : ''}
      <div class="fb-msg-body">${escHtml(f.message)}</div>
    </div>`;
}

async function sendFeedback() {
  const type    = document.getElementById('fb-type').value;
  const subject = document.getElementById('fb-subject').value.trim();
  const message = document.getElementById('fb-message').value.trim();

  if (!message) {
    showToast('Message cannot be empty.');
    return;
  }

  const btn = document.getElementById('fb-send-btn');
  btn.disabled = true;
  btn.textContent = 'Sending…';

  try {
    const res  = await fetch(`/api/learners/${learnerId}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback_type: type, subject, message }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    document.getElementById('fb-subject').value = '';
    document.getElementById('fb-message').value = '';
    showToast('Feedback sent.');
    await loadThread();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send feedback';
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 3200);
}

function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}