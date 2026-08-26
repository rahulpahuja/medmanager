// Composition root: the only file that imports from every layer and wires
// them together. Auth, data, and view modules never import each other directly.
import { signInWithGoogle, signOutUser, watchAuthState } from './auth/authService.js';
import { subscribeLicenses, createLicense, updateLicense, setActive, releaseClaim, deleteLicense } from './data/licenseRepository.js';
import { subscribeRequests, dismissRequest } from './data/licenseRequestRepository.js';
import { genLicenseKey } from './data/keyHash.js';
import { renderLogin } from './ui/loginView.js';
import { renderShell, renderRows, renderRequests } from './ui/dashboardView.js';
import { openCreateModal, openKeyRevealModal, openEditModal } from './ui/licenseModal.js';

const root = document.getElementById('app');
let unsubscribeLicenses = null;
let unsubscribeRequests = null;
let currentList = [];
let currentRequests = [];

function teardown() {
  if (unsubscribeLicenses) { unsubscribeLicenses(); unsubscribeLicenses = null; }
  if (unsubscribeRequests) { unsubscribeRequests(); unsubscribeRequests = null; }
}

function showLogin(errorMessage) {
  teardown();
  renderLogin(root, {
    errorMessage,
    onSignIn: async () => {
      try { await signInWithGoogle(); }
      catch (e) { showLogin(e.message || 'Sign-in failed.'); }
    },
  });
}

function createFromModal(prefill, onDone) {
  openCreateModal(async ({ label, note, expiresAt, lastPaidAt }) => {
    const rawKey = genLicenseKey();
    await createLicense({ rawKey, label, note, expiresAt, lastPaidAt });
    if (onDone) await onDone();
    openKeyRevealModal(rawKey, label);
  }, prefill);
}

function showDashboard(user) {
  const { tbody, empty, reqSection, reqTbody } = renderShell(root, {
    email: user.email,
    onSignOut: () => signOutUser(),
    onNewLicense: () => createFromModal(),
  });

  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const hash = btn.dataset.hash;
    const lic = currentList.find((l) => l.hash === hash);
    if (!lic) return;
    const act = btn.dataset.act;
    if (act === 'revoke') setActive(hash, false);
    else if (act === 'reactivate') setActive(hash, true);
    else if (act === 'release') { if (confirm('Release the device holding this key? It will stop working there until reactivated.')) releaseClaim(hash); }
    else if (act === 'delete') { if (confirm('Delete "' + lic.label + '" permanently? This cannot be undone.')) deleteLicense(hash); }
    else if (act === 'edit') openEditModal(lic, (patch) => updateLicense(hash, patch));
  });

  reqTbody.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    const req = currentRequests.find((r) => r.id === id);
    if (!req) return;
    const act = btn.dataset.act;
    if (act === 'approve') createFromModal({ label: req.name, note: req.note }, () => dismissRequest(id));
    else if (act === 'dismiss') { if (confirm('Dismiss the request from "' + req.name + '"? This does not notify them.')) dismissRequest(id); }
  });

  unsubscribeLicenses = subscribeLicenses((list) => {
    currentList = list;
    renderRows(tbody, empty, list);
  });
  unsubscribeRequests = subscribeRequests((list) => {
    currentRequests = list;
    renderRequests(reqSection, reqTbody, list);
  });
}

watchAuthState((user) => {
  if (user) showDashboard(user);
  else showLogin();
});
