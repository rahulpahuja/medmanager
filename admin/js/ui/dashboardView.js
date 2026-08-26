// Single responsibility: render the signed-in shell and the license table.
// This module never talks to Firebase — app.js hands it data and reads its
// DOM events back out, so the view stays swappable/testable on its own.
import { esc, fmtDate, statusOf, claimOf } from './format.js';

export function renderShell(root, { email, onSignOut, onNewLicense }) {
  root.innerHTML = `
    <div class="dash">
      <header class="dash-head">
        <div class="brand">
          <span class="brand-mark">Rx</span>
          <div class="brand-text"><b>Medicine Manager</b><span>Licence Administration</span></div>
        </div>
        <div class="dash-head-right">
          <span class="who">${esc(email)}</span>
          <button class="ghost" id="signOutBtn">Sign out</button>
        </div>
      </header>
      <main class="dash-main">
        <section id="reqSection" style="display:none">
          <div class="dash-bar"><h2>Pending requests</h2></div>
          <div class="scroll">
            <table class="lictable">
              <thead><tr><th>From</th><th>Contact</th><th>Business address</th><th>Requested</th><th></th></tr></thead>
              <tbody id="reqRows"></tbody>
            </table>
          </div>
        </section>
        <div class="dash-bar">
          <h2>Software licences</h2>
          <button class="act" id="newLicBtn">+ New licence</button>
        </div>
        <div class="scroll">
          <table class="lictable">
            <thead><tr>
              <th>Label</th><th>Status</th><th>Expiry</th><th>Last paid</th><th>Current device</th><th>Created</th><th></th>
            </tr></thead>
            <tbody id="licRows"></tbody>
          </table>
        </div>
        <p class="empty" id="licEmpty" style="display:none">No licences yet. Create one to get started.</p>
      </main>
    </div>`;
  root.querySelector('#signOutBtn').onclick = onSignOut;
  root.querySelector('#newLicBtn').onclick = onNewLicense;
  return {
    tbody: root.querySelector('#licRows'), empty: root.querySelector('#licEmpty'),
    reqSection: root.querySelector('#reqSection'), reqTbody: root.querySelector('#reqRows'),
  };
}

// Same data-act/data-id delegation pattern as renderRows below.
export function renderRequests(section, tbody, list) {
  section.style.display = list.length ? '' : 'none';
  const sorted = [...list].sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));
  tbody.innerHTML = sorted.map((req) => `<tr>
      <td><b>${esc(req.name)}</b>${req.note ? `<div class="note">${esc(req.note)}</div>` : ''}<div class="note">${esc(req.devName || '')}</div></td>
      <td>${[req.phone, req.email].filter(Boolean).map(esc).join('<br>') || '—'}</td>
      <td>${esc(req.address || '—')}</td>
      <td>${esc(fmtDate(req.requestedAt))}</td>
      <td class="row-act">
        <button class="ico" data-act="approve" data-id="${req.id}" title="Approve &amp; issue key">&#10003;</button>
        <button class="ico danger" data-act="dismiss" data-id="${req.id}" title="Dismiss">&#10005;</button>
      </td>
    </tr>`).join('');
}

// Row action buttons carry data-act + data-hash; app.js delegates one
// listener on the tbody instead of this module rebinding handlers per row.
export function renderRows(tbody, emptyEl, list) {
  emptyEl.style.display = list.length ? 'none' : '';
  const sorted = [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  tbody.innerHTML = sorted.map((lic) => {
    const st = statusOf(lic);
    const cl = claimOf(lic);
    return `<tr>
      <td><b>${esc(lic.label)}</b>${lic.note ? `<div class="note">${esc(lic.note)}</div>` : ''}</td>
      <td><span class="pill ${st.cls}">${st.label}</span></td>
      <td>${esc(fmtDate(lic.expiresAt, 'No expiry'))}</td>
      <td>${esc(fmtDate(lic.lastPaidAt))}</td>
      <td><span class="pill ${cl.cls}">${esc(cl.label)}</span></td>
      <td>${esc(fmtDate(lic.createdAt))}</td>
      <td class="row-act">
        ${lic.active === false
          ? `<button class="ico" data-act="reactivate" data-hash="${lic.hash}" title="Reactivate">&#8635;</button>`
          : `<button class="ico" data-act="revoke" data-hash="${lic.hash}" title="Revoke">&#9940;</button>`}
        <button class="ico" data-act="edit" data-hash="${lic.hash}" title="Edit expiry / label">&#9998;</button>
        ${cl.live ? `<button class="ico" data-act="release" data-hash="${lic.hash}" title="Release device">&#9099;</button>` : ''}
        <button class="ico danger" data-act="delete" data-hash="${lic.hash}" title="Delete">&#10005;</button>
      </td>
    </tr>`;
  }).join('');
}
