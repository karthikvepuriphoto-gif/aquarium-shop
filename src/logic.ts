/**
 * Pure business rules ported from the Apps Script Logic.gs.
 * GST maths, invoice numbering, validation, summaries and CSV.
 * Money is handled internally in PAISE (integers).
 *
 * Not certified GST software. Rates for dry goods should be confirmed
 * with supplier bills or a CA. Live ornamental fish HSN 0301 is exempt
 * by default. Services SAC 9987 are 18%. Dry goods default to 18%.
 * All of those can be edited per item.
 */

export const ITEM_TYPES = {
  FISH: { label: "Live fish", hsn: "0301", gstRate: 0, unit: "NOS", stocked: true },
  DRY: { label: "Dry goods", hsn: "", gstRate: 18, unit: "NOS", stocked: true },
  SERVICE: { label: "Service", hsn: "9987", gstRate: 18, unit: "NA", stocked: false },
} as const;

export type ItemType = keyof typeof ITEM_TYPES;

export const GST_RATES = [0, 3, 5, 12, 18, 28, 40];

export const GST_MODES = {
  REGULAR: "Regular GST",
  COMPOSITION: "Composition scheme",
  UNREGISTERED: "Not registered for GST",
} as const;

export type GstMode = keyof typeof GST_MODES;
export type PriceMode = "INCLUSIVE" | "EXCLUSIVE";

/** Indian states / UTs with GST state codes (used for place of supply). */
export const STATES: [string, string][] = [
  ["01", "Jammu and Kashmir"],
  ["02", "Himachal Pradesh"],
  ["03", "Punjab"],
  ["04", "Chandigarh"],
  ["05", "Uttarakhand"],
  ["06", "Haryana"],
  ["07", "Delhi"],
  ["08", "Rajasthan"],
  ["09", "Uttar Pradesh"],
  ["10", "Bihar"],
  ["11", "Sikkim"],
  ["12", "Arunachal Pradesh"],
  ["13", "Nagaland"],
  ["14", "Manipur"],
  ["15", "Mizoram"],
  ["16", "Tripura"],
  ["17", "Meghalaya"],
  ["18", "Assam"],
  ["19", "West Bengal"],
  ["20", "Jharkhand"],
  ["21", "Odisha"],
  ["22", "Chhattisgarh"],
  ["23", "Madhya Pradesh"],
  ["24", "Gujarat"],
  ["26", "Dadra and Nagar Haveli and Daman and Diu"],
  ["27", "Maharashtra"],
  ["29", "Karnataka"],
  ["30", "Goa"],
  ["31", "Lakshadweep"],
  ["32", "Kerala"],
  ["33", "Tamil Nadu"],
  ["34", "Puducherry"],
  ["35", "Andaman and Nicobar Islands"],
  ["36", "Telangana"],
  ["37", "Andhra Pradesh"],
  ["38", "Ladakh"],
];

export const SHOP_STATES = STATES.filter((s) => s[0] === "36" || s[0] === "37");

export const MORTALITY_REASONS = [
  "Disease",
  "Transport stress",
  "Water quality",
  "Fighting / injury",
  "Old / weak",
  "Unknown",
  "Damaged / broken (dry goods)",
  "Expired (food)",
];

export const COMPOSITION_STATEMENT =
  "Composition taxable person, not eligible to collect tax on supplies";

export const DISCLAIMER =
  "This is a starter billing and stock tool, not certified GST software and not legal or tax advice. Ask your CA to check your bill format and your GST returns before filing. Live ornamental fish defaults to HSN 0301 (exempt). Services default to SAC 9987 at 18%. Dry goods default to 18% — confirm each rate with the supplier bill or your CA.";

export function stateName(code: string | number | null | undefined): string {
  const key = String(code ?? "");
  for (const row of STATES) if (row[0] === key) return row[1];
  return "";
}

