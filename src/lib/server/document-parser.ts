/**
 * Document parser that converts uploaded files to plain text for entity extraction.
 * Supports: PDF (text layer), DOCX (Word), XLSX (Excel).
 *
 * All imports are dynamic to avoid Next.js bundler issues with native Node.js modules.
 */

/**
 * Parse a document buffer to plain text.
 * @param buffer  Raw file bytes
 * @param mimeType  MIME type of the file
 */
export async function parseDocument(buffer: Buffer, mimeType: string): Promise<string> {
  // ── PDF ──────────────────────────────────────────────────────────────────
  if (mimeType === 'application/pdf') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse') as (
      dataBuffer: Buffer,
      options?: Record<string, unknown>
    ) => Promise<{ text: string; numpages: number }>
    const result = await pdfParse(buffer)
    return result.text
  }

  // ── DOCX (Word) ───────────────────────────────────────────────────────────
  if (
    mimeType ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  }

  // ── XLSX (Excel) ──────────────────────────────────────────────────────────
  // Uses exceljs instead of xlsx — xlsx has an unfixed prototype pollution
  // vulnerability (GHSA-4r6h-8v6p-xvw6).
  if (
    mimeType ===
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    const ExcelJS = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer)
    const texts: string[] = []
    workbook.eachSheet((worksheet) => {
      const rows: string[] = []
      worksheet.eachRow((row) => {
        const values = Array.isArray(row.values) ? row.values.slice(1) : []
        rows.push(values.map((cell) => (cell != null ? String(cell) : '')).join(','))
      })
      texts.push(rows.join('\n'))
    })
    return texts.join('\n')
  }

  // Fallback: attempt UTF-8 text
  return buffer.toString('utf-8')
}
