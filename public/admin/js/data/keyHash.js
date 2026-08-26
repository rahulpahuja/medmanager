// Must stay byte-for-byte identical to keyHash() in the main app's app.js —
// this is what maps a plaintext software key to its /licenses/{hash} path,
// so the two codebases have to agree on the algorithm without sharing a file.
export function keyHash(k) {
  let h = 0x811c9dc5;
  const str = 'bts::' + String(k || '');
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  let g = 0x9e3779b9;
  for (let i = str.length - 1; i >= 0; i--) { g ^= str.charCodeAt(i); g = (g * 0x85ebca6b) >>> 0; }
  return (h >>> 0).toString(16).padStart(8, '0') + (g >>> 0).toString(16).padStart(8, '0');
}

// Generates a customer-facing key, e.g. MMGR-7F3K-9QXP-2LRT.
// Not derived from anything — pure randomness — so it can only be recovered
// by whoever the admin hands it to; the server only ever stores its hash.
export function genLicenseKey() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid transcription errors
  const groups = [];
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  for (let g = 0; g < 3; g++) {
    let s = '';
    for (let i = 0; i < 4; i++) s += alphabet[bytes[g * 4 + i] % alphabet.length];
    groups.push(s);
  }
  return 'MMGR-' + groups.join('-');
}
