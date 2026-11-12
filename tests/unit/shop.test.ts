/* Port of dev/test.js — GST maths plus the full shop flow. Run: npm test */
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "vitest";
import { ShopEngine } from "../../src/engine";
import * as L from "../../src/logic";

test("inclusive 18%: 118 -> 100 + 9 + 9", () => {
  const c = L.computeLine({ qty: 1, rate: 118, gstRate: 18 }, { gstMode: "REGULAR", priceMode: "INCLUSIVE" });
  assert.deepEqual([c.taxable, c.cgst, c.sgst, c.igst, c.total], [10000, 900, 900, 0, 11800]);
});

test("inclusive 18% odd price back-calculates and splits CGST=SGST", () => {
  const c = L.computeLine({ qty: 1, rate: 150, gstRate: 18 }, { gstMode: "REGULAR", priceMode: "INCLUSIVE" });
  assert.equal(c.taxable, 12712);
  assert.equal(c.cgst, 1144);
  assert.equal(c.sgst, 1144);
  assert.equal(c.total, 15000);
});

test("exclusive 18% adds tax on top", () => {
  const c = L.computeLine({ qty: 2, rate: 100, gstRate: 18 }, { gstMode: "REGULAR", priceMode: "EXCLUSIVE" });
  assert.deepEqual([c.taxable, c.cgst, c.sgst, c.total], [20000, 1800, 1800, 23600]);
});

test("inter-state uses IGST only", () => {
  const c = L.computeLine({ qty: 1, rate: 118, gstRate: 18 }, { gstMode: "REGULAR", priceMode: "INCLUSIVE", interState: true });
  assert.deepEqual([c.cgst, c.sgst, c.igst, c.total], [0, 0, 1800, 11800]);
});

test("live fish exempt: no tax, value = price", () => {
  const c = L.computeLine({ qty: 2, rate: 60, gstRate: 0 }, { gstMode: "REGULAR", priceMode: "INCLUSIVE" });
  assert.deepEqual([c.taxable, c.cgst, c.sgst, c.total], [12000, 0, 0, 12000]);
});

test("composition & unregistered: no tax on bill, correct heading", () => {
  const lines = [
    { qty: 1, rate: 118, gstRate: 18 },
    { qty: 1, rate: 50, gstRate: 0 },
  ];
  const comp = L.computeInvoice(lines, { gstMode: "COMPOSITION", priceMode: "INCLUSIVE" });
  assert.equal(comp.taxable, 16800);
  assert.equal(comp.cgst + comp.sgst + comp.igst, 0);
  assert.equal(comp.total, 16800);
  assert.equal(comp.docType, "Bill of Supply");
  assert.equal(L.computeInvoice(lines, { gstMode: "UNREGISTERED" }).docType, "Bill");
});

test("document type under regular GST", () => {
  assert.equal(L.documentType([{ gstRate: 18 }], "REGULAR"), "Tax Invoice");
  assert.equal(L.documentType([{ gstRate: 0 }], "REGULAR"), "Bill of Supply");
  assert.equal(L.documentType([{ gstRate: 0 }, { gstRate: 18 }], "REGULAR"), "Invoice-cum-Bill of Supply");
});

test("mixed invoice totals and round-off", () => {
  const inv = L.computeInvoice(
    [
      { qty: 2, rate: 60, gstRate: 0 },
      { qty: 1, rate: 350, gstRate: 18 },
      { qty: 1, rate: 500, gstRate: 18 },
    ],
    { gstMode: "REGULAR", priceMode: "INCLUSIVE" },
  );
  assert.equal(inv.total, 97000);
  assert.equal(inv.cgst, inv.sgst);
  assert.equal(inv.subTotal, inv.taxable + inv.cgst + inv.sgst + inv.igst);
  assert.ok(Math.abs(inv.roundOff) <= 50);
  assert.deepEqual(
    inv.rateSummary.map((r) => r.gstRate),
    [0, 18],
  );
});

