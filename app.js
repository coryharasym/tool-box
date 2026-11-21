import qrcode from './vendor/qrcode.js';
import {bindAudioCutter} from './audio.js';

const get = id => document.getElementById(id);
const sections = [...document.querySelectorAll('[data-page]')];

function showTool() {
  const target = sections.find(section => '#' + section.id === location.hash) ?? sections[0];
  for (const section of sections) section.hidden = section !== target;
  document.title = target.id === 'home' ? 'Toolbox' : target.querySelector('h1').textContent + ' · Toolbox';
  for (const link of document.querySelectorAll('nav a')) {
    if (target.id === (link.hash.slice(1) || 'home')) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', showTool);
showTool();

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

let generatedQr;
const qrPreview = get('qr-preview');
const qrStatus = get('qr-status');

function makeQrArtwork(code) {
  const namespace = 'http://www.w3.org/2000/svg';
  const count = code.getModuleCount();
  const size = count + 8;
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('xmlns', namespace);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', '600');
  svg.setAttribute('height', '600');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QR code');
  svg.setAttribute('shape-rendering', 'crispEdges');
  const background = document.createElementNS(namespace, 'rect');
  background.setAttribute('width', String(size));
  background.setAttribute('height', String(size));
  background.setAttribute('fill', '#fff');
  const modules = document.createElementNS(namespace, 'path');
  const segments = [];
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (code.isDark(row, col)) segments.push(`M${col + 4} ${row + 4}h1v1h-1z`);
    }
  }
  modules.setAttribute('d', segments.join(''));
  svg.append(background, modules);
  return svg;
}

function renderSign() {
  if (!generatedQr) return;
  const layout = get('qr-layout').value;
  qrPreview.className = 'sheet ' + layout;
  const card = document.createElement('article');
  const heading = document.createElement('h2');
  heading.textContent = get('qr-title').value.trim() || 'Scan to open';
  const note = document.createElement('p');
  note.textContent = get('qr-note').value.trim();
  card.append(heading, generatedQr.cloneNode(true));
  if (note.textContent) card.append(note);
  qrPreview.replaceChildren(...Array.from({length: layout === 'cards' ? 6 : 1}, () => card.cloneNode(true)));
}

function resetQr() {
  generatedQr = null;
  get('qr-print').disabled = true;
  get('qr-save').disabled = true;
  const placeholder = document.createElement('p');
  placeholder.className = 'placeholder';
  placeholder.textContent = 'Generate a QR code to preview your sign.';
  qrPreview.replaceChildren(placeholder);
}

get('qr-form').addEventListener('submit', event => {
  event.preventDefault();
  resetQr();
  qrStatus.textContent = '';
  const raw = get('qr-url').value.trim();
  let link;
  try {
    link = new URL(raw.includes('://') ? raw : 'https://' + raw);
    if (!['http:', 'https:'].includes(link.protocol)) throw new Error();
  } catch {
    qrStatus.textContent = 'Enter a valid web link starting with https:// or http://.';
    return;
  }
  try {
    const code = qrcode(0, 'M');
    code.addData(link.href);
    code.make();
    generatedQr = makeQrArtwork(code);
    renderSign();
    get('qr-print').disabled = false;
    get('qr-save').disabled = false;
  } catch {
    qrStatus.textContent = 'This link is too long to fit. Try a shorter web link.';
  }
});
get('qr-url').addEventListener('input', () => {
  if (generatedQr) resetQr();
  qrStatus.textContent = '';
});
get('qr-title').addEventListener('input', renderSign);
get('qr-note').addEventListener('input', renderSign);
get('qr-layout').addEventListener('change', renderSign);
get('qr-print').addEventListener('click', () => {
  document.body.classList.add('print-sign');
  window.print();
});
window.addEventListener('afterprint', () => document.body.classList.remove('print-sign'));
get('qr-save').addEventListener('click', () => {
  const svg = new XMLSerializer().serializeToString(generatedQr);
  download(new Blob([svg], {type: 'image/svg+xml;charset=utf-8'}), 'qr-code.svg');
});

const reader = get('reader');
const readerScroll = get('reader-scroll');
const readerText = get('reader-text');
const play = get('play-script');
const settings = {script: get('script'), speed: get('script-speed'), size: get('script-size'), mirror: get('script-mirror')};
let frame = null;
let previous = null;
let remainder = 0;

function pauseScript() {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  previous = null;
  play.textContent = 'Start';
}

function tick(time) {
  if (previous !== null) {
    const distance = remainder + Math.min(time - previous, 100) * Number(get('reader-speed').value) / 1000;
    const pixels = Math.floor(distance);
    remainder = distance - pixels;
    readerScroll.scrollTop += pixels;
  }
  previous = time;
  const end = readerScroll.scrollHeight - readerScroll.clientHeight;
  if (readerScroll.scrollTop >= end - 1) {
    pauseScript();
  } else {
    frame = requestAnimationFrame(tick);
  }
}

function toggleScript() {
  if (frame !== null) {
    pauseScript();
    return;
  }
  if (readerScroll.scrollTop >= readerScroll.scrollHeight - readerScroll.clientHeight - 1) readerScroll.scrollTop = 0;
  remainder = 0;
  play.textContent = 'Pause';
  frame = requestAnimationFrame(tick);
}

settings.script.addEventListener('input', () => {
  get('open-reader').disabled = !settings.script.value.trim();
});
settings.size.addEventListener('input', () => { get('size-display').value = settings.size.value + ' px'; });
settings.speed.addEventListener('input', () => { get('speed-display').value = settings.speed.value + ' px/s'; });
get('reader-speed').addEventListener('input', event => {
  settings.speed.value = event.target.value;
  get('speed-display').value = settings.speed.value + ' px/s';
});
get('open-reader').addEventListener('click', () => {
  readerText.textContent = settings.script.value.trim();
  readerText.style.fontSize = settings.size.value + 'px';
  readerText.classList.toggle('mirrored', settings.mirror.checked);
  get('reader-speed').value = settings.speed.value;
  reader.showModal();
  readerScroll.scrollTop = 0;
  readerScroll.focus();
});
get('close-reader').addEventListener('click', () => reader.close());
reader.addEventListener('close', pauseScript);
play.addEventListener('click', toggleScript);
get('restart-script').addEventListener('click', () => {
  readerScroll.scrollTop = 0;
  remainder = 0;
});
readerScroll.addEventListener('keydown', event => {
  if (event.code !== 'Space') return;
  event.preventDefault();
  if (!event.repeat) toggleScript();
});

bindAudioCutter(get, download);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
