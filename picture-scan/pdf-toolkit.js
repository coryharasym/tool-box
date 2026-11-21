import {EncryptedPDFError, PDFDocument, degrees} from './vendor/pdf-lib.min.js';
import {openPdf} from './pdf-viewer.js';
import {buildPdf} from './pdf.js';

async function thumbnail(previewPage) {
  const initial = previewPage.getViewport({scale: 1});
  const viewport = previewPage.getViewport({scale: 700 / Math.max(initial.width, initial.height)});
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  try {
    await previewPage.render({canvas, viewport}).promise;
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  } finally {
    canvas.width = canvas.height = 1;
    previewPage.cleanup();
  }
}

export async function readPdf(file, room, onProgress) {
  if (file.size > 40 * 1024 * 1024) throw new Error('Choose a PDF no larger than 40 MB.');
  const bytes = await file.arrayBuffer();
  let source;
  try {
    source = await PDFDocument.load(bytes, {updateMetadata: false});
  } catch (error) {
    if (error instanceof EncryptedPDFError) {
      throw new Error('This PDF is password-protected or encrypted. Save an unlocked copy first.');
    }
    throw new Error('This file could not be opened as a PDF.');
  }
  const count = source.getPageCount();
  if (!count) throw new Error('This PDF has no pages.');
  if (count > room) throw new Error(`This PDF has ${count} pages, with room for ${room}. Split the source PDF or clear some pages first.`);

  const pages = [];
  const preview = openPdf(bytes.slice(0));
  let documentPreview;
  try {
    documentPreview = await preview.promise;
  } catch {
    // The original pages can still be copied if the preview renderer fails.
  }
  try {
    for (let index = 0; index < count; index++) {
      onProgress(index + 1, count);
      let blob;
      try {
        if (documentPreview) blob = await thumbnail(await documentPreview.getPage(index + 1));
      } catch {
        // An unavailable thumbnail does not discard the original page.
      }
      pages.push({
        pdf: source,
        sourceName: file.name,
        sourceIndex: index,
        rotation: 0,
        url: blob ? URL.createObjectURL(blob) : null,
      });
    }
  } finally {
    await preview.destroy().catch(() => {});
  }
  return pages;
}

export async function combinePdf(pages, paper) {
  const result = await PDFDocument.create();
  const groups = new Map();
  const scanPages = pages.filter(page => !page.pdf);
  const scans = await Promise.all(scanPages.map(async page => ({
    width: page.width,
    height: page.height,
    jpeg: new Uint8Array(await page.blob.arrayBuffer()),
  })));
  const scanSource = scans.length
    ? await PDFDocument.load(await buildPdf(scans, paper).arrayBuffer())
    : null;
  let scanIndex = 0;

  for (const [index, page] of pages.entries()) {
    const source = page.pdf ?? scanSource;
    if (!groups.has(source)) groups.set(source, []);
    groups.get(source).push({index, sourceIndex: page.pdf ? page.sourceIndex : scanIndex++});
  }

  const copied = [];
  for (const [source, entries] of groups) {
    const output = await result.copyPages(source, entries.map(entry => entry.sourceIndex));
    entries.forEach(({index}, position) => { copied[index] = output[position]; });
  }

  copied.forEach((page, index) => {
    const rotation = pages[index].rotation ?? 0;
    if (rotation) page.setRotation(degrees((page.getRotation().angle + rotation) % 360));
    result.addPage(page);
  });
  return new Blob([await result.save()], {type: 'application/pdf'});
}