test("property: random inclusive bills stay within 1 paisa per line of the price, CGST == SGST", () => {
  let seed = 42;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let n = 0; n < 3000; n++) {
    const rates = [0, 5, 12, 18, 28, 40];
    const lines = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => ({
      qty: 1 + Math.floor(rnd() * 20),
      rate: Math.round(rnd() * 500000) / 100,
      gstRate: rates[Math.floor(rnd() * rates.length)],
    }));
    const inv = L.computeInvoice(lines, { gstMode: "REGULAR", priceMode: "INCLUSIVE" });
    inv.lines.forEach((l) => {
      assert.ok(Math.abs(Number(l.total) - Number(l.gross)) <= 1, JSON.stringify(l));
      assert.equal(l.cgst, l.sgst);
      assert.ok(Number(l.taxable) <= Number(l.gross));
    });
    assert.equal(inv.total % 100, 0);
    assert.equal(inv.total - inv.subTotal, inv.roundOff);
  }
});

test("financial year labels and invoice numbers", () => {
  assert.equal(L.fyLabel("2026-03-31"), "25-26");
  assert.equal(L.fyLabel("2026-04-01"), "26-27");
  assert.equal(L.fyLabel("2026-11-12"), "26-27");
  assert.equal(L.fyLabel("2099-12-01"), "99-00");
  assert.equal(L.formatInvoiceNo("ra-1!", "26-27", 7), "RA1/26-27/0007");
  assert.equal(L.formatInvoiceNo("ABCDEFG", "26-27", 1), "ABCDE/26-27/0001");
  assert.ok(L.formatInvoiceNo("ABCDE", "26-27", 9999).length <= 16);
  assert.equal(L.nextInvoiceSeq([{ fy: "26-27", seq: 4 }, { fy: "25-26", seq: 90 }], "26-27"), 5);
  assert.equal(L.nextInvoiceSeq([{ fy: "25-26", seq: 90 }], "26-27"), 1);
});

test("GSTIN validation with checksum", () => {
  assert.equal(L.gstinProblem("27AAPFU0939F1ZV"), "");
  assert.match(L.gstinProblem("27AAPFU0939F1ZX"), /check digit/);
  assert.match(L.gstinProblem("ABC"), /15 characters/);
  assert.equal(L.gstinProblem(""), "");
  assert.equal(L.gstinProblem("36AAPFU0939F1ZW"), "");
});

test("amount in words (Indian system) and money format", () => {
  assert.equal(L.amountInWords(12345650), "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only");
  assert.equal(L.amountInWords(97000), "Rupees Nine Hundred Seventy Only");
  assert.equal(L.amountInWords(1000000000), "Rupees One Crore Only");
  assert.equal(L.formatINR(1234567.5), "12,34,567.50");
  assert.equal(L.formatINR(999), "999.00");
  assert.equal(L.formatINR(-1500), "-1,500.00");
});

test("stock decrement and shortage", () => {
  const items = [
    { id: "a", name: "Guppy", type: "FISH", stock: 5 },
    { id: "s", name: "Cleaning", type: "SERVICE", stock: 0 },
  ];
  const r = L.applySaleToStock(items, [{ itemId: "a", qty: 2 }, { itemId: "a", qty: 1 }, { itemId: "s", qty: 1 }], false);
  assert.deepEqual(r.changed, { a: 2 });
  assert.throws(() => L.applySaleToStock(items, [{ itemId: "a", qty: 6 }], false), /Not enough stock/);
  assert.deepEqual(L.applySaleToStock(items, [{ itemId: "a", qty: 6 }], true).changed, { a: -1 });
});

