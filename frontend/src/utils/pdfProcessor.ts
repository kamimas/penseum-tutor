export interface PDFPageImage {
  dataUrl: string;
  pageNumber: number;
  width: number;
  height: number;
}

/**
 * Lazy load PDF.js only when needed (client-side only)
 */
async function getPDFLib() {
  console.log('[PDF Debug 1] Starting PDF.js library load...');

  if (typeof window === 'undefined') {
    throw new Error('PDF.js can only be used in the browser');
  }

  console.log('[PDF Debug 2] Importing pdfjs-dist...');
  const pdfjsLib = await import('pdfjs-dist');
  console.log('[PDF Debug 3] pdfjs-dist imported successfully, version:', pdfjsLib.version);

  // Configure PDF.js worker
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
    console.log('[PDF Debug 4] Worker source configured:', pdfjsLib.GlobalWorkerOptions.workerSrc);
  }

  return pdfjsLib;
}

/**
 * Converts a PDF file to an array of image data URLs
 * Yields each page progressively as it's processed
 */
export async function* convertPDFToImages(
  file: File,
  options: {
    scale?: number;
    maxWidth?: number;
    maxHeight?: number;
  } = {}
): AsyncGenerator<PDFPageImage> {
  const { scale = 2, maxWidth = 1200, maxHeight = 1600 } = options;

  console.log('[PDF Debug 5] convertPDFToImages called with file:', file.name, file.type, file.size, 'bytes');
  console.log('[PDF Debug 6] Options:', { scale, maxWidth, maxHeight });

  // Dynamically import PDF.js
  const pdfjsLib = await getPDFLib();

  // Read file as array buffer
  console.log('[PDF Debug 7] Reading file as ArrayBuffer...');
  const arrayBuffer = await file.arrayBuffer();
  console.log('[PDF Debug 8] ArrayBuffer created, size:', arrayBuffer.byteLength, 'bytes');

  // Load PDF document
  console.log('[PDF Debug 9] Loading PDF document...');
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;
  console.log('[PDF Debug 10] PDF loaded successfully! Total pages:', numPages);

  // Process each page
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    console.log(`[PDF Debug 11] Processing page ${pageNum}/${numPages}...`);
    const page = await pdf.getPage(pageNum);
    console.log(`[PDF Debug 12] Page ${pageNum} retrieved`);

    // Get viewport with desired scale
    let viewport = page.getViewport({ scale });
    console.log(`[PDF Debug 13] Page ${pageNum} initial viewport:`, viewport.width, 'x', viewport.height);

    // Adjust scale if dimensions exceed max
    let adjustedScale = scale;
    if (viewport.width > maxWidth || viewport.height > maxHeight) {
      const widthScale = maxWidth / viewport.width;
      const heightScale = maxHeight / viewport.height;
      adjustedScale = Math.min(widthScale, heightScale) * scale;
      viewport = page.getViewport({ scale: adjustedScale });
      console.log(`[PDF Debug 14] Page ${pageNum} adjusted viewport:`, viewport.width, 'x', viewport.height, 'scale:', adjustedScale);
    }

    // Create canvas
    console.log(`[PDF Debug 15] Creating canvas for page ${pageNum}...`);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Could not get canvas context');
    }

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    console.log(`[PDF Debug 16] Canvas created:`, canvas.width, 'x', canvas.height);

    // Render page to canvas
    console.log(`[PDF Debug 17] Rendering page ${pageNum} to canvas...`);
    const renderContext = {
      canvasContext: context,
      viewport: viewport,
      canvas: canvas,
    };

    try {
      await page.render(renderContext as any).promise;
      console.log(`[PDF Debug 18] Page ${pageNum} rendered successfully!`);
    } catch (error) {
      console.error(`[PDF Debug ERROR] Failed to render page ${pageNum}:`, error);
      throw error;
    }

    // Convert canvas to data URL
    console.log(`[PDF Debug 19] Converting page ${pageNum} canvas to blob...`);
    const dataUrl = canvas.toBlob
      ? await new Promise<string>((resolve) => {
          canvas.toBlob((blob) => {
            if (blob) {
              const url = URL.createObjectURL(blob);
              console.log(`[PDF Debug 20] Page ${pageNum} blob created, size:`, blob.size, 'bytes');
              resolve(url);
            }
          }, 'image/png');
        })
      : canvas.toDataURL('image/png');

    console.log(`[PDF Debug 21] Page ${pageNum} complete! Yielding result...`);
    yield {
      dataUrl,
      pageNumber: pageNum,
      width: viewport.width,
      height: viewport.height,
    };
  }

  console.log('[PDF Debug 22] All pages processed successfully!');
}

/**
 * Converts entire PDF to images and returns all at once
 */
export async function convertPDFToImagesAll(
  file: File,
  options?: {
    scale?: number;
    maxWidth?: number;
    maxHeight?: number;
  }
): Promise<PDFPageImage[]> {
  const images: PDFPageImage[] = [];

  for await (const image of convertPDFToImages(file, options)) {
    images.push(image);
  }

  return images;
}

/**
 * Validates if a file is a PDF
 */
export function isPDFFile(file: File): boolean {
  const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  console.log('[PDF Debug] isPDFFile check:', file.name, 'type:', file.type, 'isPDF:', isPDF);
  return isPDF;
}
