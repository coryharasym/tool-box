import {getDocument, GlobalWorkerOptions} from './vendor/pdfjs/pdf.min.mjs';
import {resources} from './vendor/pdfjs/resource-index.js';

const assets = new URL('./vendor/pdfjs/', import.meta.url);
GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', assets).href;

let resourceData;
class LocalPdfResources {
  async fetch({kind, filename}) {
    const entry = resources[`${kind}/${filename}`];
    if (!entry) throw new Error('PDF preview resource is unavailable.');
    resourceData ??= fetch(new URL('resources.bin', assets)).then(response => {
      if (!response.ok || !response.body) throw new Error('Could not load PDF preview resources.');
      return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    }).catch(error => {
      resourceData = null;
      throw error;
    });
    const [offset, size] = entry;
    return new Uint8Array(await resourceData).slice(offset, offset + size);
  }
}

export function openPdf(bytes) {
  return getDocument({
    data: new Uint8Array(bytes),
    BinaryDataFactory: LocalPdfResources,
    useWorkerFetch: false,
    useSystemFonts: false,
    wasmUrl: assets.href,
    iccUrl: new URL('iccs/', assets).href,
    isEvalSupported: false,
    maxImageSize: 30_000_000,
  });
}
