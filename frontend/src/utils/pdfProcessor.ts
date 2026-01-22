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
  if (typeof window === 'undefined') {
    throw new Error('PDF.js can only be used in the browser');
  }

  const pdfjsLib = await import('pdfjs-dist');

  // Configure PDF.js worker
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
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

  // Dynamically import PDF.js
  const pdfjsLib = await getPDFLib();

  // Read file as array buffer
  const arrayBuffer = await file.arrayBuffer();

  // Load PDF document
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;

  // Process each page
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);

    // Get viewport with desired scale
    let viewport = page.getViewport({ scale });

    // Adjust scale if dimensions exceed max
    let adjustedScale = scale;
    if (viewport.width > maxWidth || viewport.height > maxHeight) {
      const widthScale = maxWidth / viewport.width;
      const heightScale = maxHeight / viewport.height;
      adjustedScale = Math.min(widthScale, heightScale) * scale;
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
    const renderContext = {
      canvasContext: context,
      viewport: viewport,
      canvas: canvas,
    };

    await page.render(renderContext as any).promise;

    // Convert canvas to data URL
    const dataUrl = canvas.toBlob
      ? await new Promise<string>((resolve) => {
          canvas.toBlob((blob) => {
            if (blob) {
              const url = URL.createObjectURL(blob);
              resolve(url);
            }
          }, 'image/png');
        })
      : canvas.toDataURL('image/png');

    yield {
      dataUrl,
      pageNumber: pageNum,
      width: viewport.width,
      height: viewport.height,
    };
  }
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
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}
