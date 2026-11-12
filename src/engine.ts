/**
 * Shop engine: the Apps Script Code.gs API, kept synchronous and free of Google
 * services so Vitest can run the original shop flows. The browser persists the
 * snapshot to IndexedDB and Google Sheets.
 *
 * Invoice numbers come from nextInvoiceSeq (max seq for the financial year,
 * including cancelled bills) so a number is never reused and the sequence
 * restarts on 1 April. Two devices billing at the same moment are reconciled
 * by the Sheets sync layer (Counters claim). This engine itself is single-threaded.
 */
import { hashPin } from "./sha256";
import {
  GST_MODES,
  ITEM_TYPES,
  MORTALITY_REASONS,
  STATES,
  amountInWords,
  applySaleToStock,
  cleanPrefix,
  computeInvoice,
  formatInvoiceNo,
  fyLabel,
  gstinProblem,
  hsnSummary,
  hsnSummaryRows,
  isStocked,
  mortalitySummary,
  nextInvoiceSeq,
  normaliseItem,
  round2,
  salesRegisterRows,
  sampleItems,
  stateName,
  stockRows,
  summariseSales,
  toCsv,
  toRupees,
} from "./logic";

export const APP_VERSION = "1.0.0";

export const DEFAULT_SETTINGS: Record<string, string> = {
  shopName: "Rohit Aquarium",
  address: "",
  city: "Hyderabad",
  pincode: "",
  phone: "",
  email: "",
  gstin: "",
  state: "36",
  gstMode: "REGULAR",
  priceMode: "INCLUSIVE",
  invoicePrefix: "RA",
  upiId: "",
  invoiceFooter: "Thank you! Live fish once sold cannot be returned.",
  paper: "A4",
  allowNegativeStock: "false",
  setupDone: "false",
};

export interface ApiOk<T> {
  ok: true;
  data: T;
}
export interface ApiErr {
  ok: false;
  error: string;
  code?: string;
}
export type ApiResult<T = unknown> = ApiOk<T> | ApiErr;

export interface CounterRow {
  fy: string;
  lastSeq: number;
  claimId: string;
  claimedAt: string;
}

export interface Snapshot {
  settings: Record<string, string>;
  items: Record<string, unknown>[];
  stockIn: Record<string, unknown>[];
  mortality: Record<string, unknown>[];
  sales: Record<string, unknown>[];
  saleLines: Record<string, unknown>[];
  counters: CounterRow[];
  pinHash: string;
  pinSalt: string;
}

export interface ExportFile {
  name: string;
  url: string;
  sheets: { rows: unknown[][] }[];
}

type Row = Record<string, unknown>;
type Payload = Record<string, unknown>;

export class ShopEngine {
  /** ISO timestamp used as "now". Null means the real clock. Tests reassign this. */
  clock: string | null;
  files: Record<string, ExportFile> = {};

  private settings: Record<string, string>;
  private items: Row[] = [];
  private stockIn: Row[] = [];
  private mortality: Row[] = [];
  private sales: Row[] = [];
  private saleLines: Row[] = [];
  private counters: CounterRow[] = [];
  private pinHash = "";
  private pinSalt = "";
  private tokens = new Map<string, number>();
  private pinFails = 0;
  private pinFailUntil = 0;
  private idn = 0;

  constructor(opts?: { now?: string | null }) {
    this.clock = opts?.now ?? null;
    this.settings = { ...DEFAULT_SETTINGS };
  }

  static fromSnapshot(snap: Snapshot, opts?: { now?: string | null }): ShopEngine {
    const engine = new ShopEngine(opts);
    engine.replaceData(snap);
    return engine;
  }

  exportSnapshot(): Snapshot {
    return {
      settings: { ...this.settings },
      items: structuredClone(this.items),
      stockIn: structuredClone(this.stockIn),
      mortality: structuredClone(this.mortality),
      sales: structuredClone(this.sales),
      saleLines: structuredClone(this.saleLines),
      counters: structuredClone(this.counters),
      pinHash: this.pinHash,
      pinSalt: this.pinSalt,
    };
  }

  replaceData(snap: Snapshot) {
    this.settings = { ...DEFAULT_SETTINGS, ...snap.settings };
    this.items = structuredClone(snap.items || []);
    this.stockIn = structuredClone(snap.stockIn || []);
    this.mortality = structuredClone(snap.mortality || []);
    this.sales = structuredClone(snap.sales || []);
    this.saleLines = structuredClone(snap.saleLines || []);
    this.counters = structuredClone(snap.counters || []);
    this.pinHash = snap.pinHash || "";
    this.pinSalt = snap.pinSalt || "";
  }

  /** Owner-only PIN reset after Google re-authentication (or demo confirm). */
  clearPin() {
    this.pinHash = "";
    this.pinSalt = "";
  }