export function toPaise(rupees: unknown): number {
  const n = Number(rupees);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function toRupees(paise: number): number {
  return Math.round(paise) / 100;
}

export function round2(n: unknown): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export interface LineInput {
  qty?: unknown;
  rate?: unknown;
  gstRate?: unknown;
  [key: string]: unknown;
}

export interface LineOpts {
  gstMode?: string;
  priceMode?: string;
  interState?: boolean;
}

export interface LineResult {
  gross: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  gstRate: number;
}

/** Compute one invoice line. Returns paise. */
export function computeLine(line: LineInput, opts: LineOpts = {}): LineResult {
  const qty = Number(line.qty) || 0;
  const r = Number(line.gstRate) || 0;
  const gross = Math.round(toPaise(line.rate) * qty);
  const res: LineResult = { gross, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0, gstRate: r };
  const mode = opts.gstMode || "REGULAR";
  const chargesTax = mode === "REGULAR" && r > 0;
  if (!chargesTax) {
    res.taxable = gross;
    res.total = gross;
    res.gstRate = mode === "REGULAR" ? r : 0;
    return res;
  }
  const taxable = opts.priceMode === "EXCLUSIVE" ? gross : Math.round((gross * 100) / (100 + r));
  res.taxable = taxable;
  if (opts.interState) {
    res.igst = Math.round((taxable * r) / 100);
  } else {
    const half = Math.round((taxable * r) / 200);
    res.cgst = half;
    res.sgst = half;
  }
  res.total = taxable + res.cgst + res.sgst + res.igst;
  return res;
}

export interface RateBucket {
  gstRate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface InvoiceResult {
  lines: LineInput[];
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  subTotal: number;
  roundOff: number;
  total: number;
  docType: string;
  rateSummary: RateBucket[];
}

export function computeInvoice(lines: LineInput[], opts: LineOpts = {}): InvoiceResult {
  const out: InvoiceResult = {
    lines: [],
    taxable: 0,
    cgst: 0,
    sgst: 0,
    igst: 0,
    subTotal: 0,
    roundOff: 0,
    total: 0,
    docType: "",
    rateSummary: [],
  };
  const byRate: Record<string, RateBucket> = {};
  for (const line of lines) {
    const c = computeLine(line, opts);
    const copy: LineInput = { ...line };
    copy.gross = c.gross;
    copy.taxable = c.taxable;
    copy.cgst = c.cgst;
    copy.sgst = c.sgst;
    copy.igst = c.igst;
    copy.total = c.total;
    copy.gstRate = c.gstRate;
    out.lines.push(copy);
    out.taxable += c.taxable;
    out.cgst += c.cgst;
    out.sgst += c.sgst;
    out.igst += c.igst;
    out.subTotal += c.total;
    const key = String(c.gstRate);
    if (!byRate[key]) byRate[key] = { gstRate: c.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    byRate[key].taxable += c.taxable;
    byRate[key].cgst += c.cgst;
    byRate[key].sgst += c.sgst;
    byRate[key].igst += c.igst;
  }
  out.total = Math.round(out.subTotal / 100) * 100;
  out.roundOff = out.total - out.subTotal;
  out.rateSummary = Object.keys(byRate)
    .map((k) => byRate[k]!)
    .sort((a, b) => a.gstRate - b.gstRate);
  out.docType = documentType(out.lines, opts.gstMode);
  return out;
}

/**
 * Invoice heading (Rule 46 / 46A / 49 CGST Rules), as implemented in the starter:
 * Regular + all taxable -> Tax Invoice
 * Regular + all exempt -> Bill of Supply
 * Regular + mixed -> Invoice-cum-Bill of Supply
 * Composition -> Bill of Supply
 * Not registered -> Bill
 */
export function documentType(lines: LineInput[], gstMode?: string): string {
  if (gstMode === "COMPOSITION") return "Bill of Supply";
  if (gstMode === "UNREGISTERED") return "Bill";
  let taxed = 0;
  let exempt = 0;
  for (const line of lines) {
    if (Number(line.gstRate) > 0) taxed++;
    else exempt++;
  }
  if (taxed && exempt) return "Invoice-cum-Bill of Supply";
  if (taxed) return "Tax Invoice";
  return "Bill of Supply";
}

/** Financial year label for an ISO date: Apr–Mar. 2026-11-12 -> "26-27". */
export function fyLabel(isoDate: string): string {
  const y = Number(String(isoDate).slice(0, 4));
  const m = Number(String(isoDate).slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return pad2(start % 100) + "-" + pad2((start + 1) % 100);
}

export function pad2(n: number): string {
  return (n < 10 ? "0" : "") + n;
}

export function cleanPrefix(prefix: unknown): string {
  return String(prefix || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 5);
}

/** ("RA","26-27",7) -> "RA/26-27/0007" (max 16 chars as GST requires, for seq up to 9999). */
export function formatInvoiceNo(prefix: unknown, fy: string, seq: number): string {
  const p = cleanPrefix(prefix);
  let s = String(seq);
  while (s.length < 4) s = "0" + s;
  return (p ? p + "/" : "") + fy + "/" + s;
}

export function nextInvoiceSeq(sales: { fy?: unknown; seq?: unknown }[], fy: string): number {
  let max = 0;
  for (const row of sales) {
    if (String(row.fy) === String(fy)) max = Math.max(max, Number(row.seq) || 0);
  }
  return max + 1;
}

/** GSTIN format + checksum. Returns '' if OK, else a message. */
export function gstinProblem(gstin: unknown): string {
  const g = String(gstin || "")
    .toUpperCase()
    .trim();
  if (!g) return "";
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) {
    return "GSTIN should look like 36ABCDE1234F1Z5 (15 characters).";
  }
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = chars.indexOf(g[i]!) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  const check = chars[(36 - (sum % 36)) % 36];
  if (check !== g[14]) return "GSTIN check digit does not match. Please re-check the number.";
  return "";
}

export interface NormalItem {
  name: string;
  type: ItemType;
  hsn: string;
  gstRate: number;
  unit: string;
  costPrice: number;
  sellPrice: number;
  lowStockAt: number;
  notes: string;
}

/** Validate and normalise an item from the form. Throws Error with a friendly message. */
export function normaliseItem(raw: Record<string, unknown>): NormalItem {
  const type: ItemType = typeof raw.type === "string" && raw.type in ITEM_TYPES ? (raw.type as ItemType) : "DRY";
  const def = ITEM_TYPES[type];
  const name = String(raw.name || "").trim();
  if (!name) throw new Error("Give the item a name.");
  if (name.length > 80) throw new Error("Item name is too long (max 80 characters).");
  const rate = raw.gstRate === "" || raw.gstRate == null ? def.gstRate : Number(raw.gstRate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 40) throw new Error("GST rate must be between 0 and 40%.");
  const sell = Number(raw.sellPrice);
  if (!Number.isFinite(sell) || sell < 0) throw new Error("Enter a selling price (0 or more).");
  const cost = raw.costPrice === "" || raw.costPrice == null ? 0 : Number(raw.costPrice);
  if (!Number.isFinite(cost) || cost < 0) throw new Error("Cost price cannot be negative.");
  const low = raw.lowStockAt === "" || raw.lowStockAt == null ? (def.stocked ? 5 : 0) : Number(raw.lowStockAt);
  return {
    name,
    type,
    hsn: String(raw.hsn == null || raw.hsn === "" ? def.hsn : raw.hsn)
      .replace(/[^0-9]/g, "")
      .slice(0, 8),
    gstRate: rate,
    unit: String(raw.unit || def.unit)
      .toUpperCase()
      .slice(0, 6),
    costPrice: round2(cost),
    sellPrice: round2(sell),
    lowStockAt: def.stocked ? Math.max(0, Math.floor(low) || 0) : 0,
    notes: String(raw.notes || "").slice(0, 200),
  };
}

export function isStocked(type: unknown): boolean {
  return !!(ITEM_TYPES[type as ItemType] && ITEM_TYPES[type as ItemType].stocked);
}

export interface StockItem {
  id: string;
  name: string;
  type: string;
  stock?: unknown;
}

export function applySaleToStock(
  items: StockItem[],
  cartLines: { itemId?: unknown; name?: unknown; qty?: unknown }[],
  allowNegative: boolean,
): { changed: Record<string, number>; shortages: { name: string; have: number; want: number }[] } {
  const byId: Record<string, StockItem> = {};
  items.forEach((it) => {
    byId[it.id] = it;
  });
  const want: Record<string, number> = {};
  cartLines.forEach((l) => {
    const it = byId[String(l.itemId)];
    if (!it) throw new Error(`Item not found: ${String(l.name || l.itemId)}. Refresh and try again.`);
    if (!isStocked(it.type)) return;
    want[it.id] = (want[it.id] || 0) + Number(l.qty);
  });
  const changed: Record<string, number> = {};
  const shortages: { name: string; have: number; want: number }[] = [];
  Object.keys(want).forEach((id) => {
    const have = Number(byId[id]!.stock) || 0;
    if (want[id]! > have) shortages.push({ name: byId[id]!.name, have, want: want[id]! });
    changed[id] = round2(have - want[id]!);
  });
  if (shortages.length && !allowNegative) {
    const s = shortages.map((x) => `${x.name} (have ${x.have}, selling ${x.want})`).join("; ");
    const e = new Error(
      `Not enough stock: ${s}. Record a stock-in first, or turn on "Allow sale when stock is short" in Settings.`,
    );
    (e as Error & { shortages?: typeof shortages }).shortages = shortages;
    throw e;
  }
  return { changed, shortages };
}

export function amountInWords(paiseIn: number): string {
  const ones = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  function two(n: number): string {
    return n < 20 ? ones[n]! : tens[Math.floor(n / 10)]! + (n % 10 ? " " + ones[n % 10] : "");
  }
  function three(n: number): string {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return (h ? ones[h] + " Hundred" + (r ? " " : "") : "") + (r ? two(r) : "");
  }
  function words(n: number): string {
    if (n === 0) return "Zero";
    const parts: string[] = [];
    const crore = Math.floor(n / 10000000);
    n %= 10000000;
    const lakh = Math.floor(n / 100000);
    n %= 100000;
    const thousand = Math.floor(n / 1000);
    n %= 1000;
    if (crore) parts.push(words(crore) + " Crore");
    if (lakh) parts.push(two(lakh) + " Lakh");
    if (thousand) parts.push(two(thousand) + " Thousand");
    if (n) parts.push(three(n));
    return parts.join(" ");
  }
  const paise = Math.round(Math.abs(paiseIn));
  const r = Math.floor(paise / 100);
  const p = paise % 100;
  return "Rupees " + words(r) + (p ? " and " + two(p) + " Paise" : "") + " Only";
}

/** Indian money format: 1234567.5 -> "12,34,567.50" */
export function formatINR(rupees: unknown): string {
  let n = Number(rupees) || 0;
  const neg = n < 0;
  n = Math.abs(n);
  const s = n.toFixed(2);
  const int = s.split(".")[0]!;
  const dec = s.split(".")[1]!;
  let last3 = int.slice(-3);
  let rest = int.slice(0, -3);
  if (rest) last3 = "," + last3;
  rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return (neg ? "-" : "") + rest + last3 + "." + dec;
}

export interface SaleSummary {
  count: number;
  total: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  byPayment: Record<string, number>;
  days: { date: string; count: number; total: number }[];
}

export function summariseSales(sales: Record<string, unknown>[]): SaleSummary {
  const s: SaleSummary & { byDay?: Record<string, { date: string; count: number; total: number }> } = {
    count: 0,
    total: 0,
    taxable: 0,
    cgst: 0,
    sgst: 0,
    igst: 0,
    byPayment: {},
    days: [],
    byDay: {},
  };
  sales.forEach((x) => {
    if (x.status === "CANCELLED") return;
    s.count++;
    s.total = round2(s.total + Number(x.total));
    s.taxable = round2(s.taxable + Number(x.taxable));
    s.cgst = round2(s.cgst + Number(x.cgst));
    s.sgst = round2(s.sgst + Number(x.sgst));
    s.igst = round2(s.igst + Number(x.igst));
    const p = String(x.payment || "Cash");
    s.byPayment[p] = round2((s.byPayment[p] || 0) + Number(x.total));
    const d = String(x.date);
    if (!s.byDay![d]) s.byDay![d] = { date: d, count: 0, total: 0 };
    s.byDay![d]!.count++;
    s.byDay![d]!.total = round2(s.byDay![d]!.total + Number(x.total));
  });
  s.days = Object.keys(s.byDay!)
    .sort()
    .reverse()
    .map((k) => s.byDay![k]!);
  delete s.byDay;
  return s;
}

export interface HsnRow {
  hsn: string;
  description: string;
  unit: string;
  qty: number;
  total: number;
  taxable: number;
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export function hsnSummary(lines: Record<string, unknown>[]): HsnRow[] {
  const m: Record<string, HsnRow> = {};
  lines.forEach((l) => {
    if (l.status === "CANCELLED") return;
    const key = `${String(l.hsn || "-")}|${Number(l.gstRate)}`;
    if (!m[key]) {
      m[key] = {
        hsn: String(l.hsn || ""),
        description: l.type === "FISH" ? "Live ornamental fish" : l.type === "SERVICE" ? "Services" : "Goods",
        unit: String(l.unit || "NOS"),
        qty: 0,
        total: 0,
        taxable: 0,
        gstRate: Number(l.gstRate),
        cgst: 0,
        sgst: 0,
        igst: 0,
      };
    }
    const r = m[key]!;
    r.qty = round2(r.qty + Number(l.qty));
    r.total = round2(r.total + Number(l.total));
    r.taxable = round2(r.taxable + Number(l.taxable));
    r.cgst = round2(r.cgst + Number(l.cgst));
    r.sgst = round2(r.sgst + Number(l.sgst));
    r.igst = round2(r.igst + Number(l.igst));
  });
  return Object.keys(m)
    .sort()
    .map((k) => m[k]!);
}

export function mortalitySummary(deadRows: Record<string, unknown>[], stockInRows: Record<string, unknown>[]) {
  const m: Record<
    string,
    {
      itemId: string;
      name: string;
      dead: number;
      received: number;
      loss: number;
      reasons: Record<string, number>;
      ratePct: number | null;
    }
  > = {};
  deadRows.forEach((d) => {
    const id = String(d.itemId);
    if (!m[id]) m[id] = { itemId: id, name: String(d.itemName), dead: 0, received: 0, loss: 0, reasons: {}, ratePct: null };
    m[id]!.dead += Number(d.qty);
    m[id]!.loss = round2(m[id]!.loss + Number(d.lossValue));
    const reason = String(d.reason);
    m[id]!.reasons[reason] = (m[id]!.reasons[reason] || 0) + Number(d.qty);
  });
  stockInRows.forEach((s) => {
    const id = String(s.itemId);
    if (m[id]) m[id]!.received += Number(s.qty);
  });
  const rows = Object.keys(m)
    .map((k) => {
      const r = m[k]!;
      r.ratePct = r.received > 0 ? round2((r.dead * 100) / r.received) : null;
      return r;
    })
    .sort((a, b) => b.dead - a.dead);
  const tot = { dead: 0, loss: 0 };
  rows.forEach((r) => {
    tot.dead += r.dead;
    tot.loss = round2(tot.loss + r.loss);
  });
  return { rows, totalDead: tot.dead, totalLoss: tot.loss };
}

export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@]/.test(s) && Number.isNaN(Number(s))) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function salesRegisterRows(sales: Record<string, unknown>[], lines: Record<string, unknown>[]): unknown[][] {
  const saleBy: Record<string, Record<string, unknown>> = {};
  sales.forEach((s) => {
    saleBy[String(s.invoiceNo)] = s;
  });
  const rows: unknown[][] = [
    [
      "Invoice date",
      "Invoice no",
      "Document type",
      "Status",
      "Customer name",
      "Customer GSTIN",
      "Place of supply",
      "Supply type",
      "Payment",
      "HSN/SAC",
      "Description",
      "Qty",
      "UQC",
      "Rate incl. (Rs)",
      "Taxable value (Rs)",
      "GST rate %",
      "CGST (Rs)",
      "SGST (Rs)",
      "IGST (Rs)",
      "Line total (Rs)",
    ],
  ];
  lines.forEach((l) => {
    const s = saleBy[String(l.invoiceNo)] || {};
    rows.push([
      l.date,
      l.invoiceNo,
      s.docType || "",
      s.status || l.status || "",
      s.customerName || "",
      s.customerGstin || "",
      s.placeOfSupply ? `${s.placeOfSupply}-${stateName(String(s.placeOfSupply))}` : "",
      s.supplyType || "",
      s.payment || "",
      l.hsn,
      l.name,
      l.qty,
      l.unit,
      l.rate,
      l.taxable,
      l.gstRate,
      l.cgst,
      l.sgst,
      l.igst,
      l.total,
    ]);
  });
  return rows;
}

export function hsnSummaryRows(lines: Record<string, unknown>[]): unknown[][] {
  const rows: unknown[][] = [
    [
      "HSN/SAC",
      "Description",
      "UQC",
      "Total qty",
      "Total value (Rs)",
      "GST rate %",
      "Taxable value (Rs)",
      "IGST (Rs)",
      "CGST (Rs)",
      "SGST (Rs)",
    ],
  ];
  hsnSummary(lines).forEach((h) => {
    rows.push([h.hsn, h.description, h.unit, h.qty, h.total, h.gstRate, h.taxable, h.igst, h.cgst, h.sgst]);
  });
  return rows;
}

export function stockRows(items: Record<string, unknown>[]): unknown[][] {
  const rows: unknown[][] = [
    [
      "Item",
      "Type",
      "HSN/SAC",
      "GST %",
      "Unit",
      "Stock on hand",
      "Cost price (Rs)",
      "Sell price (Rs)",
      "Stock value at cost (Rs)",
      "Stock value at sell price (Rs)",
      "Low stock?",
    ],
  ];
  items.forEach((i) => {
    if (String(i.active) === "false") return;
    const stocked = isStocked(i.type);
    rows.push([
      i.name,
      ITEM_TYPES[i.type as ItemType]?.label || i.type,
      i.hsn,
      i.gstRate,
      i.unit,
      stocked ? i.stock : "n/a",
      i.costPrice,
      i.sellPrice,
      stocked ? round2(Number(i.stock) * Number(i.costPrice)) : "",
      stocked ? round2(Number(i.stock) * Number(i.sellPrice)) : "",
      stocked && Number(i.stock) <= Number(i.lowStockAt) ? "Yes" : "",
    ]);
  });
  return rows;
}

/** Starter items so the app is not empty on day one. Prices are illustrative. */
export function sampleItems(): Record<string, unknown>[] {
  return [
    { name: "Guppy (pair)", type: "FISH", sellPrice: 60, costPrice: 15, stock: 0, lowStockAt: 10 },
    { name: "Goldfish (small)", type: "FISH", sellPrice: 50, costPrice: 15, stock: 0, lowStockAt: 10 },
    { name: "Molly", type: "FISH", sellPrice: 30, costPrice: 8, stock: 0, lowStockAt: 10 },
    { name: "Angelfish", type: "FISH", sellPrice: 120, costPrice: 30, stock: 0, lowStockAt: 5 },
    { name: "Fish food 100 g", type: "DRY", sellPrice: 150, costPrice: 95, stock: 0, lowStockAt: 5 },
    { name: "Glass tank 2 ft", type: "DRY", sellPrice: 1800, costPrice: 1200, stock: 0, lowStockAt: 2 },
    { name: "Air pump (single)", type: "DRY", sellPrice: 350, costPrice: 210, stock: 0, lowStockAt: 3 },
    { name: "Tank cleaning visit", type: "SERVICE", sellPrice: 500, costPrice: 0 },
  ];
}
