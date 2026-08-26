// Single responsibility: all reads/writes against /licenses in the RTDB.
// Nothing here touches the DOM; callers get plain data back.
import { ref, onValue, set, update, remove } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js';
import { db } from '../config/firebaseConfig.js';
import { keyHash } from './keyHash.js';

const path = (hash) => 'licenses/' + hash;

// Subscribes to the full license catalog; callback(list) fires on every change.
// Returns an unsubscribe function.
export function subscribeLicenses(callback) {
  const r = ref(db, 'licenses');
  const off = onValue(r, (snap) => {
    const val = snap.val() || {};
    const list = Object.keys(val).map((hash) => ({ hash, ...val[hash] }));
    callback(list);
  });
  return off;
}

export async function createLicense({ rawKey, label, note, expiresAt, active = true, lastPaidAt }) {
  const hash = keyHash(rawKey);
  await set(ref(db, path(hash)), {
    label: label || 'Unnamed licence',
    note: note || '',
    active,
    expiresAt: expiresAt || null, // epoch ms, or null for no expiry
    lastPaidAt: lastPaidAt || null, // epoch ms, or null if unknown
    createdAt: Date.now(),
  });
  return hash;
}

export function updateLicense(hash, patch) {
  return update(ref(db, path(hash)), patch);
}

export function setActive(hash, active) {
  return update(ref(db, path(hash)), { active });
}

export function releaseClaim(hash) {
  return set(ref(db, path(hash) + '/claim'), null);
}

export function deleteLicense(hash) {
  return remove(ref(db, path(hash)));
}
