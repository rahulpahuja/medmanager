// Single responsibility: the modal dialogs for creating/editing a licence and
// for revealing a freshly-generated key exactly once. Pure DOM + callbacks —
// no Firebase calls live here.
import { esc } from './format.js';

function overlay(html) {
  const el = document.createElement('div');
  el.className = 'ovl';
  el.innerHTML = `<div class="box">${html}</div>`;
  document.body.appendChild(el);
  el.addEventListener('click', (e) => { if (e.target === el) el.remove(); });
  return el;
}

const durationToMs = (n, unit) => {
  if (!n) return null;
  const d = new Date();
  if (unit === 'days') d.setDate(d.getDate() + n);
  else if (unit === 'years') d.setFullYear(d.getFullYear() + n);
  else d.setMonth(d.getMonth() + n);
  return d.getTime();
};

export function openCreateModal(onCreate, prefill) {
  prefill = prefill || {};
  const el = overlay(`
    <h3>New licence</h3>
    <p>Give it a label so you recognise it later. A key is generated on save — you'll get one chance to copy it.</p>
    <div class="row">
      <div class="f" style="flex:1"><label>Label / customer name</label><input id="mLabel" placeholder="e.g. Sharma Medicos, Jaipur" value="${esc(prefill.label || '')}"></div>
    </div>
    <div class="row">
      <div class="f" style="flex:1"><label>Note (optional)</label><input id="mNote" placeholder="optional" value="${esc(prefill.note || '')}"></div>
    </div>
    <div class="row">
      <div class="f"><label>Expires in</label><input id="mDur" class="num" inputmode="numeric" value="1" style="min-width:70px"></div>
      <div class="f"><label>&nbsp;</label><select id="mUnit"><option value="months">Months</option><option value="days">Days</option><option value="years">Years</option></select></div>
      <div class="f"><label>&nbsp;</label><label class="chk"><input type="checkbox" id="mNoExpiry"> No expiry</label></div>
    </div>
    <div class="row" style="margin-top:6px">
      <button class="act" id="mSave">Create licence</button>
      <button class="ghost" id="mCancel">Cancel</button>
    </div>`);
  el.querySelector('#mCancel').onclick = () => el.remove();
  el.querySelector('#mNoExpiry').onchange = (e) => {
    el.querySelector('#mDur').disabled = e.target.checked;
    el.querySelector('#mUnit').disabled = e.target.checked;
  };
  el.querySelector('#mSave').onclick = async () => {
    const label = el.querySelector('#mLabel').value.trim();
    if (!label) return alert('Give the licence a label.');
    const note = el.querySelector('#mNote').value.trim();
    const noExpiry = el.querySelector('#mNoExpiry').checked;
    const expiresAt = noExpiry ? null : durationToMs(+el.querySelector('#mDur').value || 1, el.querySelector('#mUnit').value);
    el.querySelector('#mSave').disabled = true;
    try {
      await onCreate({ label, note, expiresAt });
      el.remove();
    } catch (e2) {
      alert('Could not create the licence: ' + (e2.message || e2));
      el.querySelector('#mSave').disabled = false;
    }
  };
}

export function openKeyRevealModal(rawKey, label) {
  const el = overlay(`
    <h3>Licence created</h3>
    <p>This is the only time the plaintext key is shown. Copy it now and send it to <b>${esc(label)}</b> — the server only ever stores its hash.</p>
    <div class="row"><div class="f" style="flex:1"><input id="mKey" readonly value="${esc(rawKey)}" style="font-family:ui-monospace,monospace;font-size:15px;letter-spacing:.03em"></div></div>
    <div class="row" style="margin-top:6px">
      <button class="act" id="mCopy">Copy key</button>
      <button class="ghost" id="mDone">Done</button>
    </div>`);
  el.querySelector('#mDone').onclick = () => el.remove();
  el.querySelector('#mCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(rawKey); el.querySelector('#mCopy').textContent = 'Copied ✓'; }
    catch (e) { el.querySelector('#mKey').select(); }
  };
}

export function openEditModal(lic, onSave) {
  const cur = lic.expiresAt ? new Date(+lic.expiresAt).toISOString().slice(0, 10) : '';
  const el = overlay(`
    <h3>Edit licence</h3>
    <div class="row">
      <div class="f" style="flex:1"><label>Label</label><input id="mLabel" value="${esc(lic.label)}"></div>
    </div>
    <div class="row">
      <div class="f" style="flex:1"><label>Note</label><input id="mNote" value="${esc(lic.note || '')}"></div>
    </div>
    <div class="row">
      <div class="f"><label>Expiry date</label><input type="date" id="mExpiry" value="${cur}"></div>
      <div class="f"><label>&nbsp;</label><label class="chk"><input type="checkbox" id="mNoExpiry" ${lic.expiresAt ? '' : 'checked'}> No expiry</label></div>
    </div>
    <div class="row" style="margin-top:6px">
      <button class="act" id="mSave">Save</button>
      <button class="ghost" id="mCancel">Cancel</button>
    </div>`);
  el.querySelector('#mExpiry').disabled = !lic.expiresAt;
  el.querySelector('#mCancel').onclick = () => el.remove();
  el.querySelector('#mNoExpiry').onchange = (e) => { el.querySelector('#mExpiry').disabled = e.target.checked; };
  el.querySelector('#mSave').onclick = async () => {
    const label = el.querySelector('#mLabel').value.trim();
    if (!label) return alert('Label cannot be empty.');
    const note = el.querySelector('#mNote').value.trim();
    const noExpiry = el.querySelector('#mNoExpiry').checked;
    const dateVal = el.querySelector('#mExpiry').value;
    const expiresAt = noExpiry ? null : (dateVal ? new Date(dateVal + 'T23:59:59').getTime() : null);
    el.querySelector('#mSave').disabled = true;
    try { await onSave({ label, note, expiresAt }); el.remove(); }
    catch (e2) { alert('Could not save: ' + (e2.message || e2)); el.querySelector('#mSave').disabled = false; }
  };
}
