// Single responsibility: render the signed-out screen and wire its one button.
export function renderLogin(root, { onSignIn, errorMessage }) {
  root.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="brand">
          <span class="brand-mark">Rx</span>
          <div class="brand-text"><b>Medicine Manager</b><span>Licence Administration</span></div>
        </div>
        <p class="login-copy">Sign in with an authorised Google account to issue, renew, or revoke software keys.</p>
        ${errorMessage ? `<div class="login-error">${errorMessage}</div>` : ''}
        <button class="btn-google" id="signInBtn">
          <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.98v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.98A9 9 0 0 0 0 9c0 1.45.35 2.83.98 4.03l2.97-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .98 4.97l2.97 2.33C4.66 5.17 6.65 3.58 9 3.58z"/></svg>
          Sign in with Google
        </button>
        <p class="login-hint">Access is limited to two named accounts. Anyone else's sign-in is rejected automatically.</p>
      </div>
    </div>`;
  root.querySelector('#signInBtn').onclick = onSignIn;
}
