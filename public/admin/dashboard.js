/* ── Section navigation ── */
  function showSection(name, el) {
    document.querySelectorAll('.section-page').forEach(s => s.classList.remove('visible'));
    document.getElementById('section-' + name).classList.add('visible');
    document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
    if (el) el.classList.add('active');
  }

  /* ── CRUD toggle panels ── */
  function toggleArea(id) {
    const target = document.getElementById(id);
    const isOpen = target.classList.contains('visible');
    document.querySelectorAll('.content-area').forEach(el => el.classList.remove('visible'));
    if (!isOpen) target.classList.add('visible');
  }

  /* ── Logout placeholder ── */
  function handleLogout() {
    if (confirm('Are you sure you want to log out?')) {
      alert('Logged out. Redirect to login page here.');
    }
  }

  /* ── Qual data for preview ── */
  const qualData = {
    it:  { title: 'IT Support — NQF 4',            seta: 'MICT SETA · 12 months' },
    ba:  { title: 'Business Administration — NQF 3', seta: 'SERVICES SETA · 12 months' },
    fin: { title: 'Finance & Accounting — NQF 4',   seta: 'FASSET · 18 months' }
  };

  function updatePreview() {
    const q    = document.getElementById('qual-select').value;
    const uSel = document.getElementById('unit-select');
    const uText = uSel.options[uSel.selectedIndex].text;
    const uNum  = uSel.selectedIndex + 1;
    const desc  = document.getElementById('desc-input').value;
    document.getElementById('prev-title').textContent     = qualData[q].title;
    document.getElementById('prev-seta').textContent      = qualData[q].seta;
    document.getElementById('prev-unit-name').textContent = uText;
    document.getElementById('prev-unit-num').textContent  = uNum;
    document.getElementById('prev-desc').textContent      = desc || 'No description provided.';
    const count = document.getElementById('file-list').children.length;
    document.getElementById('prev-file-count').textContent = count;
  }

  /* ── File upload handling ── */
  const typeMap = {
    pdf:  { label: 'PDF',  bg: '#fcebeb', color: '#a32d2d' },
    mp4:  { label: 'MP4',  bg: '#e6f1fb', color: '#185fa5' },
    pptx: { label: 'PPT',  bg: '#faece7', color: '#993c1d' },
    ppt:  { label: 'PPT',  bg: '#faece7', color: '#993c1d' },
    docx: { label: 'DOC',  bg: '#faeeda', color: '#633806' },
    doc:  { label: 'DOC',  bg: '#faeeda', color: '#633806' }
  };

  function handleFiles(files) {
    const list = document.getElementById('file-list');
    const grid = document.getElementById('prev-materials');
    Array.from(files).forEach(f => {
      const ext  = f.name.split('.').pop().toLowerCase();
      const t    = typeMap[ext] || { label: ext.toUpperCase(), bg: '#f1efe8', color: '#5f5e5a' };
      const size = f.size > 1048576
        ? (f.size / 1048576).toFixed(1) + ' MB'
        : (f.size / 1024).toFixed(0) + ' KB';

      const item = document.createElement('div');
      item.className = 'file-item';
      item.innerHTML = `
        <div class="file-icon" style="background:${t.bg};color:${t.color}">${t.label}</div>
        <span class="file-name">${f.name}</span>
        <span class="file-size">${size}</span>
        <span class="file-remove" onclick="removeFile(this)">Remove</span>`;
      list.appendChild(item);

      const tile = document.createElement('div');
      tile.className = 'material-tile';
      tile.innerHTML = `
        <div class="material-tile-icon" style="background:${t.bg};color:${t.color}">${t.label}</div>
        <div class="material-tile-name">${f.name}</div>
        <div class="material-tile-size">${size}</div>`;
      grid.appendChild(tile);

      document.getElementById('prev-file-count').textContent =
        document.getElementById('file-list').children.length;
    });
  }

  function removeFile(el) {
    el.closest('.file-item').remove();
    document.getElementById('prev-file-count').textContent =
      document.getElementById('file-list').children.length;
  }

  /* ── Drag and drop support ── */
  const dropZone = document.querySelector('.drop-zone');
  if (dropZone) {
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.background = 'var(--bg-tertiary)'; });
    dropZone.addEventListener('dragleave', () => { dropZone.style.background = 'var(--bg-secondary)'; });
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.style.background = 'var(--bg-secondary)';
      handleFiles(e.dataTransfer.files);
    });
  }

/**Adding the retrieval of user data - add password validation. */