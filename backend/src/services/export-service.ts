/**
 * Export Service — serializes a result set into CSV or Excel.
 * The export strictly uses whatever rows/columns the calling route
 * already filtered, so there is no secondary query here.
 */
import { stringify } from 'csv-stringify';
import ExcelJS from 'exceljs';
import { Response } from 'express';

export type ExportFormat = 'csv' | 'excel';

interface ExportOptions {
  format: ExportFormat;
  filename: string;
  columns: { key: string; header: string }[];
  rows: Record<string, unknown>[];
  res: Response;
}

export async function streamExport({ format, filename, columns, rows, res }: ExportOptions) {
  if (format === 'csv') {
    await streamCsv({ filename, columns, rows, res });
  } else {
    await streamExcel({ filename, columns, rows, res });
  }
}

async function streamCsv({
  filename, columns, rows, res,
}: Omit<ExportOptions, 'format' | 'res'> & { res: Response }) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);

  const stringifier = stringify({
    header: true,
    columns: columns.map((c) => ({ key: c.key, header: c.header })),
  });

  stringifier.pipe(res);

  for (const row of rows) {
    stringifier.write(row);
  }

  stringifier.end();

  await new Promise<void>((resolve, reject) => {
    stringifier.on('finish', resolve);
    stringifier.on('error', reject);
  });
}

async function streamExcel({
  filename, columns, rows, res,
}: Omit<ExportOptions, 'format' | 'res'> & { res: Response }) {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Export');

  // Header row with bold styling
  sheet.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: Math.max(c.header.length + 4, 14),
    style: { alignment: { wrapText: false } },
  }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' },
  };
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };

  for (const row of rows) {
    sheet.addRow(row);
  }

  await workbook.xlsx.write(res);
  res.end();
}
