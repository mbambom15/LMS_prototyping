function switchToPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById(`page-${pageId}`);
  if (target) target.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
  const activeNav = Array.from(document.querySelectorAll('.nav-item')).find(
    nav => nav.getAttribute('data-page') === pageId
  );
  if (activeNav) activeNav.classList.add('active');
}

document.querySelectorAll('.nav-item').forEach(nav => {
  nav.addEventListener('click', (e) => {
    const page = nav.getAttribute('data-page');
    if (page) switchToPage(page);
  });
});

function logoutAction() {
  alert("Logged out from facilitator portal.");
}

function generateAttReport() {
  const deal = document.getElementById('deal-input').value.trim();
  if (!deal) {
    alert("Please enter a valid deal / ID number.");
    return;
  }

  const toastDiv = document.getElementById('att-toast');
  const reportBlock = document.getElementById('att-report');

  toastDiv.style.display = 'block';
  reportBlock.style.display = 'block';
  setTimeout(() => {
    toastDiv.style.display = 'none';
  }, 2800);
}

function sendFeedback(index) {
  const toast = document.getElementById(`fb-sent-${index}`);
  if (toast) {
    toast.style.display = 'inline-block';
    setTimeout(() => {
      toast.style.display = 'none';
    }, 2000);
  }
}

function editFeedback(index) {
  const msgDiv = document.getElementById(`fb-text-${index}`);
  if (!msgDiv) return;

  const currentText = msgDiv.innerText;
  const textarea = document.createElement('textarea');

  textarea.value = currentText;
  textarea.style.cssText =
    'width:100%; padding:12px; border-radius:14px; border:1px solid #ccc; background:#fff; font-family:inherit;';
  textarea.rows = 4;

  msgDiv.replaceWith(textarea);
  textarea.focus();

  textarea.addEventListener('blur', () => {
    const newDiv = document.createElement('div');
    newDiv.className = 'fb-text';
    newDiv.id = `fb-text-${index}`;
    newDiv.innerText = textarea.value;
    textarea.replaceWith(newDiv);
  });
}

function generateAllFeedback() {
  alert("Feedback drafts refreshed based on latest learner data.");
}

function openFeedbackModal(learnerName) {
  document.getElementById('feedbackModal').classList.add('show');
}

function closeFbModal() {
  document.getElementById('feedbackModal').classList.remove('show');
}

window.addEventListener('click', (e) => {
  if (e.target === document.getElementById('feedbackModal')) closeFbModal();
});

// Set default date range (current month)
(function setDates() {
  const d = new Date();
  const from = new Date(d.getFullYear(), d.getMonth(), 1);
  const to = new Date();

  const fmt = dt => dt.toISOString().slice(0, 10);

  const fromInput = document.getElementById('att-from');
  const toInput = document.getElementById('att-to');

  if (fromInput) fromInput.value = fmt(from);
  if (toInput) toInput.value = fmt(to);
})();