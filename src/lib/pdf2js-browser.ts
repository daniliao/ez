const MAX_CANVAS_PIXELS = 16_777_216;

/**
 * Converts a PDF (base64 string or ArrayBuffer) to an array of image data URLs (one per page).
 * @param {string|ArrayBuffer|Uint8Array} pdf - The PDF data (base64 string or ArrayBuffer or Uint8Array)
 * @param {object} conversion_config - { image_format: 'image/jpeg'|'image/png', height?: number, width?: number, base64?: boolean }
 * @returns {Promise<string[]>} Array of image data URLs
 */
export async function convert(pdf: string | ArrayBuffer | Uint8Array, conversion_config: { image_format?: string, height?: number, scale?: number, width?: number, base64?: boolean } = {}): Promise<string[]> {
  // Ensure we're in the browser environment
  if (typeof window === 'undefined') {
    throw new Error('PDF conversion is only available in the browser environment');
  }

  // Dynamically import PDF.js only on the client side
  const pdfjsLib = await import('pdfjs-dist');
  
  // Set up the worker
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';

  let pdfData: Uint8Array;


  if (typeof pdf === 'string') {
    // Support for URL input
    if (pdf.startsWith('http') || pdf.startsWith('moz-extension://') || pdf.startsWith('chrome-extension://') || pdf.startsWith('file://')) {
      const resp = await fetch(pdf);
      pdfData = new Uint8Array(await resp.arrayBuffer());
    }
    // Support for base64 encoded pdf input
    else if (/data:([a-zA-Z]*)\/([a-zA-Z]*);base64,([^"]*)/.test(pdf)) {
      pdfData = new Uint8Array(Buffer.from(pdf.split(',')[1], 'base64'));
    }
    // Support for filepath input
    else {
      // pdfData = new Uint8Array(await readFile(pdf));
      throw new Error('File paths are not supported!')
    }
  }
  // Support for buffer input
  else if (Buffer.isBuffer(pdf)) {
    pdfData = new Uint8Array(pdf);
  }
  // Support for Uint8Array input
  else throw new Error('Unsupported PDF input type');


  const loadingTask = pdfjsLib.getDocument({ data: pdfData });
  const pdfDocument = await loadingTask.promise;
  const numPages = pdfDocument.numPages;
  const outputPages: string[] = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdfDocument.getPage(i);
    let scale = conversion_config.scale || 1.5;
    let viewport = page.getViewport({ scale });
    
    // Scale it up / down dependent on the sizes given in the config (if there are any)
    if (conversion_config.width) {
      scale = conversion_config.width / viewport.width;
      viewport = page.getViewport({ scale });
    } else if (conversion_config.height) {
      scale = conversion_config.height / viewport.height;
      viewport = page.getViewport({ scale });
    }

    // iOS-fix — przytnij skalę gdy przekroczysz limit Safari
    const ratio = (window.devicePixelRatio || 1);
    const area = viewport.width * viewport.height * ratio * ratio;
    if (area > MAX_CANVAS_PIXELS) {
      scale *= Math.sqrt(MAX_CANVAS_PIXELS / area);
      viewport = page.getViewport({ scale });
    }

    // Create a canvas element
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not get canvas context');
    const renderContext = {
      canvasContext: context,
      viewport: viewport,
    };
    await page.render(renderContext).promise;
    const image = canvas.toDataURL(conversion_config.image_format || 'image/png');
    outputPages.push(image);
    
    // Clean up
    await page.cleanup();
    canvas.width = 0;
    canvas.height = 0;
  }
  return outputPages;
} 