  /** Keep an in-memory unlock token after a snapshot reload. */
  adoptToken(token: string | null | undefined) {
    if (!token) return;
    this.tokens.set(token, Date.now() + 21_600_000);
  }

  /** Rows as the app stores them. Text fields (dates, HSN, invoice numbers) stay strings. */
  table(name: string): Row[] {
    if (name === "Settings") return Object.entries(this.settings).map(([key, value]) => ({ key, value }));
    if (name === "Items") return this.items;
    if (name === "StockIn") return this.stockIn;
    if (name === "Mortality") return this.mortality;
    if (name === "Sales") return this.sales;
    if (name === "SaleLines") return this.saleLines;
    if (name === "Counters") return this.counters.map((c) => ({ ...c }));
    return [];
  }

  api(action: string, payload: Payload = {}, token?: string | null): ApiResult {
    const handlers: Record<string, { open?: boolean; fn: (p: Payload, token?: string | null) => unknown }> = {
      bootstrap: { open: true, fn: (p, t) => this.apiBootstrap(p, t) },
      setup: { open: true, fn: (p) => this.apiSetup(p) },
      unlock: { open: true, fn: (p) => this.apiUnlock(p) },
      saveSettings: { fn: (p) => this.apiSaveSettings(p) },
      setPin: { fn: (p) => this.apiSetPin(p) },
      listItems: { fn: () => this.listItems() },
      saveItem: { fn: (p) => this.apiSaveItem(p) },
      stockIn: { fn: (p) => this.apiStockIn(p) },
      mortality: { fn: (p) => this.apiMortality(p) },
      movements: { fn: (p) => this.apiMovements(p) },
      createSale: { fn: (p) => this.apiCreateSale(p) },
      getSale: { fn: (p) => this.apiGetSale(p) },
      listSales: { fn: (p) => this.apiListSales(p) },
      cancelSale: { fn: (p) => this.apiCancelSale(p) },
      dashboard: { fn: () => this.apiDashboard() },
      report: { fn: (p) => this.apiReport(p) },
      exportCsv: { fn: (p) => this.apiExportCsv(p) },
      exportToSheet: { fn: (p) => this.apiExportToSheet(p) },
    };
    const h = handlers[action];
    if (!h) return { ok: false, error: "Unknown action: " + action };
    try {
      if (!h.open && !payload?.replay) {
        if (this.settings.setupDone !== "true") return { ok: false, error: "Finish shop setup first.", code: "SETUP" };
        if (!this.tokenValid(token)) return { ok: false, error: "Enter the shop PIN to continue.", code: "LOCKED" };
      }
      return { ok: true, data: h.fn(payload || {}, token) };
    } catch (e) {
      return { ok: false, error: e instanceof Error && e.message ? e.message : String(e) };
    }
  }

  buildExport(p: Payload): { name: string; rows: unknown[][] } {
    const r = this.monthRange(p.month);
    const kind = String(p.kind || "");
    if (kind === "sales") {
      const sales = this.sales.filter((s) => this.inRange(s.date, r));
      const lines = this.saleLines
        .filter((l) => this.inRange(l.date, r))
        .sort((a, b) =>
          String(a.invoiceNo) < String(b.invoiceNo) ? -1 : a.invoiceNo === b.invoiceNo ? Number(a.lineNo) - Number(b.lineNo) : 1,
        );
      return { name: "sales-register-" + r.month, rows: salesRegisterRows(sales, lines) };
    }
    if (kind === "hsn") {
      return { name: "hsn-summary-" + r.month, rows: hsnSummaryRows(this.saleLines.filter((l) => this.inRange(l.date, r))) };
    }
    if (kind === "stock") return { name: "stock-on-hand-" + this.today(), rows: stockRows(this.items) };
    if (kind === "mortality") {
      const rows: unknown[][] = [["Date", "Item", "Qty", "Reason", "Unit cost (Rs)", "Loss value (Rs)", "Note"]];
      this.mortality
        .filter((m) => this.inRange(m.date, r))
        .forEach((m) => rows.push([m.date, m.itemName, m.qty, m.reason, m.unitCost, m.lossValue, m.note]));
      return { name: "dead-stock-" + r.month, rows };
    }
    if (kind === "stockin") {
      const rows: unknown[][] = [["Date", "Item", "Qty", "Unit cost (Rs)", "Total cost (Rs)", "Supplier", "City", "Supplier bill no", "Note"]];
      this.stockIn
        .filter((m) => this.inRange(m.date, r))
        .forEach((m) => rows.push([m.date, m.itemName, m.qty, m.unitCost, m.totalCost, m.supplier, m.city, m.billNo, m.note]));
      return { name: "purchases-" + r.month, rows };
    }
    throw new Error("Unknown export.");
  }

