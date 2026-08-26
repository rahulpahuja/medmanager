// Single responsibility: turn raw license/claim data into display strings.
export const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

export function fmtDate(ms, fallback) {
  if (!ms) return fallback || '—';
  return new Date(+ms).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtAgo(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'less than a minute ago';
  if (m === 1) return 'a minute ago';
  if (m < 60) return m + ' minutes ago';
  const h = Math.round(m / 60);
  return h === 1 ? 'an hour ago' : h + ' hours ago';
}

const LOCKMIN = 10; // must match LOCKMIN in the main app's app.js

export function statusOf(lic) {
  if (lic.active === false) return { label: 'Revoked', cls: 'st-revoked' };
  if (lic.expiresAt && Date.now() > +lic.expiresAt) return { label: 'Expired', cls: 'st-expired' };
  return { label: 'Active', cls: 'st-active' };
}

export function claimOf(lic) {
  const c = lic.claim;
  if (!c || !c.id) return { label: 'Not activated on any device', cls: 'st-idle', live: false };
  const live = (Date.now() - (+c.at || 0)) < LOCKMIN * 60000;
  return {
    label: (c.name || 'Unnamed device') + ' · ' + fmtAgo(+c.at || 0),
    cls: live ? 'st-live' : 'st-idle',
    live,
  };
}
