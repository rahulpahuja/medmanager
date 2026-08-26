// Single responsibility: all reads/writes against /licenseRequests. Kept
// separate from licenseRepository.js since it's a different bounded
// concern (inbound requests vs. issued licences) with different rules —
// end users can create a request but never read or edit one.
import { ref, onValue, remove } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js';
import { db } from '../config/firebaseConfig.js';

// Subscribes to pending requests; callback(list) fires on every change.
// Returns an unsubscribe function.
export function subscribeRequests(callback) {
  const r = ref(db, 'licenseRequests');
  const off = onValue(r, (snap) => {
    const val = snap.val() || {};
    const list = Object.keys(val)
      .map((id) => ({ id, ...val[id] }))
      .filter((req) => req.status === 'pending');
    callback(list);
  });
  return off;
}

// Approving means issuing a licence (handled by licenseRepository) and
// removing the request — there is nothing left to review once it's done.
export function dismissRequest(id) {
  return remove(ref(db, 'licenseRequests/' + id));
}
