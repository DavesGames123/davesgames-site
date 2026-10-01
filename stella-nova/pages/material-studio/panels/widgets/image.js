// ============================================================================
//  MATERIAL STUDIO  ·  panels/widgets/image.js — image param widget
// ────────────────────────────────────────────────────────────────────────────
//  A drop zone and a file pick. The value is {name, url} with the image
//  as a data URL, so the graph JSON holds the image inline.
//
//  GREP TARGETS
//      wImage
// ============================================================================
import { store } from '../ctx.js';
import { h, ibtn, pickFiles } from '../dom.js';

export function wImage(p, value, onChange) {
  let v = value || null;
  const thumb = h('img', { class: 'pn-img-th', alt: '' });
  const name = h('span', { class: 'pn-img-name' });
  const clear = ibtn('close', 'Remove the image', e => { e.stopPropagation(); v = null; show(); onChange(null, true); });
  const zone = h('div', { class: 'pn-img', tabindex: '0', role: 'button', title: 'Click or drop an image file' }, thumb, h('div', { class: 'pn-img-meta' }, name, h('span', { class: 'pn-sub' }, 'PNG, JPG, WebP: drop or click')), clear);
  const show = () => {
    const url = v && (v.url || v.dataURL);
    zone.classList.toggle('has', !!url);
    if (url) thumb.src = url; else thumb.removeAttribute('src');
    name.textContent = v ? (v.name || 'image') : 'No image';
    clear.hidden = !v;
  };
  const take = file => {
    if (!file || !/^image\//.test(file.type)) { store.toast('That file is not an image', 'warn'); return; }
    if (file.size > 24e6) store.toast('Large image: the graph JSON stores it inline as a data URL', 'warn');
    const fr = new FileReader();
    fr.onload = () => { v = { name: file.name, url: fr.result }; show(); onChange(v, true); };
    fr.readAsDataURL(file);
  };
  zone.addEventListener('click', async () => { const [f] = await pickFiles('image/*'); take(f); });
  zone.addEventListener('keydown', async e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const [f] = await pickFiles('image/*'); take(f); } });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('over'); take(e.dataTransfer.files[0]); });
  show();
  return { el: zone, set: x => { v = x || null; show(); } };
}
