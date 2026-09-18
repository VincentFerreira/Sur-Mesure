import { PDFParse } from 'pdf-parse';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface ParsedPdf {
  text: string;
  numPages: number;
  pages: { num: number; text: string }[];
}

export interface PdfTextItem {
  page: number;
  str: string;
  x: number;
  y: number;
}

const PDF_MAGIC_BYTES = '%PDF';

export function hasPdfMagicBytes(buffer: Buffer): boolean {
  return buffer.subarray(0, 4).toString('latin1') === PDF_MAGIC_BYTES;
}

export async function readPdf(buffer: Buffer): Promise<ParsedPdf> {
  if (!hasPdfMagicBytes(buffer)) {
    throw new Error('Not a valid PDF: missing %PDF magic bytes');
  }
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return {
      text: result.text,
      numPages: result.total,
      pages: result.pages.map(p => ({ num: p.num, text: p.text })),
    };
  } finally {
    await parser.destroy();
  }
}

/**
 * Extracts every text item with its page number and x/y origin (PDF points,
 * bottom-left aligned). Used to assert on the horizontal/vertical position of
 * rendered text (e.g. that all section titles share the same left margin).
 */
export async function readPdfTextPositions(buffer: Buffer): Promise<PdfTextItem[]> {
  if (!hasPdfMagicBytes(buffer)) {
    throw new Error('Not a valid PDF: missing %PDF magic bytes');
  }
  const doc = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const items: PdfTextItem[] = [];
  try {
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if ('str' in item && item.str.trim() !== '') {
          items.push({ page: pageNum, str: item.str, x: item.transform[4], y: item.transform[5] });
        }
      }
    }
  } finally {
    await doc.destroy();
  }
  return items;
}
