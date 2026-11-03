/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Configure pdfjs-dist worker URL locally from bundled assets (no CDN required)
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
}

/** Maximum allowed PDF file size: 20 MB */
const MAX_PDF_SIZE_BYTES = 20 * 1024 * 1024;

/**
 * Average characters per page below which a PDF is flagged as scanned/image-only.
 * pdfjs-dist only extracts embedded text streams; image-only PDFs have < ~25 chars total.
 */
const SCANNED_THRESHOLD_CHARS_PER_PAGE = 50;

export interface ExtractedPdfPage {
  pageNumber: number;
  text: string;
}

export interface PdfExtractionResult {
  numPages: number;
  pages: ExtractedPdfPage[];
  fullText: string;
  /** True when the PDF appears to be scanned/image-only and yields negligible text. */
  isScannedOrEmpty: boolean;
}

/**
 * Validates a File object before attempting extraction.
 * Throws with a user-readable message on invalid input.
 */
export function validatePdfFile(file: File): void {
  if (!file) {
    throw new Error('No file provided.');
  }

  // Check MIME type – browsers report 'application/pdf' for valid PDF files
  if (file.type && file.type !== 'application/pdf') {
    throw new Error(
      `Invalid file type "${file.type}". Please upload a PDF document (.pdf).`,
    );
  }

  // Fallback: check extension when MIME type is absent (some browsers omit it)
  if (!file.type && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('Invalid file extension. Please upload a PDF document (.pdf).');
  }

  if (file.size > MAX_PDF_SIZE_BYTES) {
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    throw new Error(
      `File is too large (${sizeMB} MB). Maximum allowed size is 20 MB.`,
    );
  }

  if (file.size === 0) {
    throw new Error('The uploaded file is empty.');
  }
}

/**
 * Extracts text from a PDF file using pdfjs-dist (in-browser, no server upload).
 * Validates file type and size before processing.
 * Flags scanned / image-only PDFs that yield negligible text.
 *
 * NOTE: pdfjs-dist only extracts embedded text streams. It does NOT perform OCR.
 * Scanned PDFs that contain images instead of text will yield empty results.
 *
 * @param file   The PDF File object from an <input type="file"> element.
 * @param startPage  1-indexed first page to extract (default: 1).
 * @param endPage    1-indexed last page to extract inclusive (default: all pages).
 */
export async function extractTextFromPdf(
  file: File,
  startPage?: number,
  endPage?: number,
): Promise<PdfExtractionResult> {
  // Validate file before loading
  validatePdfFile(file);

  let pdfDoc: pdfjsLib.PDFDocumentProxy;
  try {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    pdfDoc = await loadingTask.promise;
  } catch (e: any) {
    throw new Error(
      `Failed to open the PDF file. It may be corrupted or password-protected. (${e?.message ?? e})`,
    );
  }

  const numPages = pdfDoc.numPages;

  // Clamp page range safely
  const safeStart = Math.max(1, Math.min(startPage ?? 1, numPages));
  const safeEnd = Math.max(safeStart, Math.min(endPage ?? numPages, numPages));

  const pages: ExtractedPdfPage[] = [];
  let totalTextLength = 0;

  for (let i = safeStart; i <= safeEnd; i++) {
    try {
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      pages.push({ pageNumber: i, text: pageText });
      totalTextLength += pageText.length;
    } catch (e) {
      // Partial failure: push empty page, continue
      pages.push({ pageNumber: i, text: '' });
    }
  }

  const extractedPageCount = safeEnd - safeStart + 1;
  const avgCharsPerPage = extractedPageCount > 0 ? totalTextLength / extractedPageCount : 0;

  // Flag as scanned when average embedded text per page is negligibly small
  const isScannedOrEmpty = avgCharsPerPage < SCANNED_THRESHOLD_CHARS_PER_PAGE;

  const fullText = pages
    .map(p => `--- Page ${p.pageNumber} ---\n${p.text}`)
    .join('\n\n');

  return {
    numPages,
    pages,
    fullText,
    isScannedOrEmpty,
  };
}
