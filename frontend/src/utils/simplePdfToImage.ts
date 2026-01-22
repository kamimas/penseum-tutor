/**
 * Simple PDF to Image converter using PDF.js via CDN
 * No complex imports - loads library dynamically only in browser
 */

export interface PDFPageImage {
  dataUrl: string;
  pageNumber: number;
  width: number;
  height: number;
}

/**
 * Load PDF.js from CDN dynamically
 */
async function loadPDFJS() {
  // Check if already loaded
  if (typeof window !== 'undefined' && (window as any).pdfjsLib) {
    return (window as any).pdfjsLib;
  }

  // Load PDF.js library from CDN
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      const pdfjsLib = (window as any).pdfjsLib;
      if (pdfjsLib) {
        // Set worker
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve(pdfjsLib);
      } else {
        reject(new Error('PDF.js failed to load'));
      }
    };
    script.onerror = () => reject(new Error('Failed to load PDF.js script'));
    document.head.appendChild(script);
  });
}

/**
 * Convert PDF file to array of images
 */
export async function convertPDFToImages(
  file: File,
  options: {
    scale?: number;
    maxWidth?: number;
    maxHeight?: number;
  } = {}
): Promise<PDFPageImage[]> {
  const { scale = 1.5, maxWidth = 800, maxHeight = 1000 } = options;

  // Load PDF.js
  const pdfjsLib = await loadPDFJS();

  // Read file as array buffer
  const arrayBuffer = await file.arrayBuffer();

  // Load PDF document
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;

  const pages: PDFPageImage[] = [];

  // Process each page
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {

    const page = await pdf.getPage(pageNum);

    // Get viewport
    let viewport = page.getViewport({ scale });

    // Adjust scale if needed
    if (viewport.width > maxWidth || viewport.height > maxHeight) {
      const widthScale = maxWidth / viewport.width;
      const heightScale = maxHeight / viewport.height;
      const adjustedScale = Math.min(widthScale, heightScale) * scale;
      viewport = page.getViewport({ scale: adjustedScale });
    }

    // Create canvas
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Could not get canvas context');
    }

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    // Render page to canvas
    await page.render({
      canvasContext: context,
      viewport: viewport,
    }).promise;

    // Convert to data URL
    const dataUrl = canvas.toDataURL('image/png');

    pages.push({
      dataUrl,
      pageNumber: pageNum,
      width: viewport.width,
      height: viewport.height,
    });
  }

  return pages;
}

/**
 * Get PDF page count without converting
 */
export async function getPDFPageCount(file: File): Promise<number> {
  const pdfjsLib = await loadPDFJS();
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  return pdf.numPages;
}
