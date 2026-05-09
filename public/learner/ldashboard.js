/* ── Sidebar active state ── */
  function setActive(el) {
    document.querySelectorAll('.sitem').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
  }

  /* ── Logout ── */
  function handleLogout() {
    if (confirm('Are you sure you want to log out?')) {
      alert('Logged out. Redirect to login page here.');
    }
  }

  /* ── Attendance modal ── */
  function openModal() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    document.getElementById('attend-date').value =
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    document.getElementById('confirm-msg').classList.remove('show');
    document.getElementById('attend-notes').value = '';
    document.getElementById('modal-overlay').classList.add('show');
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.remove('show');
  }

  function submitAttendance() {
    const status = document.getElementById('attend-status').value;
    const date   = document.getElementById('attend-date').value;
    const notes  = document.getElementById('attend-notes').value;
    /* TODO: send to backend API — e.g.:
       fetch('/api/attendance', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ date, status, notes })
       });
    */
    console.log('Attendance captured:', { date, status, notes });
    document.getElementById('confirm-msg').classList.add('show');
    setTimeout(() => closeModal(), 1800);
  }

  /* Close modal on overlay click */
  document.getElementById('modal-overlay').addEventListener('click', function(e) {
    if (e.target === this) closeModal();
  });

  /* ── Build attendance calendar ── */
  (function buildCalendar() {
    const grid    = document.getElementById('cal-grid');
    const present = [1, 2, 3, 7, 8, 9, 10, 14, 15];
    const absent  = [4];
    const today   = 16;
    const startDay = 1; /* April 2025 starts on Tuesday (index 1 in Mon-first grid) */

    /* Empty cells before day 1 */
    for (let i = 0; i < startDay; i++) {
      const blank = document.createElement('div');
      blank.style.height = '23px';
      grid.appendChild(blank);
    }

    for (let d = 1; d <= 30; d++) {
      const cell = document.createElement('div');
      cell.classList.add('cal-day');

      let bg    = 'var(--bg-secondary)';
      let color = 'var(--text-tertiary)';
      let fw    = '400';

      if (present.includes(d)) { bg = '#1d9e75'; color = '#fff'; }
      else if (absent.includes(d)) { bg = '#e24b4a'; color = '#fff'; }

      if (d === today) { fw = '700'; }

      cell.style.cssText = `background:${bg};color:${color};font-weight:${fw};` +
        (d === today ? 'outline:2px solid #185fa5;outline-offset:1px;' : '');
      cell.textContent = d;

      cell.title = present.includes(d) ? `${d} Apr — Present`
                 : absent.includes(d)  ? `${d} Apr — Absent`
                 : `${d} Apr`;

      grid.appendChild(cell);
    }
  })();