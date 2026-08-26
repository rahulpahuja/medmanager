// Single responsibility: who is allowed in. The allowlist is enforced twice —
// here (so the UI reacts instantly) and again server-side in database.rules.json
// (auth.token.email checks), which is the real gate: even someone who edits
// this file's ALLOWED_EMAILS constant cannot read or manage licenses without
// also passing the database rules, since they can't sign the auth token.
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';
import { auth } from '../config/firebaseConfig.js';

export const ALLOWED_EMAILS = ['therahulpahuja@gmail.com', 'rahulpahuja2015@gmail.com'];

export function isAllowed(user) {
  return !!user && !!user.email && ALLOWED_EMAILS.includes(user.email.toLowerCase());
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
  if (!isAllowed(cred.user)) {
    await signOut(auth);
    throw new Error('This Google account is not authorised for this portal.');
  }
  return cred.user;
}

export function signOutUser() {
  return signOut(auth);
}

// callback receives (user) where user is null when signed out, or when
// signed in with a Google account outside the allowlist (already force-signed-out).
export function watchAuthState(callback) {
  return onAuthStateChanged(auth, (user) => {
    if (user && !isAllowed(user)) { signOut(auth); return; }
    callback(user);
  });
}
