import { DATA_FILE_NAME, DATA_FOLDER, SHEET_TABS } from "../config";
import { DEFAULT_SETTINGS, type CounterRow, type Snapshot } from "../engine";
import { TABLE_COLUMNS, TABLE_NAMES, type Col } from "../schema";
import { AuthExpiredError, OfflineError } from "./errors";

interface DriveFile {
  id: string;
  name: string;
  parents?: string[];
}

async function gfetch(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new OfflineError();
  }
  if (response.status === 401) throw new AuthExpiredError();
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(googleMessage(response.status, detail));
  }
  return response;
}

function googleMessage(status: number, detail: string): string {
  if (status === 403) {
    return "Google Drive refused this. Sign in again and allow Aquarium Shop to create files in your Drive.";
  }
  return `Google could not save (${status}). ${detail.slice(0, 160)}`;
}

function escapeName(name: string): string {
  return name.replaceAll("'", "\\'");
}

async function queryFiles(token: string, q: string): Promise<DriveFile[]> {
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&spaces=drive&fields=files(id,name,parents)&pageSize=20`;
  const response = await gfetch(token, url);
  const json = (await response.json()) as { files?: DriveFile[] };
  return json.files ?? [];
}

export async function ensureFolder(token: string): Promise<string> {
  const q = [`name = '${escapeName(DATA_FOLDER)}'`, "mimeType = 'application/vnd.google-apps.folder'", "trashed = false"].join(" and ");
  const found = await queryFiles(token, q);
  if (found[0]) return found[0].id;
  const response = await gfetch(token, "https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    body: JSON.stringify({ name: DATA_FOLDER, mimeType: "application/vnd.google-apps.folder" }),
  });
  const json = (await response.json()) as { id: string };
  return json.id;
}

export async function findSpreadsheet(token: string, folderId?: string): Promise<string | null> {
  const q = [
    `name = '${escapeName(DATA_FILE_NAME)}'`,
    "mimeType = 'application/vnd.google-apps.spreadsheet'",
    "trashed = false",
  ].join(" and ");
  const files = await queryFiles(token, q);
  if (folderId) {
    const inFolder = files.find((file) => file.parents?.includes(folderId));
    if (inFolder) return inFolder.id;
  }
  return files[0]?.id ?? null;
}

async function spreadsheetMeta(token: string, id: string): Promise<{ sheetId: number; title: string }[]> {
  const response = await gfetch(token, `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties`);
  const json = (await response.json()) as { sheets?: { properties: { sheetId: number; title: string } }[] };
  return (json.sheets ?? []).map((sheet) => sheet.properties);
}

async function batchUpdate(token: string, id: string, requests: unknown[]) {
  if (!requests.length) return;
  await gfetch(token, `https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });
}

/** Create the workbook on first sign-in, or reopen the one this app already created. */
export async function ensureWorkbook(token: string, existingId?: string): Promise<{ spreadsheetId: string; folderId: string }> {
  const folderId = await ensureFolder(token);
  let spreadsheetId = existingId || "";
  if (spreadsheetId) {
    try {
      await spreadsheetMeta(token, spreadsheetId);
    } catch (error) {
      if (error instanceof AuthExpiredError || error instanceof OfflineError) throw error;
      spreadsheetId = "";
    }
  }
  if (!spreadsheetId) spreadsheetId = (await findSpreadsheet(token, folderId)) || "";
  if (!spreadsheetId) {
    const response = await gfetch(token, "https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      body: JSON.stringify({
        name: DATA_FILE_NAME,
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents: [folderId],
      }),
    });
    const created = (await response.json()) as { id: string };
    spreadsheetId = created.id;
  }
  await ensureTabs(token, spreadsheetId);
  return { spreadsheetId, folderId };
}

