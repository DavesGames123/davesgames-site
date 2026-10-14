// ============================================================================
//  STEM SPLITTER  ·  ui/dropzone.js — the song drop target and file picker
// ----------------------------------------------------------------------------
//  CONTRACT 6.1 step 1. A large target with the text "Drop a song or choose
//  a file" and the privacy line under it. A click or Enter / Space opens the
//  file picker. A drop of a file calls onFile(file). The zone takes the
//  first file only. setBusy(true) stops new files while the page works.
//
//  GREP MAP
//    ACCEPT ............ the accept list of the file input
//    createDropzone .... { el, input, setInfo, setBusy, destroy }
// ============================================================================

export const ACCEPT = 'audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac,.opus';

export function createDropzone(parent, { onFile, doc = globalThis.document } = {}) {
  const el = doc.createElement('div');
  el.className = 'ss-drop';
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', 'Drop a song or choose a file');
  const big = doc.createElement('div'); big.className = 'ss-drop-big'; big.textContent = 'Drop a song or choose a file';
  const fmt = doc.createElement('div'); fmt.className = 'ss-drop-fmt'; fmt.textContent = 'MP3, WAV, FLAC, OGG, M4A and other formats this browser can play';
  const privacy = doc.createElement('div'); privacy.className = 'ss-drop-privacy'; privacy.textContent = 'Your audio stays on this device. Nothing is uploaded.';
  const info = doc.createElement('div'); info.className = 'ss-drop-info'; info.hidden = true;
  const input = doc.createElement('input');
  input.type = 'file'; input.setAttribute('accept', ACCEPT); input.className = 'ss-file';
  input.setAttribute('tabindex', '-1'); input.setAttribute('aria-hidden', 'true');   // visually hidden (style.css): some browsers do not open a display:none picker
  el.append(big, fmt, privacy, info, input);
  parent.appendChild(el);

  let busy = false;
  const take = file => { if (!busy && file && onFile) onFile(file); };
  const pick = () => { if (!busy) input.click(); };
  const onClick = e => { if (e.target !== input) pick(); };
  const onKey = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); pick(); } };
  const onChange = () => { const f = input.files && input.files[0]; take(f); input.value = ''; };
  const onOver = e => { e.preventDefault(); if (!busy) el.classList.add('over'); };
  const onLeave = () => el.classList.remove('over');
  const onDrop = e => {
    e.preventDefault(); e.stopPropagation(); el.classList.remove('over');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    take(f);
  };
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKey);
  input.addEventListener('change', onChange);
  el.addEventListener('dragover', onOver);
  el.addEventListener('dragenter', onOver);
  el.addEventListener('dragleave', onLeave);
  el.addEventListener('drop', onDrop);

  return {
    el, input,
    setInfo(text) { info.textContent = text || ''; info.hidden = !text; el.classList.toggle('has-file', !!text); },
    setBusy(v) { busy = !!v; el.classList.toggle('busy', busy); el.setAttribute('aria-disabled', String(busy)); },
    destroy() { el.remove(); },
  };
}