test("item defaults by type", () => {
  const f = L.normaliseItem({ name: "Neon tetra", type: "FISH", sellPrice: 40 });
  assert.equal(f.hsn, "0301");
  assert.equal(f.gstRate, 0);
  const s = L.normaliseItem({ name: "Tank cleaning", type: "SERVICE", sellPrice: 500 });
  assert.equal(s.hsn, "9987");
  assert.equal(s.gstRate, 18);
  assert.equal(s.lowStockAt, 0);
  const d = L.normaliseItem({ name: "Filter", type: "DRY", sellPrice: 900, gstRate: 5, hsn: "8421" });
  assert.equal(d.gstRate, 5);
  assert.equal(d.hsn, "8421");
  assert.throws(() => L.normaliseItem({ name: "", type: "DRY", sellPrice: 1 }), /name/);
  assert.throws(() => L.normaliseItem({ name: "x", type: "DRY", sellPrice: -1 }), /selling price/);
});

test("CSV escaping guards against formulas", () => {
  const csv = L.toCsv([["a,b", '=HYPERLINK("x")', "-5", 'say "hi"']]);
  assert.equal(csv, '"a,b","\'=HYPERLINK(""x"")",-5,"say ""hi"""\r\n');
});

function api(ctx: ShopEngine, action: string, payload?: Record<string, unknown>, token?: string | null): {
  ok: boolean;
  data?: any;
  error?: string;
  code?: string;
} {
  return ctx.api(action, payload || {}, token) as {
    ok: boolean;
    data?: any;
    error?: string;
    code?: string;
  };
}
function ok<T>(r: { ok: boolean; data?: T; error?: string }): T {
  assert.ok(r.ok, r.error || "request failed");
  return r.data as T;
}

