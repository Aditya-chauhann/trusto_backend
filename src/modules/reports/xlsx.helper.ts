import { Response } from 'express';
import * as ExcelJS from 'exceljs';

export interface XlsxColumn {
  header: string;
  key: string;
  width?: number;
  numFmt?: string;
}

export async function streamXlsx(
  res: Response,
  filename: string,
  sheetName: string,
  columns: XlsxColumn[],
  rows: Record<string, unknown>[],
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'GamezVault';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width ?? Math.max(c.header.length + 2, 14),
    style: c.numFmt ? { numFmt: c.numFmt } : undefined,
  }));

  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' },
  };
  sheet.getRow(1).alignment = { vertical: 'middle' };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  rows.forEach((r) => sheet.addRow(r));

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}"`,
  );

  await workbook.xlsx.write(res);
  res.end();
}

export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export function buildFilename(base: string, suffix?: string): string {
  const stamp = todayStamp();
  return suffix
    ? `${base}-${suffix}-${stamp}.xlsx`
    : `${base}-${stamp}.xlsx`;
}
