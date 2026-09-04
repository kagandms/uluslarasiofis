const views = {
  ykn: { id: 'ykn-view', label: 'YKN' },
  cover: { id: 'cover-view', label: 'Kapak Hazırla' },
  teblig: { id: 'teblig-view', label: 'Tebliğ Bul' },
};

const homeScreen = document.querySelector('#home-screen');
const workspace = document.querySelector('#workspace-content');
const workspaceLabel = document.querySelector('#workspace-label');
document.body.classList.add('home-mode');

function showToast(message, isError = false) {
  const toast = document.querySelector('#toast') || document.querySelector('#toast-container');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.remove('hidden');
  window.setTimeout(() => toast.classList.add('hidden'), 3000);
}

function showView(viewKey) {
  const selectedView = views[viewKey];
  if (!selectedView || !homeScreen || !workspace) return;

  Object.values(views).forEach((view) => {
    document.querySelector(`#${view.id}`)?.classList.toggle('hidden', view.id !== selectedView.id);
  });
  document.querySelectorAll('.ykn-dependent').forEach((element) => {
    element.classList.toggle('hidden', viewKey !== 'ykn' || element.id === 'transfer-card');
  });
  document.querySelectorAll('.cover-dependent').forEach((element) => {
    element.classList.toggle('hidden', viewKey !== 'cover');
  });
  document.querySelectorAll('.workspace-nav [data-view]').forEach((button) => {
    const isActive = button.dataset.view === viewKey;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
  const tebligSearchBody = document.querySelector('#tebligat-search-body');
  if (tebligSearchBody) tebligSearchBody.style.display = viewKey === 'teblig' ? 'block' : 'none';
  homeScreen.classList.add('hidden');
  workspace.classList.remove('hidden');
  document.body.classList.remove('home-mode');
  workspaceLabel.textContent = selectedView.label;
  document.querySelector(`#${selectedView.id} input`)?.focus();
}

function showHome() {
  homeScreen?.classList.remove('hidden');
  workspace?.classList.add('hidden');
  document.body.classList.add('home-mode');
}

document.querySelectorAll('[data-view]').forEach((button) => {
  button.addEventListener('click', () => showView(button.dataset.view));
});
document.querySelector('#back-to-home')?.addEventListener('click', showHome);

const form = document.querySelector('#student-search-form');
const passportInput = document.querySelector('#passport-number');
const resultCard = document.querySelector('#student-result');
const emptyState = document.querySelector('#empty-state');
const resultContent = document.querySelector('#result-content');
const transferCard = document.querySelector('#transfer-card');

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  const passportNumber = passportInput?.value.trim().toUpperCase();
  if (!passportNumber) {
    showToast('Lütfen pasaport numarası girin.', true);
    passportInput?.focus();
    return;
  }

  const submitButton = form.querySelector('button');
  if (submitButton) submitButton.disabled = true;
  window.setTimeout(() => {
    const passportOutput = document.querySelector('#student-passport');
    if (passportOutput) passportOutput.textContent = `${passportNumber} · Azerbaycan`;
    emptyState?.classList.add('hidden');
    resultContent?.classList.remove('hidden');
    resultCard?.classList.remove('is-empty');
    if (submitButton) submitButton.disabled = false;
    showToast('Öğrenci Apply Topkapı’da bulundu.');
  }, 850);
});

document.querySelector('#copy-info')?.addEventListener('click', () => showToast('Bilgiler kopyalandı.'));
document.querySelector('#send-yoksis')?.addEventListener('click', () => showToast('YÖKSİS sekmesi açılıyor ve kabul kodu aktarılıyor.'));
document.querySelector('#paste-yoksis')?.addEventListener('click', () => showToast('Öğrenci bilgileri YÖKSİS formuna aktarıldı.'));
document.querySelector('#copy-letter')?.addEventListener('click', () => {
  const status = document.querySelector('#letter-status');
  if (status) status.textContent = 'Kopyalandı · ABC-123-45';
  transferCard?.classList.remove('hidden');
  showToast('Kabul mektubu kodu kopyalandı.');
});