test("full shop flow", () => {
  const ctx = new ShopEngine({ now: "2026-11-12T10:30:00+05:30" });
  let b = ok<{ setupDone: boolean; items: { id: string; name: string; hsn: string; stock: number; costPrice: number }[]; settings: Record<string, unknown> }>(
    api(ctx, "bootstrap"),
  );
  assert.equal(b.setupDone, false);
  assert.equal(api(ctx, "listItems").code, "SETUP");
  let r = api(ctx, "setup", { shopName: "Rohit Aquarium", state: "36", gstMode: "REGULAR", gstin: "27AAPFU0939F1ZV", invoicePrefix: "RA" });
  assert.match(r.error || "", /GSTIN starts with 27/);
  r = api(ctx, "setup", { shopName: "Rohit Aquarium", state: "27", gstMode: "REGULAR", gstin: "27AAPFU0939F1ZV", invoicePrefix: "RA", addSamples: "true" });
  assert.equal(r.ok, false);
  b = ok(api(ctx, "setup", { shopName: "Rohit Aquarium", city: "Hyderabad", state: "36", gstMode: "UNREGISTERED", invoicePrefix: "RA", addSamples: "true" }));
  assert.equal(b.setupDone, true);
  assert.equal(b.items.length, 8);
  assert.equal(api(ctx, "setup", { shopName: "X", gstMode: "UNREGISTERED" }).ok, false);

  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const base = "36AAPFU0939F1Z";
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = chars.indexOf(base[i]!) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  const tsGstin = base + chars[(36 - (sum % 36)) % 36];
  const s = ok<{ gstMode: string; gstin: string }>(api(ctx, "saveSettings", { ...b.settings, gstMode: "REGULAR", gstin: tsGstin }));
  assert.equal(s.gstMode, "REGULAR");
  assert.equal(s.gstin, tsGstin);

  const items = b.items;
  const byName = (n: string) => items.find((i) => i.name === n)!;
  const guppy = byName("Guppy (pair)");
  const pump = byName("Air pump (single)");
  const svc = byName("Tank cleaning visit");
  assert.equal(guppy.hsn, "0301");

  r = api(ctx, "createSale", { lines: [{ itemId: guppy.id, qty: 2 }] });
  assert.match(r.error || "", /Not enough stock/);

  let si = ok<{ items: { id: string; stock: number; costPrice: number }[] }>(
    api(ctx, "stockIn", { itemId: guppy.id, qty: 20, unitCost: 12, supplier: "Howrah wholesaler", city: "Kolkata", date: "2026-11-10" }),
  );
  assert.equal(si.items.find((i) => i.id === guppy.id)!.stock, 20);
  assert.equal(si.items.find((i) => i.id === guppy.id)!.costPrice, 12);
  ok(api(ctx, "stockIn", { itemId: pump.id, qty: 3, unitCost: 210 }));
  assert.match(api(ctx, "stockIn", { itemId: svc.id, qty: 3 }).ok ? "" : (api(ctx, "stockIn", { itemId: svc.id, qty: 3 }).error ?? ""), /Services/);
  assert.match((api(ctx, "stockIn", { itemId: guppy.id, qty: 0 }).error ?? ""), /more than 0/);
  assert.match((api(ctx, "stockIn", { itemId: guppy.id, qty: 1, date: "2030-01-01" }).error ?? ""), /future/);

  let sale = ok<{
    invoice: {
      invoiceNo: string;
      docType: string;
      total: number;
      cgst: number;
      sgst: number;
      igst: number;
      lines: { hsn: string }[];
      date: string;
      shop: { gstin: string };
      customerPhone: string;
      taxable: number;
      supplyType: string;
    };
    items: { id: string; stock: number }[];
  }>(
    api(ctx, "createSale", {
      lines: [
        { itemId: guppy.id, qty: 2 },
        { itemId: pump.id, qty: 1 },
        { itemId: svc.id, qty: 1 },
      ],
      payment: "UPI",
      customerName: "Anil",
      customerPhone: "98480 12345",
    }),
  );
  const inv = sale.invoice;
  assert.equal(inv.invoiceNo, "RA/26-27/0001");
  assert.equal(inv.docType, "Invoice-cum-Bill of Supply");
  assert.equal(inv.total, 970);
  assert.equal(inv.cgst, inv.sgst);
  assert.equal(inv.lines[0]!.hsn, "0301");
  assert.equal(inv.date, "2026-11-12");
  assert.equal(inv.shop.gstin, tsGstin);
  assert.equal(inv.customerPhone, "9848012345");
  assert.equal(sale.items.find((i) => i.id === guppy.id)!.stock, 18);
  assert.equal(sale.items.find((i) => i.id === pump.id)!.stock, 2);
  assert.equal(Math.round(inv.taxable * 100), 12000 + 29661 + 42373);

  sale = ok(api(ctx, "createSale", { lines: [{ itemId: pump.id, qty: 1 }], placeOfSupply: "37", payment: "Cash" }));
  assert.equal(sale.invoice.invoiceNo, "RA/26-27/0002");
  assert.equal(sale.invoice.cgst, 0);
  assert.ok(sale.invoice.igst > 0);
  assert.equal(sale.invoice.docType, "Tax Invoice");
  assert.equal(sale.invoice.supplyType, "Inter-state");

  const c = ok<{ invoice: { status: string }; items: { id: string; stock: number }[] }>(
    api(ctx, "cancelSale", { invoiceNo: "RA/26-27/0002", reason: "Wrong item" }),
  );
  assert.equal(c.invoice.status, "CANCELLED");
  assert.equal(c.items.find((i) => i.id === pump.id)!.stock, 2);
  assert.match((api(ctx, "cancelSale", { invoiceNo: "RA/26-27/0002", reason: "x" }).error ?? ""), /already/);
  sale = ok(api(ctx, "createSale", { lines: [{ itemId: guppy.id, qty: 1 }] }));
  assert.equal(sale.invoice.invoiceNo, "RA/26-27/0003");
  assert.equal(sale.invoice.docType, "Bill of Supply");

  assert.match((api(ctx, "mortality", { itemId: guppy.id, qty: 50, reason: "Disease" }).error ?? ""), /Only 17/);
  const m = ok<{ items: { id: string; stock: number }[]; movements: { mortality: { lossValue: number }[] } }>(
    api(ctx, "mortality", { itemId: guppy.id, qty: 3, reason: "Transport stress", date: "2026-11-11" }),
  );
  assert.equal(m.items.find((i) => i.id === guppy.id)!.stock, 14);
  assert.equal(m.movements.mortality[0]!.lossValue, 36);

  const ls = ok<{ sales: unknown[]; summary: { count: number; total: number; byPayment: Record<string, number> } }>(
    api(ctx, "listSales", { month: "2026-11" }),
  );
  assert.equal(ls.sales.length, 3);
  assert.equal(ls.summary.count, 2);
  assert.equal(ls.summary.total, 970 + 60);
  assert.equal(ls.summary.byPayment.UPI, 970);
  const rep = ok<{
    cancelled: number;
    mortality: { totalDead: number; rows: { received: number; ratePct: number }[] };
    stock: { units: number };
    hsn: { hsn: string; qty: number; taxable: number }[];
  }>(api(ctx, "report", { month: "2026-11" }));
  assert.equal(rep.cancelled, 1);
  assert.equal(rep.mortality.totalDead, 3);
  assert.equal(rep.mortality.rows[0]!.received, 20);
  assert.equal(rep.mortality.rows[0]!.ratePct, 15);
  assert.equal(rep.stock.units, 14 + 2);
  const hsn0301 = rep.hsn.find((h) => h.hsn === "0301");
  assert.equal(hsn0301!.qty, 3);
  assert.equal(hsn0301!.taxable, 180);
  const dash = ok<{ today: { count: number }; deadThisMonth: number }>(api(ctx, "dashboard"));
  assert.equal(dash.today.count, 2);
  assert.equal(dash.deadThisMonth, 3);

  const csv = ok<{ count: number; csv: string }>(api(ctx, "exportCsv", { kind: "sales", month: "2026-11" }));
  assert.equal(csv.count, 5);
  assert.match(csv.csv, /RA\/26-27\/0001/);
  assert.match(csv.csv, /,0301,/);
  const hcsv = ok<{ csv: string }>(api(ctx, "exportCsv", { kind: "hsn", month: "2026-11" }));
  assert.match(hcsv.csv, /^HSN\/SAC/);
  const st = ok<{ url: string }>(api(ctx, "exportToSheet", { kind: "stock" }));
  assert.match(st.url, /^https:\/\/docs.google.com/);
  const sheetFile = Object.values(ctx.files).find((f) => f.name.indexOf("stock-on-hand") >= 0);
  assert.ok(sheetFile && sheetFile.sheets[0]!.rows.length >= 9);

  assert.match((api(ctx, "saveItem", { name: "molly", type: "FISH", sellPrice: 10 }).error ?? ""), /already exists/);
  const ni = ok<{ item: { id: string; stock: number; sellPrice: number } }>(
    api(ctx, "saveItem", { name: "Neon tetra", type: "FISH", sellPrice: 40, costPrice: 9, openingStock: 30 }),
  );
  assert.equal(ni.item.stock, 30);
  const ed = ok<{ item: { sellPrice: number; stock: number } }>(api(ctx, "saveItem", { ...ni.item, sellPrice: 45 }));
  assert.equal(ed.item.sellPrice, 45);
  assert.equal(ed.item.stock, 30);
  const ar = ok<{ items: { id: string }[] }>(api(ctx, "saveItem", { id: ni.item.id, archive: true }));
  assert.ok(!ar.items.some((i) => i.id === ni.item.id));

  const again = ok<{ total: number; lines: unknown[]; amountInWords: string }>(api(ctx, "getSale", { invoiceNo: "RA/26-27/0001" }));
  assert.equal(again.total, 970);
  assert.equal(again.lines.length, 3);
  assert.match(again.amountInWords, /Nine Hundred Seventy/);

  assert.equal(typeof ctx.table("Sales")[0]!.date, "string");
});

