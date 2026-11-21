const MAX_FILE = 40 * 1024 * 1024;
const WORD_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
]);

function decodePlain(bytes) {
  if (bytes[0] === 255 && bytes[1] === 254) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 254 && bytes[1] === 255) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

async function readWord(bytes) {
  const {unzipSync} = await import('./vendor/fflate.js');
  const path = 'word/document.xml';
  const entries = unzipSync(bytes, {filter: entry => {
    if (entry.name !== path) return false;
    if (entry.originalSize > MAX_FILE) throw new Error('The Word document is too large to open here.');
    return true;
  }});
  if (!entries[path]) throw new Error('This file does not contain a Word document.');
  const xml = new DOMParser().parseFromString(decodePlain(entries[path]), 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) throw new Error('The Word document could not be read.');
  const body = [...xml.documentElement.children].find(node => WORD_NAMESPACES.has(node.namespaceURI) && node.localName === 'body');
  if (!body) throw new Error('The Word document could not be read.');
  const paragraphs = [];
  for (const paragraph of body.getElementsByTagNameNS(body.namespaceURI, 'p')) {
    const parts = [];
    for (const node of paragraph.getElementsByTagNameNS(body.namespaceURI, '*')) {
      if (node.closest('del, moveFrom')) continue;
      if (node.localName === 't') parts.push(node.textContent);
      if (node.localName === 'tab') parts.push('\t');
      if (node.localName === 'br' || node.localName === 'cr') parts.push('\n');
    }
    paragraphs.push(parts.join(''));
  }
  return paragraphs.join('\n');
}

async function readPdf(bytes) {
  const {openPdf} = await import('./picture-scan/pdf-viewer.js');
  const task = openPdf(bytes);
  try {
    const pdf = await task.promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const {items} = await page.getTextContent();
      const lines = [];
      let line = '';
      let y;
      for (const item of items) {
        if (typeof item.str !== 'string') continue;
        const nextY = item.transform[5];
        if (line && y !== undefined && Math.abs(nextY - y) > Math.max(3, item.height * .55)) {
          lines.push(line.trimEnd());
          line = '';
        }
        line += item.str;
        y = nextY;
        if (item.hasEOL) {
          lines.push(line.trimEnd());
          line = '';
        }
      }
      if (line) lines.push(line.trimEnd());
      pages.push(lines.join('\n'));
      page.cleanup();
    }
    const result = pages.join('\n\n');
    if (!result.trim()) throw new Error('This PDF has no selectable text. Import a text-based PDF or paste text from an OCR app.');
    return result;
  } catch (error) {
    if (error.name === 'PasswordException') throw new Error('This PDF is password-protected. Import an unlocked copy.');
    throw error;
  } finally {
    await task.destroy().catch(() => {});
  }
}

const RTF_IGNORED = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'objdata', 'header',
  'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf', 'footnote',
  'annotation', 'fldinst', 'listtable', 'listoverridetable', 'datastore', 'themedata',
]);
const RTF_TEXT = {
  par: '\n', line: '\n', tab: '\t', cell: '\t', row: '\n', page: '\n\n',
  emdash: '—', endash: '–', bullet: '•', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”',
};

function readRtf(bytes) {
  const raw = new TextDecoder('iso-8859-1').decode(bytes);
  if (!/^\s*\{\\rtf\d/.test(raw)) throw new Error('This file is not a readable RTF document.');
  const windows = new TextDecoder('windows-1252');
  // Map the WHATWG Windows-1252 decoding back to bytes before applying RTF code pages.
  const reverse = new Map(Array.from({length: 32}, (_, i) => [windows.decode(Uint8Array.of(128 + i)),128 + i]));
  const out = [];
  const stack = [];
  let state = {skip: false, fallback: 1, decoder: windows};
  let pending = 0;
  const token = /\\([a-z]+)(-?\d+)? ?|\\'([a-f\d]{2})|\\([^\r\n])|[{}]|[^{}\\\r\n]+/gi;
  function append(text) {
    if (state.skip) return;
    if (pending) {
      const consumed = Math.min(pending, text.length);
      pending -= consumed;
      text = text.slice(consumed);
    }
    if (text) out.push(text);
  }
  for (let match; (match = token.exec(raw));) {
    const [full, word, number, hex, symbol] = match;
    if (full === '{') {
      stack.push(state);
      state = {...state};
    } else if (full === '}') {
      state = stack.pop() ?? state;
      pending = 0;
    } else if (hex) {
      append(state.decoder.decode(Uint8Array.of(parseInt(hex, 16))));
    } else if (symbol) {
      if (symbol === '*') state.skip = true;
      else if ('{}\\'.includes(symbol)) append(symbol);
      else if (symbol === '~') append(' ');
      else if (symbol === '_') append('‑');
    } else if (word) {
      const command = word.toLowerCase();
      const value = Number(number);
      if (command === 'bin' && value > 0) token.lastIndex += value;
      else if (RTF_IGNORED.has(command)) state.skip = true;
      else if (command === 'uc' && value >= 0) state.fallback = value;
      else if (command === 'ansicpg') {
        try { state.decoder = new TextDecoder(value === 65001 ? 'utf-8' : 'windows-' + value); } catch {}
      } else if (command === 'u' && !state.skip) {
        out.push(String.fromCharCode(value & 65535));
        pending = state.fallback;
      } else if (Object.hasOwn(RTF_TEXT, command)) append(RTF_TEXT[command]);
    } else {
      append(state.decoder === windows ? full : state.decoder.decode(Uint8Array.from(full, ch => reverse.get(ch) ?? ch.charCodeAt(0))));
    }
  }
  return out.join('');
}

export async function readScript(file) {
  if (file.size > MAX_FILE) throw new Error('Choose a document no larger than 40 MB.');
  const extension = file.name.split('.').at(-1).toLowerCase();
  if (extension === 'doc') throw new Error('Save this older Word document as .docx, then import it again.');
  if (!['txt','rtf','docx','pdf'].includes(extension)) throw new Error('Choose a .docx, .pdf, .txt, or .rtf file.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let result;
  if (extension === 'docx') result = await readWord(bytes);
  if (extension === 'pdf') result = await readPdf(bytes);
  if (extension === 'rtf') result = readRtf(bytes);
  if (extension === 'txt') result = decodePlain(bytes);
  result = result.replace(/\r\n?/g, '\n').trim();
  if (!result) throw new Error('This document contains no readable script text.');
  return result;
}
