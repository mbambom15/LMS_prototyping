// admin/attendance.js

const PAGE_SIZE = 60;
let allRecords = [];
let offset = 0;
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
  await loadPage();
});

async function loadHeader() {
  try {
    const res  = await fetch(`/api/learners/${learnerId}/profile`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    const l = data.learner;
    const name = [l.name, l.surname].filter(Boolean).join(' ') || '—';
    document.title = `Attendance — ${name}`;
    document.getElementById('learner-name').textContent = name;
    document.getElementById('bc-learner-link').textContent = name;

    const chips = [
      l.deal_number ? `<span class="meta-chip chip-qual">Deal #${l.deal_number}</span>` : '',
      l.qualification_title ? `<span class="meta-chip chip-nqf">${escHtml(l.qualification_title)}</span>` : '',
    ].filter(Boolean).join('');
    document.getElementById('learner-meta-row').innerHTML = chips || '<span style="color:var(--text-3);font-size:12px">No metadata</span>';

    const s = data.attendance_summary || {};
    document.getElementById('stat-present').textContent = s.present_count || 0;
    document.getElementById('stat-absent').textContent  = s.absent_count  || 0;
    document.getElementById('stat-late').textContent    = s.late_count    || 0;
    document.getElementById('stat-excused').textContent = s.excused_count || 0;
  } catch (err) {
    document.getElementById('learner-name').textContent = 'Failed to load learner.';
  }
}

async function loadPage() {
  try {
    const res  = await fetch(`/api/learners/${learnerId}/attendance?limit=${PAGE_SIZE}&offset=${offset}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    allRecords = offset === 0 ? data.attendance : allRecords.concat(data.attendance);
    offset += data.attendance.length;

    document.getElementById('load-more-btn').style.display = data.attendance.length === PAGE_SIZE ? 'inline-flex' : 'none';
    applyFilter();
  } catch (err) {
    document.getElementById('attendance-tbody').innerHTML = `
      <tr><td colspan="6"><div class="empty-state">
        <div class="empty-title">Could not load attendance</div>
        <div class="empty-sub">${escHtml(err.message)}</div>
      </div></td></tr>`;
  }
}

function loadMore() {
  loadPage();
}

function applyFilter() {
  const status = document.getElementById('filter-status').value;
  const filtered = status ? allRecords.filter(r => r.status === status) : allRecords;

  document.getElementById('record-count').textContent = `${filtered.length} of ${allRecords.length} record${allRecords.length !== 1 ? 's' : ''}`;

  const tbody = document.getElementById('attendance-tbody');
  if (!filtered.length) {
    tbody.innerHTML = `
      <tr><td colspan="6"><div class="empty-state">
        <div class="empty-title">No records</div>
        <div class="empty-sub">No attendance entries match this filter.</div>
      </div></td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(renderRow).join('');
}

function renderRow(r) {
  const date = new Date(r.attendance_date).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
  const checkIn  = r.check_in_time  ? new Date(r.check_in_time).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })  : '—';
  const checkOut = r.check_out_time ? new Date(r.check_out_time).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '—';

  return `
    <tr>
      <td style="font-family:'JetBrains Mono',monospace;font-size:12px">${date}</td>
      <td><span class="att-pill att-${r.status}">${escHtml(r.status)}</span></td>
      <td>${checkIn}</td>
      <td>${checkOut}</td>
      <td>${r.geo_verified ? '✓' : '—'}</td>
      <td style="color:var(--text-2);font-size:12px">${escHtml(r.notes || '—')}</td>
    </tr>`;
}

function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}