test("PIN lock", () => {
  const ctx = new ShopEngine({ now: "2026-11-12T10:30:00+05:30" });
  ok(api(ctx, "setup", { shopName: "Shop", state: "37", gstMode: "UNREGISTERED", pin: "4321" }));
  assert.equal(api(ctx, "listItems").code, "LOCKED");
  const b = ok<{ locked: boolean; items?: unknown }>(api(ctx, "bootstrap"));
  assert.equal(b.locked, true);
  assert.equal(b.items, undefined);
  assert.match((api(ctx, "unlock", { pin: "1111" }).error ?? ""), /Wrong PIN/);
  const t = ok<{ token: string }>(api(ctx, "unlock", { pin: "4321" })).token;
  assert.ok(t);
  assert.ok(api(ctx, "listItems", {}, t).ok);
  assert.match((api(ctx, "setPin", { pin: "12" }, t).error ?? ""), /4 to 8/);
  ok(api(ctx, "setPin", { remove: true }, t));
  assert.ok(api(ctx, "listItems").ok);
  ok(api(ctx, "setPin", { pin: "9999" }, t));
  for (let i = 0; i < 10; i++) api(ctx, "unlock", { pin: "0000" });
  assert.match((api(ctx, "unlock", { pin: "9999" }).error ?? ""), /Too many/);
});