  private nowDate(): Date {
    return this.clock ? new Date(this.clock) : new Date();
  }

  private kolkata(date: Date): { date: string; time: string; iso: string } {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const map: Record<string, string> = {};
    for (const part of fmt.formatToParts(date)) map[part.type] = part.value;
    const hh = map.hour === "24" ? "00" : map.hour;
    const dateStr = `${map.year}-${map.month}-${map.day}`;
    const time = `${hh}:${map.minute}`;
    return { date: dateStr, time, iso: `${dateStr}T${hh}:${map.minute}:${map.second}` };
  }

  private today(): string {
    return this.kolkata(this.nowDate()).date;
  }

  private nowIso(): string {
    return this.kolkata(this.nowDate()).iso;
  }

  private clockFor(p: Payload): { date: string; time: string; iso: string } {
    if (p.bookedAt) return this.kolkata(new Date(String(p.bookedAt)));
    return this.kolkata(this.nowDate());
  }

  private newId(prefix: string): string {
    this.idn += 1;
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return (prefix + this.idn.toString(36).toUpperCase() + rand).slice(0, 12);
  }

  private tokenValid(token?: string | null): boolean {
    if (!this.pinHash) return true;
    if (!token) return false;
    const exp = this.tokens.get(token);
    return !!exp && exp > Date.now();
  }

  private issueToken(): string {
    const t = crypto.randomUUID();
    this.tokens.set(t, Date.now() + 21_600_000);
    return t;
  }

  private setPinHash(pin: string) {
    const value = String(pin || "");
    if (!/^\d{4,8}$/.test(value)) throw new Error("PIN must be 4 to 8 digits.");
    this.pinSalt = crypto.randomUUID();
    this.pinHash = hashPin(this.pinSalt, value);
  }

  private cleanDate(d: unknown, today = this.today()): string {
    const s = String(d || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return today;
    if (s > today) throw new Error("Date cannot be in the future.");
    return s;
  }

  private posNumber(v: unknown, label: string): number {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) throw new Error(label + " must be more than 0.");
    return round2(n);
  }

  private getSettings(): Record<string, string> {
    return { ...DEFAULT_SETTINGS, ...this.settings };
  }

  private saveSettingsMap(map: Record<string, string>) {
    for (const [k, v] of Object.entries(map)) this.settings[k] = v == null ? "" : String(v);
  }

  private cleanShop(p: Payload): Record<string, string> {
    const name = String(p.shopName || "").trim();
    if (!name) throw new Error("Enter the shop name.");
    const state = p.state === "37" ? "37" : "36";
    const gstin = String(p.gstin || "")
      .toUpperCase()
      .replace(/\s/g, "");
    const mode = typeof p.gstMode === "string" && p.gstMode in GST_MODES ? p.gstMode : "REGULAR";
    if (mode !== "UNREGISTERED") {
      if (!gstin) throw new Error('Enter your GSTIN, or choose "Not registered for GST" for now.');
      const prob = gstinProblem(gstin);
      if (prob) throw new Error(prob);
      if (gstin.slice(0, 2) !== state) {
        throw new Error(
          `GSTIN starts with ${gstin.slice(0, 2)} but the shop state is ${stateName(state)} (${state}). Check the state or GSTIN.`,
        );
      }
    }
    const phone = String(p.phone || "")
      .replace(/[^0-9+ ]/g, "")
      .trim();
    return {
      shopName: name.slice(0, 60),
      address: String(p.address || "")
        .trim()
        .slice(0, 160),
      city: String(p.city || "")
        .trim()
        .slice(0, 40),
      pincode: String(p.pincode || "")
        .replace(/\D/g, "")
        .slice(0, 6),
      phone: phone.slice(0, 20),
      email: String(p.email || "")
        .trim()
        .slice(0, 60),
      gstin: mode === "UNREGISTERED" ? "" : gstin,
      state,
      gstMode: mode,
      priceMode: p.priceMode === "EXCLUSIVE" ? "EXCLUSIVE" : "INCLUSIVE",
      invoicePrefix: cleanPrefix(p.invoicePrefix),
      upiId: String(p.upiId || "")
        .trim()
        .slice(0, 60),
      invoiceFooter: String(p.invoiceFooter || "")
        .trim()
        .slice(0, 240),
      paper: p.paper === "80MM" ? "80MM" : "A4",
      allowNegativeStock: String(p.allowNegativeStock) === "true" ? "true" : "false",
    };
  }