async function ensureTabs(token: string, id: string) {
  let sheets = await spreadsheetMeta(token, id);
  const have = new Set(sheets.map((sheet) => sheet.title));
  const requests: unknown[] = [];
  for (const title of SHEET_TABS) {
    if (!have.has(title)) requests.push({ addSheet: { properties: { title } } });
  }
  const sheet1 = sheets.find((sheet) => sheet.title === "Sheet1");
  if (sheet1 && (have.size > 1 || requests.length)) requests.push({ deleteSheet: { sheetId: sheet1.sheetId } });
  await batchUpdate(token, id, requests);
  sheets = await spreadsheetMeta(token, id);
  const format: unknown[] = [];
  for (const sheet of sheets) {
    if (!TABLE_COLUMNS[sheet.title]) continue;
    format.push({
      updateSheetProperties: {
        properties: { sheetId: sheet.sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: "gridProperties.frozenRowCount",
      },
    });
    format.push({
      repeatCell: {
        range: { sheetId: sheet.sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: "userEnteredFormat.textFormat.bold",
      },
    });
    TABLE_COLUMNS[sheet.title]!.forEach((col, index) => {
      if (!col.text) return;
      format.push({
        repeatCell: {
          range: { sheetId: sheet.sheetId, startRowIndex: 1, endRowIndex: 5000, startColumnIndex: index, endColumnIndex: index + 1 },
          cell: { userEnteredFormat: { numberFormat: { type: "TEXT" } } },
          fields: "userEnteredFormat.numberFormat",
        },
      });
    });
  }
  await batchUpdate(token, id, format);
}

function cellValue(col: Col, value: unknown): string | number {
  if (col.text) {
    const text = value == null ? "" : String(value);
    return text.replace(/^[=@]+/, "").trim();
  }
  if (value == null || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? n : "";
}

export function snapshotToRanges(snap: Snapshot): { range: string; values: (string | number)[][] }[] {
  const settings = { ...snap.settings, pinHash: snap.pinHash || "", pinSalt: snap.pinSalt || "" };
  const settingRows = Object.entries(settings).map(([key, value]) => ({ key, value }));
  const tables: Record<string, Record<string, unknown>[]> = {
    Settings: settingRows,
    Items: snap.items,
    StockIn: snap.stockIn,
    Mortality: snap.mortality,
    Sales: snap.sales,
    SaleLines: snap.saleLines,
    Counters: snap.counters as unknown as Record<string, unknown>[],
  };
  return TABLE_NAMES.map((name) => {
    const cols = TABLE_COLUMNS[name]!;
    const values: (string | number)[][] = [cols.map((col) => col.label)];
    for (const row of tables[name] ?? []) values.push(cols.map((col) => cellValue(col, row[col.key])));
    return { range: `${name}!A1`, values };
  });
}

function parseTable(cols: Col[], values: unknown[][]): Record<string, unknown>[] {
  if (!values?.length) return [];
  const header = (values[0] ?? []).map((value) => String(value ?? ""));
  const looksHeader = cols.some((col) => header.includes(col.label));
  const body = looksHeader ? values.slice(1) : values;
  const index = cols.map((col, position) => ({ ...col, i: looksHeader ? header.indexOf(col.label) : position }));
  const out: Record<string, unknown>[] = [];
  for (const raw of body) {
    const row = raw ?? [];
    const obj: Record<string, unknown> = {};
    let empty = true;
    for (const col of index) {
      const value = col.i >= 0 ? row[col.i] : "";
      if (value !== "" && value != null) empty = false;
      if (col.text) obj[col.key] = value == null ? "" : String(value);
      else obj[col.key] = value === "" || value == null ? "" : Number(value);
    }
    if (!empty) out.push(obj);
  }
  return out;
}

export function tablesToSnapshot(tables: Record<string, unknown[][]>): Snapshot {
  const parsed: Record<string, Record<string, unknown>[]> = {};
  for (const name of TABLE_NAMES) parsed[name] = parseTable(TABLE_COLUMNS[name]!, tables[name] ?? []);
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of parsed.Settings ?? []) settings[String(row.key)] = String(row.value ?? "");
  const counters: CounterRow[] = (parsed.Counters ?? [])
    .map((row) => ({
      fy: String(row.fy || ""),
      lastSeq: Number(row.lastSeq) || 0,
      claimId: String(row.claimId || ""),
      claimedAt: String(row.claimedAt || ""),
    }))
    .filter((row) => row.fy);
  return {
    settings,
    items: parsed.Items ?? [],
    stockIn: parsed.StockIn ?? [],
    mortality: parsed.Mortality ?? [],
    sales: parsed.Sales ?? [],
    saleLines: parsed.SaleLines ?? [],
    counters,
    pinHash: settings.pinHash || "",
    pinSalt: settings.pinSalt || "",
  };
}

export async function readSnapshot(token: string, spreadsheetId: string): Promise<Snapshot> {
  const params = new URLSearchParams();
  for (const name of TABLE_NAMES) params.append("ranges", name);
  params.set("majorDimension", "ROWS");
  params.set("valueRenderOption", "UNFORMATTED_VALUE");
  const response = await gfetch(token, `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${params}`);
  const json = (await response.json()) as { valueRanges?: { range?: string; values?: unknown[][] }[] };
  const tables: Record<string, unknown[][]> = {};
  for (const range of json.valueRanges ?? []) {
    const name = String(range.range || "").split("!")[0]?.replace(/'/g, "");
    if (name) tables[name] = range.values ?? [];
  }
  return tablesToSnapshot(tables);
}

export async function writeSnapshot(token: string, spreadsheetId: string, snap: Snapshot): Promise<void> {
  const data = snapshotToRanges(snap);
  await gfetch(token, `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ valueInputOption: "RAW", data }),
  });
  const tails = data.map((part) => {
    const tab = part.range.split("!")[0];
    return `${tab}!A${part.values.length + 1}:Z`;
  });
  await gfetch(token, `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchClear`, {
    method: "POST",
    body: JSON.stringify({ ranges: tails }),
  });
}

/**
 * Reserve invoice sequences.
 * Each device writes Counters with its own claim id, then reads them back.
 * If another device overwrote the claim, this returns false and the caller
 * re-reads Sales and tries the next number.
 * Limitation: if two devices write and re-read in the exact same moment,
 * both can briefly believe they own the number. The shop should bill on one phone at a time.
 */
export function claimsMatch(wanted: CounterRow[], actual: CounterRow[]): boolean {
  return wanted.every((row) => {
    const found = actual.find((item) => item.fy === row.fy);
    return !!found && found.claimId === row.claimId && Number(found.lastSeq) === Number(row.lastSeq);
  });
}

export async function createExportSheet(token: string, title: string, rows: unknown[][], folderId: string): Promise<string> {
  const response = await gfetch(token, "https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    body: JSON.stringify({
      name: title,
      mimeType: "application/vnd.google-apps.spreadsheet",
      parents: [folderId],
    }),
  });
  const created = (await response.json()) as { id: string };
  const values = rows.map((row) => row.map((value) => (typeof value === "number" ? value : String(value ?? ""))));
  await gfetch(token, `https://sheets.googleapis.com/v4/spreadsheets/${created.id}/values/Sheet1!A1?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ values }),
  });
  const sheets = await spreadsheetMeta(token, created.id);
  const first = sheets[0];
  if (first) {
    await batchUpdate(token, created.id, [
      {
        updateSheetProperties: {
          properties: { sheetId: first.sheetId, title: "Export", gridProperties: { frozenRowCount: 1 } },
          fields: "title,gridProperties.frozenRowCount",
        },
      },
      {
        repeatCell: {
          range: { sheetId: first.sheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: "userEnteredFormat.textFormat.bold",
        },
      },
    ]);
  }
  return `https://docs.google.com/spreadsheets/d/${created.id}`;
}

export function sheetUrl(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}`;
}