test("invoice numbers restart on 1 April; composition heading", () => {
  const ctx = new ShopEngine({ now: "2027-03-31T20:00:00+05:30" });
  ok(api(ctx, "setup", { shopName: "Shop", state: "36", gstMode: "UNREGISTERED", invoicePrefix: "AQ" }));
  const it = ok<{ item: { id: string } }>(api(ctx, "saveItem", { name: "Tank cleaning", type: "SERVICE", sellPrice: 500 })).item;
  assert.equal(ok<{ invoice: { invoiceNo: string } }>(api(ctx, "createSale", { lines: [{ itemId: it.id, qty: 1 }] })).invoice.invoiceNo, "AQ/26-27/0001");
  ctx.clock = "2027-04-01T09:00:00+05:30";
  const inv = ok<{ invoice: { invoiceNo: string; docType: string; cgst: number } }>(
    api(ctx, "createSale", { lines: [{ itemId: it.id, qty: 1 }] }),
  ).invoice;
  assert.equal(inv.invoiceNo, "AQ/27-28/0001");
  assert.equal(inv.docType, "Bill");
  assert.equal(inv.cgst, 0);
  ctx.clock = "2027-03-31T19:00:00Z";
  assert.equal(ok<{ today: string }>(api(ctx, "bootstrap")).today, "2027-04-01");
});

test("saved bills use the same maths as computeInvoice, and the page is phone-width", () => {
  const html = fs.readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  assert.ok(html.includes("width=device-width"));
  const ctx = new ShopEngine({ now: "2026-11-12T10:00:00+05:30" });
  ok(api(ctx, "setup", { shopName: "Shop", state: "36", gstMode: "REGULAR", gstin: "36AAPFU0939F1ZW", invoicePrefix: "RA" }));
  const fish = ok<{ item: { id: string } }>(api(ctx, "saveItem", { name: "Guppy", type: "FISH", sellPrice: 60, openingStock: 5 })).item;
  const pump = ok<{ item: { id: string } }>(
    api(ctx, "saveItem", { name: "Pump", type: "DRY", sellPrice: 149.5, gstRate: 18, openingStock: 5 }),
  ).item;
  const lines = [
    { qty: 2, rate: 60, gstRate: 0 },
    { qty: 3, rate: 149.5, gstRate: 18 },
  ];
  const calc = L.computeInvoice(lines, { gstMode: "REGULAR", priceMode: "INCLUSIVE" });
  const sale = ok<{ invoice: { taxable: number; total: number; docType: string; cgst: number; sgst: number } }>(
    api(ctx, "createSale", { lines: [{ itemId: fish.id, qty: 2 }, { itemId: pump.id, qty: 3 }] }),
  );
  assert.equal(Math.round(sale.invoice.taxable * 100), calc.taxable);
  assert.equal(Math.round(sale.invoice.total * 100), calc.total);
  assert.equal(sale.invoice.docType, calc.docType);
  assert.equal(sale.invoice.cgst, sale.invoice.sgst);
});