  private publicSettings(): Record<string, unknown> {
    const s = this.getSettings();
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(DEFAULT_SETTINGS)) o[k] = s[k];
    o.stateName = stateName(s.state);
    o.pinSet = !!this.pinHash;
    return o;
  }

  private findById(rows: Row[], id: unknown): Row {
    const found = rows.find((r) => r.id === id);
    if (!found) throw new Error("Item not found. Refresh and try again.");
    return found;
  }

  private cleanItemOut(i: Row) {
    return {
      id: i.id,
      name: String(i.name),
      type: i.type,
      hsn: String(i.hsn || ""),
      gstRate: Number(i.gstRate) || 0,
      unit: i.unit || "NOS",
      costPrice: Number(i.costPrice) || 0,
      sellPrice: Number(i.sellPrice) || 0,
      stock: Number(i.stock) || 0,
      lowStockAt: Number(i.lowStockAt) || 0,
      notes: i.notes || "",
    };
  }

  private listItems() {
    return this.items
      .filter((i) => String(i.active) !== "false")
      .map((i) => this.cleanItemOut(i))
      .sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
  }

  private apiBootstrap(_p: Payload, token?: string | null) {
    const s = this.getSettings();
    const res: Record<string, unknown> = {
      version: APP_VERSION,
      setupDone: s.setupDone === "true",
      today: this.today(),
      states: STATES,
    };
    if (!res.setupDone) {
      res.settings = this.publicSettings();
      return res;
    }
    if (!this.tokenValid(token)) {
      res.locked = true;
      res.shopName = s.shopName;
      return res;
    }
    res.settings = this.publicSettings();
    res.items = this.listItems();
    res.dashboard = this.apiDashboard();
    res.sheetUrl = "";
    return res;
  }

  private apiSetup(p: Payload) {
    if (this.getSettings().setupDone === "true") {
      if (p.replay) return this.apiBootstrap({}, null);
      throw new Error("Setup is already done. Use Settings to change shop details.");
    }
    const shop = this.cleanShop(p);
    shop.setupDone = "true";
    this.saveSettingsMap(shop);
    if (String(p.addSamples) === "true" && this.items.length === 0) {
      const preset = new Map<string, string>();
      if (Array.isArray(p.sampleIds)) {
        for (const row of p.sampleIds as { name?: unknown; id?: unknown }[]) {
          if (row?.name && row?.id) preset.set(String(row.name), String(row.id));
        }
      }
      const now = this.nowIso();
      for (const raw of sampleItems()) {
        const it = normaliseItem(raw) as unknown as Row;
        it.id = preset.get(String(it.name)) || this.newId("I");
        it.stock = 0;
        it.active = "true";
        it.createdAt = now;
        it.updatedAt = now;
        this.items.push(it);
      }
    }
    if (p.pin) this.setPinHash(String(p.pin));
    const token = p.pin ? this.issueToken() : null;
    const boot = this.apiBootstrap({}, token) as Record<string, unknown>;
    if (token) boot.token = token;
    return boot;
  }

  private apiUnlock(p: Payload) {
    if (this.pinFails >= 10) {
      if (Date.now() < this.pinFailUntil) throw new Error("Too many wrong PINs. Wait 10 minutes and try again.");
      this.pinFails = 0;
    }
    if (!this.pinHash) return { token: null };
    if (hashPin(this.pinSalt, String(p.pin || "")) !== this.pinHash) {
      this.pinFails += 1;
      this.pinFailUntil = Date.now() + 600_000;
      throw new Error("Wrong PIN. Try again.");
    }
    this.pinFails = 0;
    return { token: this.issueToken() };
  }

  private apiSetPin(p: Payload) {
    if (p.remove) {
      this.pinHash = "";
      this.pinSalt = "";
      return { pinSet: false, token: null };
    }
    this.setPinHash(String(p.pin || ""));
    return { pinSet: true, token: this.issueToken() };
  }

  private apiSaveSettings(p: Payload) {
    const shop = this.cleanShop(p);
    this.saveSettingsMap(shop);
    return this.publicSettings();
  }

  private apiSaveItem(p: Payload) {
    const now = this.clockFor(p).iso;
    if (p.archive && p.id) {
      const a = this.findById(this.items, p.id);
      a.active = "false";
      a.updatedAt = now;
      return { items: this.listItems() };
    }
    const it = normaliseItem(p) as unknown as Row;
    const dup = this.items.filter(
      (x) => String(x.active) !== "false" && x.id !== p.id && String(x.name).toLowerCase() === String(it.name).toLowerCase(),
    );
    if (dup.length) throw new Error(`An item called "${String(it.name)}" already exists.`);
    let saved: Row;
    const existing = p.id ? this.items.find((x) => x.id === p.id) : undefined;
    if (p.id && existing) {
      if (!isStocked(it.type) && isStocked(existing.type) && Number(existing.stock) !== 0) {
        throw new Error("This item still has stock. Set stock to 0 (record dead/damaged stock) before changing it to a service.");
      }
      for (const k of Object.keys(it)) existing[k] = it[k];
      existing.updatedAt = now;
      saved = existing;
    } else if (p.id && !existing && !p.createWithId) {
      throw new Error("Item not found. Refresh and try again.");
    } else {
      it.id = p.id && p.createWithId ? p.id : this.newId("I");
      const opening = p.openingStock === "" || p.openingStock == null ? 0 : Number(p.openingStock);
      if (!Number.isFinite(opening) || opening < 0) throw new Error("Opening stock cannot be negative.");
      it.stock = isStocked(it.type) ? round2(opening) : 0;
      it.active = "true";
      it.createdAt = now;
      it.updatedAt = now;
      if (!this.items.some((x) => x.id === it.id)) this.items.push(it);
      if (Number(it.stock) > 0 && !this.stockIn.some((s) => s.itemId === it.id && s.supplier === "Opening stock" && s.note === String(it.id))) {
        this.stockIn.push({
          id: this.newId("S"),
          date: this.clockFor(p).date,
          itemId: it.id,
          itemName: it.name,
          qty: it.stock,
          unitCost: it.costPrice,
          totalCost: round2(Number(it.stock) * Number(it.costPrice)),
          supplier: "Opening stock",
          city: "",
          billNo: "",
          note: "",
          createdAt: now,
        });
      }
      saved = it;
    }
    return { item: this.cleanItemOut(saved), items: this.listItems() };
  }

  private recent(rows: Row[], limit: number) {
    return [...rows]
      .sort((a, b) => (String(b.createdAt) < String(a.createdAt) ? -1 : 1))
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  private apiMovements(p: Payload) {
    const lim = Number(p.limit) || 30;
    return {
      stockIn: this.recent(this.stockIn, lim),
      mortality: this.recent(this.mortality, lim),
      reasons: MORTALITY_REASONS,
    };
  }

  private apiStockIn(p: Payload) {
    if (p.id && this.stockIn.some((s) => s.id === p.id)) {
      return { items: this.listItems(), movements: this.apiMovements({}) };
    }
    const it = this.findById(this.items, p.itemId);
    if (!isStocked(it.type)) throw new Error("Services do not have stock.");
    const qty = this.posNumber(p.qty, "Quantity");
    const unitCost = p.unitCost === "" || p.unitCost == null ? Number(it.costPrice) || 0 : Number(p.unitCost);
    if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error("Unit cost cannot be negative.");
    const when = this.clockFor(p);
    const date = this.cleanDate(p.date, when.date);
    this.stockIn.push({
      id: p.id || this.newId("S"),
      date,
      itemId: it.id,
      itemName: it.name,
      qty,
      unitCost: round2(unitCost),
      totalCost: round2(qty * unitCost),
      supplier: String(p.supplier || "")
        .trim()
        .slice(0, 60),
      city: String(p.city || "")
        .trim()
        .slice(0, 40),
      billNo: String(p.billNo || "")
        .trim()
        .slice(0, 30),
      note: String(p.note || "")
        .trim()
        .slice(0, 120),
      createdAt: when.iso,
    });
    it.stock = round2((Number(it.stock) || 0) + qty);
    if (String(p.updateCost) !== "false" && p.unitCost !== "" && p.unitCost != null) it.costPrice = round2(unitCost);
    it.updatedAt = when.iso;
    return { items: this.listItems(), movements: this.apiMovements({}) };
  }

  private apiMortality(p: Payload) {
    if (p.id && this.mortality.some((s) => s.id === p.id)) {
      return { items: this.listItems(), movements: this.apiMovements({}) };
    }
    const it = this.findById(this.items, p.itemId);
    if (!isStocked(it.type)) throw new Error("Services do not have stock.");
    const qty = this.posNumber(p.qty, "Quantity");
    const have = Number(it.stock) || 0;
    if (qty > have && this.getSettings().allowNegativeStock !== "true") {
      throw new Error(`Only ${have} in stock for ${String(it.name)}. Check the quantity.`);
    }
    const reason = MORTALITY_REASONS.includes(String(p.reason)) ? String(p.reason) : "Unknown";
    const cost = Number(it.costPrice) || 0;
    const when = this.clockFor(p);
    this.mortality.push({
      id: p.id || this.newId("M"),
      date: this.cleanDate(p.date, when.date),
      itemId: it.id,
      itemName: it.name,
      qty,
      reason,
      unitCost: cost,
      lossValue: round2(qty * cost),
      note: String(p.note || "")
        .trim()
        .slice(0, 120),
      createdAt: when.iso,
    });
    it.stock = round2(have - qty);
    it.updatedAt = when.iso;
    return { items: this.listItems(), movements: this.apiMovements({}) };
  }

  private bumpCounter(fy: string, seq: number) {
    const row = this.counters.find((c) => c.fy === fy);
    if (!row) this.counters.push({ fy, lastSeq: seq, claimId: "", claimedAt: "" });
    else if (seq > row.lastSeq) row.lastSeq = seq;
  }

  private apiCreateSale(p: Payload) {
    const clientId = String(p.clientId || "");
    if (clientId) {
      const existing = this.sales.find((s) => s.clientId === clientId);
      if (existing) {
        return { invoice: this.apiGetSale({ invoiceNo: existing.invoiceNo }), items: this.listItems(), shortages: [] };
      }
    }
    const cart = ((p.lines as Row[]) || []).filter((l) => Number(l.qty) > 0);
    if (!cart.length) throw new Error("Add at least one item to the bill.");
    if (cart.length > 60) throw new Error("Too many lines on one bill (max 60).");
    const s = this.getSettings();
    const byId: Record<string, Row> = {};
    this.items.forEach((i) => {
      byId[String(i.id)] = i;
    });
    const lines = cart.map((l, idx) => {
      const it = byId[String(l.itemId)];
      if (!it || String(it.active) === "false") throw new Error("An item on the bill no longer exists. Refresh and try again.");
      const qty = this.posNumber(l.qty, "Quantity for " + String(it.name));
      const rate = l.rate === "" || l.rate == null ? Number(it.sellPrice) : Number(l.rate);
      if (!Number.isFinite(rate) || rate < 0) throw new Error("Price for " + String(it.name) + " cannot be negative.");
      return {
        lineNo: idx + 1,
        itemId: it.id,
        name: String(it.name),
        type: it.type,
        hsn: String(it.hsn || ""),
        unit: it.unit || "NOS",
        qty,
        rate: round2(rate),
        gstRate: Number(it.gstRate) || 0,
        costPrice: Number(it.costPrice) || 0,
      };
    });
    const stock = applySaleToStock(
      this.items.map((i) => ({ id: String(i.id), name: String(i.name), type: String(i.type), stock: i.stock })),
      lines,
      s.allowNegativeStock === "true",
    );
    const pos = /^\d{2}$/.test(String(p.placeOfSupply || "")) && stateName(String(p.placeOfSupply)) ? String(p.placeOfSupply) : s.state;
    const inter = pos !== s.state;
    const calc = computeInvoice(lines, { gstMode: s.gstMode, priceMode: s.priceMode, interState: inter });
    const custGstin = String(p.customerGstin || "")
      .toUpperCase()
      .replace(/\s/g, "");
    if (custGstin) {
      const gp = gstinProblem(custGstin);
      if (gp) throw new Error("Customer " + gp);
    }
    const when = this.clockFor(p);
    const date = when.date;
    const fy = fyLabel(date);
    const seq = nextInvoiceSeq(this.sales, fy);
    const invoiceNo = formatInvoiceNo(s.invoicePrefix, fy, seq);
    const payment = ["Cash", "UPI", "Card"].includes(String(p.payment)) ? String(p.payment) : "Cash";
    const shop = {
      shopName: s.shopName,
      address: s.address,
      city: s.city,
      pincode: s.pincode,
      phone: s.phone,
      email: s.email,
      gstin: s.gstin,
      state: s.state,
      upiId: s.upiId,
      invoiceFooter: s.invoiceFooter,
      paper: s.paper,
    };
    this.sales.push({
      invoiceNo,
      date,
      time: when.time,
      fy,
      seq,
      docType: calc.docType,
      customerName: String(p.customerName || "")
        .trim()
        .slice(0, 60),
      customerPhone: String(p.customerPhone || "")
        .replace(/[^0-9+]/g, "")
        .slice(0, 15),
      customerGstin: custGstin,
      placeOfSupply: pos,
      supplyType: inter ? "Inter-state" : "Intra-state",
      payment,
      gstMode: s.gstMode,
      priceMode: s.priceMode,
      itemCount: lines.length,
      taxable: toRupees(calc.taxable),
      cgst: toRupees(calc.cgst),
      sgst: toRupees(calc.sgst),
      igst: toRupees(calc.igst),
      roundOff: toRupees(calc.roundOff),
      total: toRupees(calc.total),
      status: "ACTIVE",
      cancelReason: "",
      shopJson: JSON.stringify(shop),
      createdAt: when.iso,
      clientId,
    });
    for (const l of calc.lines) {
      this.saleLines.push({
        invoiceNo,
        date,
        lineNo: l.lineNo,
        itemId: l.itemId,
        name: l.name,
        type: l.type,
        hsn: l.hsn,
        unit: l.unit,
        qty: l.qty,
        rate: l.rate,
        gstRate: l.gstRate,
        gross: toRupees(Number(l.gross)),
        taxable: toRupees(Number(l.taxable)),
        cgst: toRupees(Number(l.cgst)),
        sgst: toRupees(Number(l.sgst)),
        igst: toRupees(Number(l.igst)),
        total: toRupees(Number(l.total)),
        costPrice: l.costPrice,
        status: "ACTIVE",
      });
    }
    for (const id of Object.keys(stock.changed)) {
      const item = byId[id];
      if (item) item.stock = stock.changed[id];
    }
    this.bumpCounter(fy, seq);
    return { invoice: this.apiGetSale({ invoiceNo }), items: this.listItems(), shortages: stock.shortages };
  }

  private saleOut(s: Row) {
    const o: Row = {};
    for (const k of Object.keys(s)) if (k !== "shopJson") o[k] = s[k];
    for (const k of ["taxable", "cgst", "sgst", "igst", "roundOff", "total", "seq", "itemCount"]) o[k] = Number(s[k]) || 0;
    o.invoiceNo = String(s.invoiceNo);
    return o;
  }

  private apiGetSale(p: Payload) {
    const sale = this.sales.find((s) => String(s.invoiceNo) === String(p.invoiceNo));
    if (!sale) throw new Error("Invoice " + String(p.invoiceNo) + " not found.");
    const lines = this.saleLines
      .filter((l) => String(l.invoiceNo) === String(p.invoiceNo))
      .sort((a, b) => Number(a.lineNo) - Number(b.lineNo))
      .map((l) => ({
        lineNo: Number(l.lineNo),
        name: String(l.name),
        type: l.type,
        hsn: String(l.hsn || ""),
        unit: l.unit,
        qty: Number(l.qty),
        rate: Number(l.rate),
        gstRate: Number(l.gstRate),
        gross: Number(l.gross),
        taxable: Number(l.taxable),
        cgst: Number(l.cgst),
        sgst: Number(l.sgst),
        igst: Number(l.igst),
        total: Number(l.total),
      }));
    let shop: Record<string, unknown> = {};
    try {
      shop = JSON.parse(String(sale.shopJson || "{}")) as Record<string, unknown>;
    } catch {
      shop = {};
    }
    if (!shop.shopName) {
      const cur = this.getSettings();
      shop = {
        shopName: cur.shopName,
        address: cur.address,
        city: cur.city,
        pincode: cur.pincode,
        phone: cur.phone,
        gstin: cur.gstin,
        state: cur.state,
        upiId: cur.upiId,
        invoiceFooter: cur.invoiceFooter,
        paper: cur.paper,
      };
    }
    shop.stateName = stateName(String(shop.state));
    const out = this.saleOut(sale);
    out.placeOfSupplyName = stateName(String(sale.placeOfSupply));
    out.amountInWords = amountInWords(Math.round(Number(sale.total) * 100));
    out.lines = lines;
    const byRate: Record<string, { gstRate: number; taxable: number; cgst: number; sgst: number; igst: number }> = {};
    for (const l of lines) {
      const k = String(l.gstRate);
      if (!byRate[k]) byRate[k] = { gstRate: l.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
      byRate[k].taxable = round2(byRate[k].taxable + l.taxable);
      byRate[k].cgst = round2(byRate[k].cgst + l.cgst);
      byRate[k].sgst = round2(byRate[k].sgst + l.sgst);
      byRate[k].igst = round2(byRate[k].igst + l.igst);
    }
    out.rateSummary = Object.keys(byRate)
      .map((k) => byRate[k]!)
      .sort((a, b) => a.gstRate - b.gstRate);
    out.shop = shop;
    return out;
  }

  private monthRange(month: unknown): { month: string; from: string; to: string } {
    const m = /^\d{4}-\d{2}$/.test(String(month || "")) ? String(month) : this.today().slice(0, 7);
    return { month: m, from: m + "-01", to: m + "-31" };
  }

  private inRange(d: unknown, r: { from: string; to: string }) {
    const s = String(d);
    return s >= r.from && s <= r.to;
  }

  private apiListSales(p: Payload) {
    const r = this.monthRange(p.month);
    const sales = this.sales.filter((s) => this.inRange(s.date, r));
    const q = String(p.q || "")
      .toLowerCase()
      .trim();
    const shown = sales
      .filter((s) => {
        if (!q) return true;
        return (String(s.invoiceNo) + " " + String(s.customerName) + " " + String(s.customerPhone)).toLowerCase().includes(q);
      })
      .sort((a, b) => (String(b.createdAt) < String(a.createdAt) ? -1 : 1))
      .map((s) => this.saleOut(s));
    return { month: r.month, sales: shown, summary: summariseSales(sales) };
  }

  private apiCancelSale(p: Payload) {
    const reason = String(p.reason || "").trim();
    if (!reason) throw new Error("Give a reason for cancelling.");
    const sale = this.sales.find((s) => String(s.invoiceNo) === String(p.invoiceNo));
    if (!sale) throw new Error("Invoice not found.");
    if (sale.status === "CANCELLED") {
      if (p.replay) return { invoice: this.apiGetSale({ invoiceNo: p.invoiceNo }), items: this.listItems() };
      throw new Error("This invoice is already cancelled.");
    }
    sale.status = "CANCELLED";
    sale.cancelReason = reason.slice(0, 120);
    const byId: Record<string, Row> = {};
    this.items.forEach((i) => {
      byId[String(i.id)] = i;
    });
    const back: Record<string, number> = {};
    for (const l of this.saleLines) {
      if (String(l.invoiceNo) !== String(p.invoiceNo)) continue;
      l.status = "CANCELLED";
      const item = byId[String(l.itemId)];
      if (item && isStocked(item.type)) back[String(l.itemId)] = (back[String(l.itemId)] || 0) + Number(l.qty);
    }
    for (const id of Object.keys(back)) {
      const item = byId[id];
      if (item) item.stock = round2((Number(item.stock) || 0) + (back[id] || 0));
    }
    return { invoice: this.apiGetSale({ invoiceNo: p.invoiceNo }), items: this.listItems() };
  }

  private apiDashboard() {
    const t = this.today();
    const todays = summariseSales(this.sales.filter((s) => String(s.date) === t));
    const month = summariseSales(this.sales.filter((s) => String(s.date).slice(0, 7) === t.slice(0, 7)));
    const items = this.listItems();
    const low = items
      .filter((i) => isStocked(i.type) && i.stock <= i.lowStockAt)
      .sort((a, b) => a.stock - b.stock);
    const dead = this.mortality.filter((m) => String(m.date).slice(0, 7) === t.slice(0, 7));
    let deadQty = 0;
    dead.forEach((m) => {
      deadQty += Number(m.qty) || 0;
    });
    return {
      today: todays,
      month: { count: month.count, total: month.total },
      lowStock: low.slice(0, 12),
      lowStockCount: low.length,
      deadThisMonth: deadQty,
      date: t,
    };
  }

  private apiReport(p: Payload) {
    const r = this.monthRange(p.month);
    const sales = this.sales.filter((s) => this.inRange(s.date, r));
    const lines = this.saleLines.filter((l) => this.inRange(l.date, r));
    const dead = this.mortality.filter((m) => this.inRange(m.date, r));
    const ins = this.stockIn.filter((m) => this.inRange(m.date, r));
    const items = this.listItems();
    let stockVal = 0;
    let retailVal = 0;
    let units = 0;
    items.forEach((i) => {
      if (isStocked(i.type) && i.stock > 0) {
        stockVal += i.stock * i.costPrice;
        retailVal += i.stock * i.sellPrice;
        units += i.stock;
      }
    });
    const activeLines = lines.filter((l) => l.status !== "CANCELLED");
    let cogs = 0;
    const byType: Record<string, number> = { FISH: 0, DRY: 0, SERVICE: 0 };
    activeLines.forEach((l) => {
      cogs += Number(l.qty) * Number(l.costPrice || 0);
      const type = String(l.type);
      byType[type] = round2((byType[type] || 0) + Number(l.total));
    });
    let purchases = 0;
    ins.forEach((x) => {
      purchases += Number(x.totalCost) || 0;
    });
    return {
      month: r.month,
      sales: summariseSales(sales),
      cancelled: sales.filter((s) => s.status === "CANCELLED").length,
      byType,
      hsn: hsnSummary(lines),
      approxCostOfGoods: round2(cogs),
      purchases: round2(purchases),
      mortality: mortalitySummary(dead, ins),
      stock: {
        value: round2(stockVal),
        retail: round2(retailVal),
        units: round2(units),
        items: items.filter((i) => isStocked(i.type)).length,
      },
    };
  }

  private apiExportCsv(p: Payload) {
    const x = this.buildExport(p);
    return { filename: x.name + ".csv", csv: toCsv(x.rows), count: x.rows.length - 1 };
  }

  private apiExportToSheet(p: Payload) {
    const x = this.buildExport(p);
    const s = this.getSettings();
    const name = s.shopName + " - " + x.name;
    const id = "local-" + x.name;
    const url = "https://docs.google.com/spreadsheets/d/" + id;
    const data = x.rows.map((row) => row.map((v) => (typeof v === "number" ? v : String(v == null ? "" : v))));
    this.files[id] = { name, url, sheets: [{ rows: data }] };
    return { url, name, count: data.length - 1, rows: data };
  }
}

export { ITEM_TYPES };
