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
  it: { title: 'IT Support — NQF 4', seta: 'MICT SETA · 12 months' },
  ba: { title: 'Business Administration — NQF 3', seta: 'SERVICES SETA · 12 months' },
  fin: { title: 'Finance & Accounting — NQF 4', seta: 'FASSET · 18 months' }
};

function updatePreview() {
  const q = document.getElementById('qual-select').value;
  const uSel = document.getElementById('unit-select');
  const uText = uSel.options[uSel.selectedIndex].text;
  const uNum = uSel.selectedIndex + 1;
  const desc = document.getElementById('desc-input').value;
  document.getElementById('prev-title').textContent = qualData[q].title;
  document.getElementById('prev-seta').textContent = qualData[q].seta;
  document.getElementById('prev-unit-name').textContent = uText;
  document.getElementById('prev-unit-num').textContent = uNum;
  document.getElementById('prev-desc').textContent = desc || 'No description provided.';
  const count = document.getElementById('file-list').children.length;
  document.getElementById('prev-file-count').textContent = count;
}

/* ── File upload handling ── */
const typeMap = {
  pdf: { label: 'PDF', bg: '#fcebeb', color: '#a32d2d' },
  mp4: { label: 'MP4', bg: '#e6f1fb', color: '#185fa5' },
  pptx: { label: 'PPT', bg: '#faece7', color: '#993c1d' },
  ppt: { label: 'PPT', bg: '#faece7', color: '#993c1d' },
  docx: { label: 'DOC', bg: '#faeeda', color: '#633806' },
  doc: { label: 'DOC', bg: '#faeeda', color: '#633806' }
};

function handleFiles(files) {
  const list = document.getElementById('file-list');
  const grid = document.getElementById('prev-materials');
  Array.from(files).forEach(f => {
    const ext = f.name.split('.').pop().toLowerCase();
    const t = typeMap[ext] || { label: ext.toUpperCase(), bg: '#f1efe8', color: '#5f5e5a' };
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

/* ── Helper: show message on add user form ── */
function showMessage(text, type) {
  let msgDiv = document.getElementById('addUserMessage');
  if (!msgDiv) {
    const form = document.getElementById('addUserForm');
    if (!form) return;
    msgDiv = document.createElement('div');
    msgDiv.id = 'addUserMessage';
    msgDiv.style.marginTop = '12px';
    msgDiv.style.fontSize = '13px';
    form.appendChild(msgDiv);
  }
  msgDiv.textContent = text;
  msgDiv.className = type === 'success' ? 'success-message' : 'error-message';
  msgDiv.style.display = 'block';
  setTimeout(() => {
    msgDiv.style.display = 'none';
  }, 5000);
}

/* ── Refresh user table (placeholder) ── */
async function refreshUserTable() {
  console.log('Refresh user table - implement later');
  // You can later call an API to fetch all users and update the table
}

/**Adding the retrieval of user data - add password validation.  */
document.addEventListener('DOMContentLoaded', function () {
  const addUserForm = document.getElementById('addUserForm');
  if (!addUserForm) return;

  addUserForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const firstName = document.getElementById('first_name').value.trim();
    const lastName = document.getElementById('last_name').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const idNumber = document.getElementById('id_number').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const gender = document.getElementById('gender').value;
    const role = document.getElementById('role').value;
    const status = document.getElementById('status').value;
    const qualification = document.getElementById('qualification').value;

    const dataToSend = {
      first_name: firstName,
      last_name: lastName,
      email: email,
      password: password,
      id_number: idNumber,
      phone: phone,
      gender: gender,
      role: role,
      status: status,
      qualification: qualification
    };

    console.log('Sending user data:', dataToSend);
    if (!firstName || !lastName || !email || !password) {
      showMessage('Please fill all required fields (*)', 'error');
      return;
    }

    // 4. Disable button and show loading
    const submitBtn = addUserForm.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    try {
      const response = await fetch('/api/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataToSend)
      });

      const result = await response.json();

      if (result.success) {
        showMessage('✅ User created successfully!', 'success');
        addUserForm.reset();
        refreshUserTable();
      } else {
        showMessage('❌ ' + result.message, 'error');
      }
    } catch (err) {
      console.error('Fetch error:', err);
      showMessage('Could not connect to server. Is it running?', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }

  })
})