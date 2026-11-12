import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  COMPOSITION_STATEMENT,
  GST_MODES,
  ITEM_TYPES,
  MORTALITY_REASONS,
  SHOP_STATES,
  STATES,
  computeInvoice,
  formatINR,
  isStocked,
  round2,
  type ItemType,
} from "./logic";
import { inr, monthLabel, qty, todayLabel } from "./money";
import type { ItemRow, SettingsRow } from "./shop";
import { useShop } from "./shop";
import { Disclaimer, ErrorBox, Field, downloadCsv, go } from "./ui";

const emptyShop = {
  shopName: "",
  address: "",
  city: "Hyderabad",
  pincode: "",
  phone: "",
  email: "",
  state: "36",
  gstMode: "UNREGISTERED",
  gstin: "",
  priceMode: "INCLUSIVE",
  invoicePrefix: "RA",
  upiId: "",
  invoiceFooter: "Thank you! Live fish once sold cannot be returned.",
  paper: "A4",
  allowNegativeStock: false,
  addSamples: true,
  pin: "",
};

export function Welcome() {
  const shop = useShop();
  const base = import.meta.env.BASE_URL;
  return (
    <div className="center-wrap">
      <div className="panel panel-pad welcome">
        <div className="brand-mark" style={{ width: 64, height: 64, borderRadius: 18, display: "grid", placeItems: "center", background: "var(--brand)", color: "#fff" }}>
          <svg className="ic lg" viewBox="0 0 24 24" aria-hidden="true" style={{ width: 32, height: 32 }}>
            <path fill="currentColor" d="M2.5 12c2.2-4.2 6.2-6.5 10.4-6.5 1.6 0 3.1.4 4.3 1.1L21.5 4l-1.2 4.2c.5.9.8 1.9.8 2.8s-.3 1.9-.8 2.8L21.5 20l-4.3-2.6c-1.2.7-2.7 1.1-4.3 1.1-4.2 0-8.2-2.3-10.4-6.5Z" />
          </svg>
        </div>
        <h1>Aquarium Shop</h1>
        <p className="muted">Bills, stock and a GST helper for a small ornamental fish shop in Telangana or Andhra Pradesh. Sign in with the Google account that should own the books. The sheet is created in that account's Drive.</p>
        {shop.configured ? (
          <button className="btn btn-primary btn-lg" type="button" onClick={() => void shop.signIn()}>
            Sign in with Google
          </button>
        ) : (
          <div className="note">
            <span>Google sign-in is not set up yet. Put the OAuth client ID on the one line GOOGLE_CLIENT_ID in src/config.ts, then reload. You can still try the demo.</span>
          </div>
        )}
        <a className="btn" href={`${base}?demo=1#/setup`}>Try a demo on this device</a>
        <a className="btn btn-ghost" href="#/setup">Shop details</a>
        {shop.notice ? <ErrorBox>{shop.notice}</ErrorBox> : null}
        <p className="small muted">Nothing is sent to a server we run. Demo mode stays on this phone. This is not certified GST software.</p>
      </div>
    </div>
  );
}

export function Lock() {
  const shop = useShop();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await shop.run("unlock", { pin });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wrong PIN.");
    }
  }
  return (
    <div className="center-wrap">
      <form className="panel panel-pad auth form" onSubmit={(event) => void submit(event)}>
        <h1>{shop.boot?.shopName || "Aquarium Shop"}</h1>
        <p className="muted">Enter the shop PIN to continue.</p>
        <Field label="Shop PIN">
          <input className="input pin-input" value={pin} onChange={(event) => setPin(event.target.value)} inputMode="numeric" type="password" autoComplete="off" autoFocus />
        </Field>
        {error ? <ErrorBox>{error}</ErrorBox> : null}
        <button className="btn btn-primary btn-lg" type="submit">Unlock</button>
        <button className="btn btn-ghost" type="button" onClick={() => void shop.forgotPin().catch((err) => setError(err instanceof Error ? err.message : "Could not reset the PIN."))}>
          I forgot the PIN
        </button>
        <p className="small muted">Forgot it? Sign in again with the Google account that owns this shop, or clear the demo PIN on this device.</p>
      </form>
    </div>
  );
}

export function Setup({ editing = false }: { editing?: boolean }) {
  const shop = useShop();
  const current = shop.boot?.settings;
  const [step, setStep] = useState(editing ? 2 : 1);
  const [error, setError] = useState("");
  const [form, setForm] = useState(() => ({
    ...emptyShop,
    ...(current
      ? {
          shopName: current.shopName,
          address: current.address,
          city: current.city,
          pincode: current.pincode,
          phone: current.phone,
          email: current.email,
          state: current.state,
          gstMode: current.gstMode,
          gstin: current.gstin,
          priceMode: current.priceMode,
          invoicePrefix: current.invoicePrefix,
          upiId: current.upiId,
          invoiceFooter: current.invoiceFooter,
          paper: current.paper,
          allowNegativeStock: current.allowNegativeStock === "true",
          addSamples: false,
        }
      : {}),
  }));

  function patch(partial: Partial<typeof form>) {
    setForm((prev) => ({ ...prev, ...partial }));
  }

  async function finish(event: FormEvent) {
    event.preventDefault();
    setError("");
    const payload = {
      ...form,
      addSamples: form.addSamples ? "true" : "false",
      allowNegativeStock: form.allowNegativeStock ? "true" : "false",
    };
    try {
      if (editing) await shop.run("saveSettings", payload);
      else await shop.run("setup", payload);
      go(editing ? "settings" : "home");
      shop.ping(editing ? "Shop details saved." : "Shop is ready.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    }
  }

  return (
    <div className={editing ? "" : "center-wrap"}>
      <div className={editing ? "panel panel-pad form" : "panel panel-pad wizard"}>
        <h1>{editing ? "Shop details" : step === 1 ? "Set up your shop" : "GST and billing"}</h1>
        <p className="muted" style={{ marginTop: 6 }}>
          {editing ? "These details print on every bill." : "These details print on every bill. You can change them later in Settings."}
        </p>
        {!editing ? (
          <div className="steps" aria-label={step === 1 ? "Step 1 of 2" : "Step 2 of 2"}>
            <span className="on" />
            <span className={step === 2 ? "on" : ""} />
          </div>
        ) : null}
        {error ? <ErrorBox>{error}</ErrorBox> : null}
        {step === 1 && !editing ? (
          <form className="form" onSubmit={(event) => { event.preventDefault(); setStep(2); }}>
            <ShopIdentity form={form} patch={patch} />
            <button className="btn btn-primary btn-lg" type="submit">Next</button>
          </form>
        ) : (
          <form className="form" onSubmit={(event) => void finish(event)}>
            {editing ? <ShopIdentity form={form} patch={patch} /> : null}
            <GstFields form={form} patch={patch} />
            {editing ? (
              <>
                <div className="form-grid two">
                  <Field label="Bill paper">
                    <select className="input" value={form.paper} onChange={(event) => patch({ paper: event.target.value })}>
                      <option value="A4">A4 / normal printer</option>
                      <option value="80MM">80 mm receipt printer</option>
                    </select>
                  </Field>
                  <Field label="Bill footer" hint='For example "Thank you".'>
                    <input className="input" value={form.invoiceFooter} maxLength={240} onChange={(event) => patch({ invoiceFooter: event.target.value })} />
                  </Field>
                </div>
                <label className="check">
                  <input type="checkbox" checked={form.allowNegativeStock} onChange={(event) => patch({ allowNegativeStock: event.target.checked })} />
                  <span>Allow sale when stock is short (stock can go below zero; fix it later with Stock in)</span>
                </label>
              </>
            ) : (
              <>
                <label className="check">
                  <input type="checkbox" checked={form.addSamples} onChange={(event) => patch({ addSamples: event.target.checked })} />
                  <span>Add 8 sample items (guppy, goldfish, fish food, tank, cleaning service) so you can try a bill. Prices are examples.</span>
                </label>
                <Field label="Shop PIN (optional)" hint="4 to 8 digits if a cashier will open this app. Leave blank to skip.">
                  <input className="input" value={form.pin} onChange={(event) => patch({ pin: event.target.value })} inputMode="numeric" type="password" autoComplete="new-password" maxLength={8} />
                </Field>
              </>
            )}
            <Disclaimer />
            <div className="btn-row">
              {!editing ? (
                <button className="btn" type="button" onClick={() => setStep(1)}>Back</button>
              ) : null}
              <button className="btn btn-primary btn-lg" type="submit" style={{ flex: 1 }}>
                {editing ? "Save shop details" : "Finish setup"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function ShopIdentity({ form, patch }: { form: typeof emptyShop; patch: (partial: Partial<typeof emptyShop>) => void }) {
  return (
    <>
      <Field label="Shop name">
        <input className="input" required maxLength={60} value={form.shopName} autoComplete="organization" onChange={(event) => patch({ shopName: event.target.value })} />
      </Field>
      <Field label="Address">
        <textarea className="input" maxLength={160} rows={2} value={form.address} placeholder="Shop no, street, area" onChange={(event) => patch({ address: event.target.value })} />
      </Field>
      <div className="form-grid two">
        <Field label="City">
          <input className="input" maxLength={40} value={form.city} onChange={(event) => patch({ city: event.target.value })} />
        </Field>
        <Field label="PIN code">
          <input className="input" inputMode="numeric" maxLength={6} value={form.pincode} onChange={(event) => patch({ pincode: event.target.value })} />
        </Field>
      </div>
      <div className="form-grid two">
        <Field label="Shop phone">
          <input className="input" type="tel" maxLength={20} value={form.phone} onChange={(event) => patch({ phone: event.target.value })} />
        </Field>
        <Field label="State">
          <select className="input" value={form.state} onChange={(event) => patch({ state: event.target.value })}>
            {SHOP_STATES.map(([code, name]) => (
              <option key={code} value={code}>{name} ({code})</option>
            ))}
          </select>
        </Field>
      </div>
    </>
  );
}

function GstFields({ form, patch }: { form: typeof emptyShop; patch: (partial: Partial<typeof emptyShop>) => void }) {
  return (
    <>
      <Field label="GST registration" hint='Regular: bills show GST. Composition: a Bill of Supply with no GST. Not registered: a plain bill.'>
        <select className="input" value={form.gstMode} onChange={(event) => patch({ gstMode: event.target.value })}>
          {Object.entries(GST_MODES).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </Field>
      {form.gstMode === "UNREGISTERED" ? null : (
        <Field label="GSTIN" hint="Telangana GSTINs start with 36, Andhra Pradesh with 37.">
          <input className="input" maxLength={15} value={form.gstin} placeholder="36ABCDE1234F1Z5" style={{ textTransform: "uppercase" }} onChange={(event) => patch({ gstin: event.target.value.toUpperCase() })} />
        </Field>
      )}
      <div className="form-grid two">
        <Field label="Selling prices">
          <select className="input" value={form.priceMode} onChange={(event) => patch({ priceMode: event.target.value })}>
            <option value="INCLUSIVE">Include GST (usual for shops)</option>
            <option value="EXCLUSIVE">GST added on top</option>
          </select>
        </Field>
        <Field label="Bill number prefix" hint="Up to 5 letters. Bills look like RA/26-27/0001.">
          <input className="input" maxLength={5} value={form.invoicePrefix} style={{ textTransform: "uppercase" }} onChange={(event) => patch({ invoicePrefix: event.target.value.toUpperCase() })} />
        </Field>
      </div>
      <Field label="UPI ID (optional)" hint="Printed on the bill so customers can pay.">
        <input className="input" maxLength={60} value={form.upiId} placeholder="shopname@okaxis" autoCapitalize="off" onChange={(event) => patch({ upiId: event.target.value })} />
      </Field>
    </>
  );
}

export function Home() {
  const shop = useShop();
  const dash = shop.boot?.dashboard;
  const today = dash?.today;
  const pay = today?.byPayment || {};
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Today</h1>
          <p>{todayLabel(shop.boot?.today || "")}</p>
        </div>
      </div>
      <div className="grid-2">
        <section className="panel today" aria-label="Today's sales">
          <div>
            <div className="muted small" style={{ fontWeight: 600 }}>Sales today</div>
            <div className="today-total">{inr(today?.total || 0)}</div>
          </div>
          <div className="today-row">
            <span><b>{today?.count || 0}</b> {today?.count === 1 ? "bill" : "bills"}</span>
            {(["Cash", "UPI", "Card"] as const).filter((key) => pay[key]).map((key) => (
              <span key={key}>{key} <b>{inr(pay[key])}</b></span>
            ))}
            <span>This month <b>{inr(dash?.month.total || 0)}</b></span>
          </div>
        </section>
        <section className="panel panel-pad quick" aria-label="Quick actions">
          <button className="btn btn-primary btn-lg" type="button" onClick={() => go("sale")}>New sale</button>
          <button className="btn" type="button" onClick={() => go("stock")}>Stock in</button>
          <button className="btn" type="button" onClick={() => go("dead")}>Dead stock</button>
        </section>
      </div>
      {!shop.boot?.items?.length ? (
        <section className="section panel">
          <div className="empty">
            <h2>Add your first items</h2>
            <p>Add the fish, tanks, food and services you sell. Then you can make bills.</p>
            <button className="btn btn-primary" type="button" onClick={() => go("items")}>Add item</button>
          </div>
        </section>
      ) : null}
      <section className="section">
        <div className="page-head" style={{ margin: "0 0 10px" }}>
          <h2>Running low {dash?.lowStockCount ? <span className="badge b-low">{dash.lowStockCount}</span> : null}</h2>
          {dash?.deadThisMonth ? <button className="btn btn-ghost" type="button" onClick={() => go("reports")}>{qty(dash.deadThisMonth)} dead this month</button> : null}
        </div>
        {!dash?.lowStock.length ? (
          <div className="panel"><div className="empty"><p>Nothing is running low.</p></div></div>
        ) : (
          <div className="panel">
            <ul className="list">
              {dash.lowStock.map((item) => (
                <li key={item.id}>
                  <button className="row" type="button" onClick={() => go("stock")}>
                    <div className="row-main">
                      <div className="row-title">{item.name}</div>
                      <div className="row-sub"><TypeBadge type={item.type} /><StockBadge item={item} /></div>
                    </div>
                    <span className="btn btn-ghost">Stock in</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </>
  );
}

function TypeBadge({ type }: { type: string }) {
  if (type === "FISH") return <span className="badge b-fish">Live fish</span>;
  if (type === "SERVICE") return <span className="badge b-service">Service</span>;
  return <span className="badge b-dry">Dry goods</span>;
}

function StockBadge({ item }: { item: ItemRow }) {
  if (!isStocked(item.type)) return null;
  if (item.stock <= 0) return <span className="badge b-out">Out of stock</span>;
  if (item.stock <= item.lowStockAt) return <span className="badge b-low">Low · {qty(item.stock)}</span>;
  return <span className="badge b-ok">{qty(item.stock)} in stock</span>;
}

export function Items({ initialTab = "items" }: { initialTab?: "items" | "stock" | "dead" }) {
  const shop = useShop();
  const items = shop.boot?.items || [];
  const [tab, setTab] = useState(initialTab);
  const [filter, setFilter] = useState("ALL");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<ItemRow | null | "new">(null);
  const [error, setError] = useState("");
  const shown = items.filter((item) => (filter === "ALL" || item.type === filter) && (!q || item.name.toLowerCase().includes(q.toLowerCase()) || item.hsn.startsWith(q)));

  useEffect(() => setTab(initialTab), [initialTab]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{tab === "items" ? "Items" : tab === "stock" ? "Stock in" : "Dead stock"}</h1>
          <p>{tab === "items" ? "Live fish, dry goods and services." : tab === "stock" ? "When fish or goods arrive." : "Fish that died, or goods that broke."}</p>
        </div>
        {tab === "items" ? <button className="btn btn-primary" type="button" onClick={() => setEditing("new")}>Add item</button> : null}
      </div>
      <div className="seg" role="group" aria-label="Stock section" style={{ marginBottom: 16 }}>
        {([["items", "Items"], ["stock", "Stock in"], ["dead", "Dead stock"]] as const).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => { setTab(id); go(id === "items" ? "items" : id === "stock" ? "stock" : "dead"); }}>{label}</button>
        ))}
      </div>
      {error ? <ErrorBox>{error}</ErrorBox> : null}
      {tab === "items" ? (
        <>
          <div className="pick-tools">
            <div className="search">
              <input className="input" type="search" placeholder="Search name or HSN" aria-label="Search items" value={q} onChange={(event) => setQ(event.target.value)} />
            </div>
            <div className="chips" role="group" aria-label="Filter by type">
              {[["ALL", "All"], ["FISH", "Live fish"], ["DRY", "Dry goods"], ["SERVICE", "Services"]].map(([id, label]) => (
                <button key={id} className="chip" type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="panel">
            {!shown.length ? <div className="empty"><p>No items yet.</p></div> : (
              <ul className="list">
                {shown.map((item) => (
                  <li key={item.id}>
                    <button className="row" type="button" onClick={() => setEditing(item)}>
                      <div className="row-main">
                        <div className="row-title">{item.name}</div>
                        <div className="row-sub"><TypeBadge type={item.type} /><span>{item.hsn || "No HSN"} · GST {item.gstRate}%</span><StockBadge item={item} /></div>
                      </div>
                      <div className="row-end"><div className="row-amt">{inr(item.sellPrice)}</div></div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
      {tab === "stock" ? <MovementForm kind="stock" items={items} onError={setError} /> : null}
      {tab === "dead" ? <MovementForm kind="dead" items={items} onError={setError} /> : null}
      {editing ? <ItemDialog item={editing === "new" ? null : editing} onClose={() => setEditing(null)} onError={setError} /> : null}
    </>
  );
}

function ItemDialog({ item, onClose, onError }: { item: ItemRow | null; onClose: () => void; onError: (msg: string) => void }) {
  const shop = useShop();
  const [type, setType] = useState<ItemType>((item?.type as ItemType) || "DRY");
  const def = ITEM_TYPES[type];
  const [name, setName] = useState(item?.name || "");
  const [hsn, setHsn] = useState(item?.hsn ?? def.hsn);
  const [gstRate, setGstRate] = useState(String(item?.gstRate ?? def.gstRate));
  const [sell, setSell] = useState(item ? String(item.sellPrice) : "");
  const [cost, setCost] = useState(item ? String(item.costPrice) : "");
  const [low, setLow] = useState(item ? String(item.lowStockAt) : def.stocked ? "5" : "0");
  const [opening, setOpening] = useState("");
  const [notes, setNotes] = useState(item?.notes || "");
  const [error, setError] = useState("");

  function choose(next: ItemType) {
    setType(next);
    if (!item) {
      setHsn(ITEM_TYPES[next].hsn);
      setGstRate(String(ITEM_TYPES[next].gstRate));
      setLow(ITEM_TYPES[next].stocked ? "5" : "0");
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      await shop.run("saveItem", {
        id: item?.id,
        name,
        type,
        hsn,
        gstRate,
        sellPrice: sell,
        costPrice: cost,
        lowStockAt: low,
        openingStock: item ? undefined : opening,
        notes,
        unit: item?.unit || ITEM_TYPES[type].unit,
      });
      shop.ping(item ? "Item updated." : "Item added.");
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save the item.";
      setError(message);
      onError(message);
    }
  }

  return (
    <div className="sheet-overlay" role="presentation" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={item ? "Edit item" : "Add item"} onClick={(event) => event.stopPropagation()}>
        <div className="sheet-head"><h2>{item ? "Edit item" : "Add item"}</h2><button className="icon-btn" type="button" aria-label="Close" onClick={onClose}>×</button></div>
        <form className="sheet-body form" onSubmit={(event) => void save(event)}>
          {error ? <ErrorBox>{error}</ErrorBox> : null}
          <Field label="Item name">
            <input className="input" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <div className="seg" role="group" aria-label="Item type">
            {(Object.keys(ITEM_TYPES) as ItemType[]).map((key) => (
              <button key={key} type="button" aria-pressed={type === key} onClick={() => choose(key)}>{ITEM_TYPES[key].label}</button>
            ))}
          </div>
          <div className="form-grid two">
            <Field label="Selling price">
              <input className="input" required inputMode="decimal" value={sell} onChange={(event) => setSell(event.target.value)} />
            </Field>
            <Field label="Cost price">
              <input className="input" inputMode="decimal" value={cost} onChange={(event) => setCost(event.target.value)} />
            </Field>
          </div>
          <div className="form-grid two">
            <Field label="HSN / SAC" hint="Fish 0301, services 9987. Change it if the supplier bill says otherwise.">
              <input className="input" value={hsn} inputMode="numeric" maxLength={8} onChange={(event) => setHsn(event.target.value)} />
            </Field>
            <Field label="GST %">
              <input className="input" inputMode="decimal" value={gstRate} onChange={(event) => setGstRate(event.target.value)} />
            </Field>
          </div>
          {isStocked(type) ? (
            <div className="form-grid two">
              {item ? null : (
                <Field label="Opening stock">
                  <input className="input" inputMode="decimal" value={opening} onChange={(event) => setOpening(event.target.value)} />
                </Field>
              )}
              <Field label="Low-stock warning at">
                <input className="input" inputMode="numeric" value={low} onChange={(event) => setLow(event.target.value)} />
              </Field>
            </div>
          ) : null}
          <Field label="Notes">
            <input className="input" maxLength={200} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
          <div className="btn-row">
            <button className="btn btn-primary btn-lg" type="submit" style={{ flex: 1 }}>Save item</button>
            {item ? (
              <button className="btn btn-danger" type="button" onClick={() => void shop.run("saveItem", { id: item.id, archive: true }).then(() => { shop.ping("Item removed from the list. Old bills keep it."); onClose(); }).catch((err) => setError(err instanceof Error ? err.message : "Could not remove."))}>
                Remove
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}

function MovementForm({ kind, items, onError }: { kind: "stock" | "dead"; items: ItemRow[]; onError: (msg: string) => void }) {
  const shop = useShop();
  const stocked = items.filter((item) => isStocked(item.type));
  const [itemId, setItemId] = useState(stocked[0]?.id || "");
  const [quantity, setQuantity] = useState("");
  const [cost, setCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [city, setCity] = useState("");
  const [billNo, setBillNo] = useState("");
  const [reason, setReason] = useState(MORTALITY_REASONS[0] || "Unknown");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const picked = stocked.find((item) => item.id === itemId);

  useEffect(() => {
    if (!itemId && stocked[0]) setItemId(stocked[0].id);
    if (picked && kind === "stock" && cost === "") setCost(String(picked.costPrice || ""));
  }, [itemId, stocked, picked, kind, cost]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (kind === "stock") {
        await shop.run("stockIn", { itemId, qty: quantity, unitCost: cost, supplier, city, billNo, note });
        shop.ping("Stock added.");
      } else {
        await shop.run("mortality", { itemId, qty: quantity, reason, note });
        shop.ping("Dead stock recorded.");
      }
      setQuantity("");
      setNote("");
      setBillNo("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save.";
      setError(message);
      onError(message);
    }
  }

  if (!stocked.length) return <div className="panel"><div className="empty"><p>Add a live fish or dry-goods item first. Services have no stock.</p></div></div>;

  return (
    <form className="panel panel-pad form" onSubmit={(event) => void save(event)}>
      {error ? <ErrorBox>{error}</ErrorBox> : null}
      <Field label="Item">
        <select className="input" value={itemId} onChange={(event) => { setItemId(event.target.value); setCost(""); }}>
          {stocked.map((item) => <option key={item.id} value={item.id}>{item.name} ({qty(item.stock)} in stock)</option>)}
        </select>
      </Field>
      <div className="form-grid two">
        <Field label="Quantity">
          <input className="input" required inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </Field>
        {kind === "stock" ? (
          <Field label="Cost per piece">
            <input className="input" inputMode="decimal" value={cost} onChange={(event) => setCost(event.target.value)} />
          </Field>
        ) : (
          <Field label="Reason">
            <select className="input" value={reason} onChange={(event) => setReason(event.target.value)}>
              {MORTALITY_REASONS.map((entry) => <option key={entry}>{entry}</option>)}
            </select>
          </Field>
        )}
      </div>
      {kind === "stock" ? (
        <div className="form-grid two">
          <Field label="Supplier">
            <input className="input" value={supplier} onChange={(event) => setSupplier(event.target.value)} />
          </Field>
          <Field label="Supplier city">
            <input className="input" value={city} onChange={(event) => setCity(event.target.value)} />
          </Field>
          <Field label="Supplier bill no.">
            <input className="input" value={billNo} onChange={(event) => setBillNo(event.target.value)} />
          </Field>
        </div>
      ) : null}
      <Field label="Note">
        <input className="input" value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <button className="btn btn-primary btn-lg" type="submit">{kind === "stock" ? "Save stock in" : "Save dead stock"}</button>
    </form>
  );
}

interface CartLine {
  itemId: string;
  name: string;
  type: string;
  qty: number;
  rate: number;
  gstRate: number;
}

export function Sale() {
  const shop = useShop();
  const settings = shop.boot?.settings;
  const items = shop.boot?.items || [];
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [open, setOpen] = useState(false);
  const [payment, setPayment] = useState("Cash");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerGstin, setCustomerGstin] = useState("");
  const [place, setPlace] = useState(settings?.state || "36");
  const [error, setError] = useState("");

  const shown = items.filter((item) => (filter === "ALL" || item.type === filter) && (!q || item.name.toLowerCase().includes(q.toLowerCase())));
  const inter = !!settings && settings.gstMode === "REGULAR" && place !== settings.state;
  const calc = useMemo(
    () => computeInvoice(cart.map((line) => ({ ...line })), { gstMode: settings?.gstMode, priceMode: settings?.priceMode, interState: inter }),
    [cart, settings?.gstMode, settings?.priceMode, inter],
  );

  function add(item: ItemRow) {
    setCart((prev) => {
      const found = prev.find((line) => line.itemId === item.id);
      if (found) return prev.map((line) => (line.itemId === item.id ? { ...line, qty: round2(line.qty + 1) } : line));
      return [...prev, { itemId: item.id, name: item.name, type: item.type, qty: 1, rate: item.sellPrice, gstRate: item.gstRate }];
    });
  }

  async function save() {
    setError("");
    try {
      const data = (await shop.run("createSale", {
        lines: cart.map((line) => ({ itemId: line.itemId, qty: line.qty, rate: line.rate })),
        payment,
        customerName,
        customerPhone,
        customerGstin,
        placeOfSupply: place,
      })) as { invoice: { invoiceNo: string } };
      setCart([]);
      setOpen(false);
      sessionStorage.setItem("aquarium-just-saved", data.invoice.invoiceNo);
      go("bill/" + encodeURIComponent(data.invoice.invoiceNo));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the bill.");
    }
  }

  const bill = (
    <section className="panel bill" aria-label="Bill">
      <div className="panel-pad" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <h2>Bill</h2>
        <span className="badge b-service">{calc.docType || "Bill"}</span>
      </div>
      {!cart.length ? <div className="empty"><p>Tap items to add them.</p></div> : (
        <div className="bill-lines">
          {cart.map((line) => (
            <div className="line" key={line.itemId}>
              <div className="line-top">
                <div className="line-name">{line.name} <span className="muted small">{settings?.gstMode === "REGULAR" ? (line.gstRate > 0 ? `GST ${line.gstRate}%` : "GST exempt") : ""}</span></div>
                <div className="row-amt">{inr(line.rate * line.qty)}</div>
              </div>
              <div className="line-ctrl">
                <div className="stepper">
                  <button type="button" aria-label={`One less ${line.name}`} onClick={() => setCart((prev) => prev.flatMap((row) => row.itemId === line.itemId ? (row.qty <= 1 ? [] : [{ ...row, qty: round2(row.qty - 1) }]) : [row]))}>−</button>
                  <input aria-label={`Quantity of ${line.name}`} value={String(line.qty)} inputMode="decimal" onChange={(event) => setCart((prev) => prev.map((row) => row.itemId === line.itemId ? { ...row, qty: Number(event.target.value) || 0 } : row))} />
                  <button type="button" aria-label={`One more ${line.name}`} onClick={() => setCart((prev) => prev.map((row) => row.itemId === line.itemId ? { ...row, qty: round2(row.qty + 1) } : row))}>+</button>
                </div>
                <label className="rate-wrap">@ ₹
                  <input className="input rate-in" aria-label={`Price each for ${line.name}`} inputMode="decimal" value={String(line.rate)} onChange={(event) => setCart((prev) => prev.map((row) => row.itemId === line.itemId ? { ...row, rate: Number(event.target.value) || 0 } : row))} />
                </label>
                <button className="icon-btn" type="button" aria-label={`Remove ${line.name}`} onClick={() => setCart((prev) => prev.filter((row) => row.itemId !== line.itemId))}>×</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="bill-sec">
        <details className="more">
          <summary>Customer details (optional)</summary>
          <div className="form" style={{ marginTop: 8 }}>
            <div className="form-grid two">
              <Field label="Name"><input className="input" value={customerName} maxLength={60} onChange={(event) => setCustomerName(event.target.value)} /></Field>
              <Field label="Phone"><input className="input" type="tel" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} /></Field>
            </div>
            {settings?.gstMode === "REGULAR" ? (
              <>
                <Field label="Customer GSTIN"><input className="input" value={customerGstin} maxLength={15} onChange={(event) => setCustomerGstin(event.target.value.toUpperCase())} /></Field>
                <Field label="Place of supply" hint={`Leave as ${settings.stateName} for counter sales. Another state charges IGST.`}>
                  <select className="input" value={place} onChange={(event) => setPlace(event.target.value)}>
                    {STATES.map(([code, name]) => <option key={code} value={code}>{name} ({code})</option>)}
                  </select>
                </Field>
              </>
            ) : null}
          </div>
        </details>
        <div>
          <div className="small muted" style={{ fontWeight: 600, marginBottom: 6 }}>Payment</div>
          <div className="seg" role="group" aria-label="Payment">
            {["Cash", "UPI", "Card"].map((mode) => (
              <button key={mode} type="button" aria-pressed={payment === mode} onClick={() => setPayment(mode)}>{mode}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="totals">
        {settings?.gstMode === "REGULAR" ? (
          <>
            <div className="t"><span>Taxable value</span><span>{inr(calc.taxable / 100)}</span></div>
            {inter ? <div className="t"><span>IGST</span><span>{inr(calc.igst / 100)}</span></div> : (
              <>
                <div className="t"><span>CGST</span><span>{inr(calc.cgst / 100)}</span></div>
                <div className="t"><span>SGST</span><span>{inr(calc.sgst / 100)}</span></div>
              </>
            )}
          </>
        ) : null}
        {calc.roundOff ? <div className="t"><span>Round off</span><span>{inr(calc.roundOff / 100)}</span></div> : null}
        <div className="t grand"><span>Total</span><span>{inr(calc.total / 100)}</span></div>
      </div>
      {error ? <div className="panel-pad"><ErrorBox>{error}</ErrorBox></div> : null}
      <div className="panel-pad" style={{ display: "grid", gap: 8 }}>
        <button className="btn btn-primary btn-lg" type="button" disabled={!cart.length} onClick={() => void save()}>Save bill · {inr(calc.total / 100)}</button>
        <button className="btn btn-ghost" type="button" onClick={() => { setCart([]); setOpen(false); }}>Clear bill</button>
      </div>
    </section>
  );

  if (open) {
    return (
      <>
        <button className="btn btn-ghost back-link" type="button" onClick={() => setOpen(false)}>Add more items</button>
        {bill}
      </>
    );
  }

  return (
    <>
      <div className="page-head"><div><h1>New sale</h1><p>Tap items to add them to the bill.</p></div></div>
      <div className="sell-layout">
        <section>
          <div className="pick-tools">
            <div className="search">
              <input className="input" type="search" placeholder="Search items" aria-label="Search items" value={q} onChange={(event) => setQ(event.target.value)} />
            </div>
            <div className="chips" role="group" aria-label="Filter by type">
              {[["ALL", "All"], ["FISH", "Live fish"], ["DRY", "Dry goods"], ["SERVICE", "Services"]].map(([id, label]) => (
                <button key={id} className="chip" type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="panel">
            {!shown.length ? <div className="empty"><p>No item matches.</p></div> : (
              <ul className="list">
                {shown.map((item) => {
                  const count = cart.find((line) => line.itemId === item.id)?.qty || 0;
                  return (
                    <li key={item.id}>
                      <button className="row" type="button" aria-label={`Add ${item.name}`} onClick={() => add(item)}>
                        <div className="row-main">
                          <div className="row-title">{item.name}</div>
                          <div className="row-sub"><TypeBadge type={item.type} /><span className="money">{inr(item.sellPrice)}</span><StockBadge item={item} /></div>
                        </div>
                        {count ? <span className="pick-qty">{qty(count)}</span> : <span className="pick-add">+</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
        <div className="hide-on-phone">{bill}</div>
      </div>
      {cart.length ? (
        <div className="cart-bar">
          <div className="cart-bar-info">
            <div className="small" style={{ opacity: 0.85 }}>{cart.reduce((sum, line) => sum + line.qty, 0)} on the bill</div>
            <div className="cart-bar-total">{inr(calc.total / 100)}</div>
          </div>
          <button className="btn" type="button" onClick={() => setOpen(true)}>Review bill</button>
        </div>
      ) : null}
    </>
  );
}

interface SavedBill {
  invoiceNo: string;
  date: string;
  time: string;
  docType: string;
  status: string;
  payment: string;
  gstMode: string;
  customerName: string;
  customerPhone: string;
  customerGstin: string;
  placeOfSupplyName: string;
  supplyType: string;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  total: number;
  amountInWords: string;
  cancelReason: string;
  lines: { name: string; hsn: string; qty: number; rate: number; gstRate: number; taxable: number; total: number; unit: string }[];
  shop: SettingsRow & { stateName?: string };
}

export function Invoice({ bill }: { bill: string }) {
  const shop = useShop();
  const [inv, setInv] = useState<SavedBill | null>(null);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [ask, setAsk] = useState(false);
  const [paper, setPaper] = useState(shop.boot?.settings?.paper || "A4");
  const just = sessionStorage.getItem("aquarium-just-saved") === bill;

  useEffect(() => {
    try {
      setInv(shop.read("getSale", { invoiceNo: bill }) as SavedBill);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bill not found.");
    }
  }, [bill, shop.boot]);

  function printBill() {
    const node = document.getElementById("invoice-sheet");
    const root = document.getElementById("print-root");
    if (!node || !root) return;
    const size = paper === "80MM" ? "80mm auto" : "A4";
    const margin = paper === "80MM" ? "4mm" : "12mm";
    root.innerHTML = `<style>@page { size: ${size}; margin: ${margin}; }</style>${node.outerHTML}`;
    window.setTimeout(() => window.print(), 60);
  }

  function whatsApp() {
    if (!inv) return;
    const shopName = inv.shop?.shopName || "Aquarium Shop";
    let text = `${shopName}\n${inv.docType} ${inv.invoiceNo} · ${todayLabel(inv.date)}\n\n`;
    inv.lines.forEach((line) => {
      text += `${line.name} x ${qty(line.qty)} = ₹${formatINR(line.rate * line.qty)}\n`;
    });
    text += `\nTotal: ₹${formatINR(inv.total)} (${inv.payment})`;
    const tax = round2(inv.cgst + inv.sgst + inv.igst);
    if (inv.gstMode === "REGULAR" && tax > 0) text += `\nIncludes GST ₹${formatINR(tax)}`;
    if (inv.shop?.gstin) text += `\nGSTIN ${inv.shop.gstin}`;
    if (inv.shop?.upiId) text += `\nUPI: ${inv.shop.upiId}`;
    text += "\nThank you!";
    let phone = String(inv.customerPhone || "").replace(/\D/g, "");
    if (phone.length === 10) phone = "91" + phone;
    const url = `https://wa.me/${phone.length >= 11 ? phone : ""}?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener");
  }

  async function cancel() {
    if (!reason.trim()) {
      setError("Give a reason to cancel the bill.");
      return;
    }
    try {
      const data = (await shop.run("cancelSale", { invoiceNo: bill, reason })) as { invoice: SavedBill };
      setInv(data.invoice);
      setAsk(false);
      shop.ping("Bill cancelled. Stock put back.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel.");
    }
  }

  if (error && !inv) return <ErrorBox>{error}</ErrorBox>;
  if (!inv) return <div className="panel"><div className="empty"><p>Opening bill…</p></div></div>;

  return (
    <div className="doc-wrap" role="dialog" aria-modal="true" aria-label={`Bill ${inv.invoiceNo}`}>
      <div className="doc-bar">
        <button className="btn btn-ghost" type="button" onClick={() => { sessionStorage.removeItem("aquarium-just-saved"); go("sales"); }}>{just ? "Done" : "Back"}</button>
        <span className="spacer" />
        <button className="btn" type="button" aria-pressed={paper !== "80MM"} onClick={() => setPaper("A4")}>A4</button>
        <button className="btn" type="button" aria-pressed={paper === "80MM"} onClick={() => setPaper("80MM")}>80 mm</button>
        <button className="btn" type="button" onClick={printBill}>Print / PDF</button>
        <button className="btn" type="button" onClick={whatsApp}>WhatsApp</button>
        {inv.status !== "CANCELLED" ? <button className="btn btn-danger" type="button" onClick={() => setAsk(true)}>Cancel bill</button> : null}
      </div>
      <div className="doc-body">
        {just && inv.status !== "CANCELLED" ? <div className="doc-done">Saved. Stock has been updated.</div> : null}
        {error ? <ErrorBox>{error}</ErrorBox> : null}
        {ask ? (
          <form className="panel panel-pad form" style={{ maxWidth: 820, margin: "0 auto 12px" }} onSubmit={(event) => { event.preventDefault(); void cancel(); }}>
            <Field label="Reason for cancelling" hint="The bill number is kept. Stock is put back.">
              <input className="input" value={reason} onChange={(event) => setReason(event.target.value)} />
            </Field>
            <button className="btn btn-danger" type="submit">Cancel this bill</button>
          </form>
        ) : null}
        <article id="invoice-sheet" className={paper === "80MM" ? "invoice thermal" : "invoice"}>
          <div className="inv-head">
            <div>
              <div className="inv-shop">{inv.shop?.shopName}</div>
              <div>{[inv.shop?.address, inv.shop?.city, inv.shop?.pincode].filter(Boolean).join(", ")}</div>
              {inv.shop?.phone ? <div>{inv.shop.phone}</div> : null}
              {inv.shop?.gstin ? <div>GSTIN {inv.shop.gstin}</div> : null}
              {inv.shop?.stateName ? <div>{inv.shop.stateName}</div> : null}
            </div>
            <div>
              <div className="inv-type">{inv.docType}</div>
              {inv.status === "CANCELLED" ? <div className="stamp-cancel">CANCELLED</div> : null}
            </div>
          </div>
          <div className="inv-meta">
            <div><div className="lbl">Bill no</div><b>{inv.invoiceNo}</b></div>
            <div><div className="lbl">Date</div>{todayLabel(inv.date)} {inv.time}</div>
            <div><div className="lbl">Customer</div>{inv.customerName || "Cash sale"}{inv.customerPhone ? ` · ${inv.customerPhone}` : ""}</div>
            <div><div className="lbl">Place of supply</div>{inv.placeOfSupplyName} · {inv.supplyType}</div>
          </div>
          <table>
            <thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {inv.lines.map((line) => (
                <tr key={line.name + String(line.qty)}>
                  <td>{line.name}<div className="small">{line.hsn ? `HSN ${line.hsn}` : ""} {line.gstRate ? `· GST ${line.gstRate}%` : "· Exempt"}</div></td>
                  <td className="r">{qty(line.qty)} × {formatINR(line.rate)}</td>
                  <td className="r">{formatINR(line.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="inv-sum">
            <table>
              <tbody>
                {inv.gstMode === "REGULAR" ? (
                  <>
                    <tr><td>Taxable value</td><td className="r">{formatINR(inv.taxable)}</td></tr>
                    {inv.igst ? <tr><td>IGST</td><td className="r">{formatINR(inv.igst)}</td></tr> : (
                      <>
                        <tr><td>CGST</td><td className="r">{formatINR(inv.cgst)}</td></tr>
                        <tr><td>SGST</td><td className="r">{formatINR(inv.sgst)}</td></tr>
                      </>
                    )}
                  </>
                ) : null}
                {inv.roundOff ? <tr><td>Round off</td><td className="r">{formatINR(inv.roundOff)}</td></tr> : null}
                <tr className="grand"><td>Total</td><td className="r">₹{formatINR(inv.total)}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="words">{inv.amountInWords}</p>
          <div className="inv-foot">
            {inv.gstMode === "COMPOSITION" ? <p>{COMPOSITION_STATEMENT}</p> : null}
            {inv.shop?.upiId ? <p>UPI: {inv.shop.upiId}</p> : null}
            {inv.cancelReason ? <p>Cancelled: {inv.cancelReason}</p> : null}
            {inv.shop?.invoiceFooter ? <p>{inv.shop.invoiceFooter}</p> : null}
            <p className="small">Not certified GST software. Confirm HSN and rates with your supplier bill or CA.</p>
          </div>
        </article>
      </div>
    </div>
  );
}

interface SaleList {
  month: string;
  sales: { invoiceNo: string; date: string; time: string; customerName: string; payment: string; itemCount: number; total: number; status: string }[];
  summary: { count: number; total: number; byPayment: Record<string, number>; days: { date: string; count: number; total: number }[] };
}

export function Sales() {
  const shop = useShop();
  const [month, setMonth] = useState(() => (shop.boot?.today || "").slice(0, 7));
  const [q, setQ] = useState("");
  const [data, setData] = useState<SaleList | null>(null);
  useEffect(() => {
    try {
      setData(shop.read("listSales", { month, q }) as SaleList);
    } catch {
      setData(null);
    }
  }, [month, q, shop.boot]);
  const summary = data?.summary;
  return (
    <>
      <div className="page-head">
        <div><h1>Sales</h1><p>Bills for {monthLabel(month)}</p></div>
        <label className="field"><span className="sr">Month</span><input className="input" type="month" aria-label="Month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
      </div>
      <div className="stats">
        <div className="stat"><div className="k">Total</div><div className="v">{inr(summary?.total || 0)}</div></div>
        <div className="stat"><div className="k">Bills</div><div className="v">{summary?.count || 0}</div></div>
        <div className="stat"><div className="k">Cash</div><div className="v">{inr(summary?.byPayment?.Cash || 0)}</div></div>
        <div className="stat"><div className="k">UPI and card</div><div className="v">{inr((summary?.byPayment?.UPI || 0) + (summary?.byPayment?.Card || 0))}</div></div>
      </div>
      {summary?.days?.length ? (
        <section className="section">
          <h2>Day by day</h2>
          <div className="panel table-wrap" style={{ marginTop: 10 }}>
            <table className="data">
              <thead><tr><th>Date</th><th className="r">Bills</th><th className="r">Total</th></tr></thead>
              <tbody>
                {summary.days.map((day) => (
                  <tr key={day.date}><td>{todayLabel(day.date)}</td><td className="r">{day.count}</td><td className="r">{inr(day.total)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      <section className="section">
        <div className="search" style={{ marginBottom: 10 }}>
          <input className="input" type="search" placeholder="Bill no, name or phone" aria-label="Search bills" value={q} onChange={(event) => setQ(event.target.value)} />
        </div>
        <div className="panel">
          {!data?.sales.length ? <div className="empty"><p>No bills this month yet.</p></div> : (
            <ul className="list">
              {data.sales.map((sale) => (
                <li key={sale.invoiceNo}>
                  <button className="row" type="button" onClick={() => go("bill/" + encodeURIComponent(sale.invoiceNo))}>
                    <div className="row-main">
                      <div className="row-title">{sale.invoiceNo}{sale.customerName ? ` · ${sale.customerName}` : ""}</div>
                      <div className="row-sub"><span>{todayLabel(sale.date)} {sale.time}</span><span>{sale.payment}</span>{sale.status === "CANCELLED" ? <span className="badge b-cancel">Cancelled</span> : null}</div>
                    </div>
                    <div className="row-amt" style={sale.status === "CANCELLED" ? { textDecoration: "line-through" } : undefined}>{inr(sale.total)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}

interface Report {
  month: string;
  sales: { count: number; total: number; taxable: number; cgst: number; sgst: number; igst: number };
  cancelled: number;
  byType: Record<string, number>;
  hsn: { hsn: string; description: string; gstRate: number; qty: number; taxable: number; cgst: number; sgst: number; igst: number; total: number }[];
  approxCostOfGoods: number;
  purchases: number;
  mortality: { totalDead: number; totalLoss: number; rows: { name: string; dead: number; received: number; ratePct: number | null; loss: number; reasons: Record<string, number> }[] };
  stock: { value: number; retail: number; units: number };
}

export function Reports() {
  const shop = useShop();
  const [month, setMonth] = useState(() => (shop.boot?.today || "").slice(0, 7));
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    try {
      setReport(shop.read("report", { month }) as Report);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the report.");
    }
  }, [month, shop.boot]);
  if (!report) return error ? <ErrorBox>{error}</ErrorBox> : null;
  const regular = shop.boot?.settings?.gstMode === "REGULAR";
  const profit = round2((regular ? report.sales.taxable : report.sales.total) - report.approxCostOfGoods);
  async function csv(kind: string) {
    const data = (await shop.run("exportCsv", { kind, month })) as { filename: string; csv: string };
    downloadCsv(data.filename, data.csv);
    shop.ping("CSV downloaded.");
  }
  async function sheet(kind: string) {
    try {
      const url = await shop.exportSheet(kind, month);
      window.open(url, "_blank", "noopener");
      shop.ping("Google Sheet created in your Drive.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the Sheet.");
    }
  }
  return (
    <>
      <div className="page-head">
        <div><h1>Reports</h1><p>{monthLabel(month)}</p></div>
        <label className="field"><span className="sr">Month</span><input className="input" type="month" aria-label="Month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
      </div>
      {error ? <ErrorBox>{error}</ErrorBox> : null}
      <div className="stats">
        <div className="stat"><div className="k">Total sales</div><div className="v">{inr(report.sales.total)}</div></div>
        <div className="stat"><div className="k">Bills</div><div className="v">{report.sales.count}{report.cancelled ? <span className="small muted"> + {report.cancelled} cancelled</span> : null}</div></div>
        <div className="stat"><div className="k">Rough profit</div><div className="v">{inr(profit)}</div></div>
        <div className="stat"><div className="k">Purchases</div><div className="v">{inr(report.purchases)}</div></div>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>Rough profit is sales {regular ? "before GST" : ""} minus the cost price of items sold. It is an estimate, not accounts.</p>
      <section className="section grid-2">
        <div className="panel table-wrap">
          <div className="panel-pad"><h2>Sales by type</h2></div>
          <table className="data"><tbody>
            {(["FISH", "DRY", "SERVICE"] as const).map((type) => <tr key={type}><td>{ITEM_TYPES[type].label}</td><td className="r">{inr(report.byType[type] || 0)}</td></tr>)}
          </tbody></table>
        </div>
        <div className="panel table-wrap">
          <div className="panel-pad"><h2>Stock value</h2></div>
          <table className="data"><tbody>
            <tr><td>Pieces in stock</td><td className="r">{qty(report.stock.units)}</td></tr>
            <tr><td>Value at cost</td><td className="r">{inr(report.stock.value)}</td></tr>
            <tr><td>Value at selling price</td><td className="r">{inr(report.stock.retail)}</td></tr>
          </tbody></table>
        </div>
      </section>
      {regular ? (
        <section className="section">
          <h2 style={{ marginBottom: 10 }}>GST summary by HSN</h2>
          <div className="panel table-wrap">
            <table className="data">
              <thead><tr><th>HSN/SAC</th><th>Type</th><th className="r">GST</th><th className="r">Qty</th><th className="r">Taxable</th><th className="r">CGST</th><th className="r">SGST</th><th className="r">IGST</th></tr></thead>
              <tbody>
                {report.hsn.length ? report.hsn.map((row) => (
                  <tr key={row.hsn + row.gstRate}><td>{row.hsn || "—"}</td><td>{row.description}</td><td className="r">{row.gstRate}%</td><td className="r">{qty(row.qty)}</td><td className="r">{formatINR(row.taxable)}</td><td className="r">{formatINR(row.cgst)}</td><td className="r">{formatINR(row.sgst)}</td><td className="r">{formatINR(row.igst)}</td></tr>
                )) : <tr><td colSpan={8}>No taxable sales this month.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>GST collected this month: <b>{inr(round2(report.sales.cgst + report.sales.sgst + report.sales.igst))}</b>. This is a helper for your CA, not a GSTR filing.</p>
        </section>
      ) : null}
      <section className="section">
        <h2 style={{ marginBottom: 10 }}>Dead stock this month</h2>
        <div className="panel table-wrap">
          {!report.mortality.rows.length ? <div className="empty"><p>No dead or damaged stock this month.</p></div> : (
            <table className="data">
              <thead><tr><th>Item</th><th className="r">Dead</th><th className="r">Received</th><th className="r">Loss rate</th><th className="r">Loss at cost</th></tr></thead>
              <tbody>
                {report.mortality.rows.map((row) => (
                  <tr key={row.name}><td>{row.name}</td><td className="r">{qty(row.dead)}</td><td className="r">{qty(row.received)}</td><td className="r">{row.ratePct == null ? "—" : `${row.ratePct}%`}</td><td className="r">{formatINR(row.loss)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
      <section className="section">
        <h2>Export for your CA</h2>
        <p className="muted small">A sales register and an HSN summary to help prepare returns. This does not file GSTR, e-invoice or e-way bill.</p>
        <div className="panel" style={{ marginTop: 10 }}>
          <ul className="list">
            {[
              ["sales", "Sales register"],
              ["hsn", "HSN summary"],
              ["stock", "Stock on hand"],
              ["stockin", "Purchases"],
              ["mortality", "Dead stock"],
            ].map(([kind, label]) => (
              <li key={kind}>
                <div className="row" style={{ flexWrap: "wrap" }}>
                  <div className="row-main"><div className="row-title">{label}</div></div>
                  <div className="btn-row">
                    <button className="btn" type="button" onClick={() => void csv(kind)}>CSV</button>
                    <button className="btn" type="button" onClick={() => void sheet(kind)}>Google Sheet</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}

export function Settings() {
  const shop = useShop();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  return (
    <>
      <div className="page-head"><div><h1>Settings</h1><p>Shop details print on every bill. <a href="#/setup">Open the shop details form</a>.</p></div></div>
      <Setup editing />
      <section className="panel panel-pad form" style={{ marginTop: 12 }}>
        <h2>Shop PIN</h2>
        <p className="muted">{shop.boot?.settings?.pinSet ? "A PIN is set. This phone asks again after 6 hours." : "No PIN. Anyone who can open this signed-in phone can use the shop."}</p>
        <form className="form" onSubmit={(event) => { event.preventDefault(); void shop.run("setPin", { pin }).then(() => { setPin(""); shop.ping("PIN saved."); }).catch((err) => setError(err instanceof Error ? err.message : "Could not set the PIN.")); }}>
          {error ? <ErrorBox>{error}</ErrorBox> : null}
          <Field label={shop.boot?.settings?.pinSet ? "New PIN" : "Set a PIN"}>
            <input className="input" inputMode="numeric" type="password" value={pin} maxLength={8} onChange={(event) => setPin(event.target.value)} />
          </Field>
          <button className="btn" type="submit">Save PIN</button>
        </form>
        {shop.boot?.settings?.pinSet ? <button className="btn btn-ghost" type="button" onClick={() => void shop.run("setPin", { remove: true }).then(() => shop.ping("PIN removed."))}>Remove PIN</button> : null}
      </section>
      <section className="panel panel-pad form" style={{ marginTop: 12 }}>
        <h2>Your data</h2>
        <p className="muted">Everything is in one Google Sheet in your own Drive, inside a folder named Aquarium Shop. Do not rename the tabs. Your CA can open the sheet. Make a copy now and then (File → Make a copy) as a backup.</p>
        {shop.sheetUrl ? <a className="btn" href={shop.sheetUrl} target="_blank" rel="noopener">Open your Google Sheet</a> : <p className="small muted">{shop.demo ? "Demo mode keeps data on this device only." : "The sheet appears here after you sign in."}</p>}
        <p className="small">Status: {shop.syncLabel}</p>
        {!shop.demo ? <button className="btn btn-ghost" type="button" onClick={shop.signOut}>Sign out</button> : <a className="btn btn-ghost" href={import.meta.env.BASE_URL}>Leave demo and sign in</a>}
        <Disclaimer />
      </section>
    </>
  );
}

export function Help() {
  return (
    <>
      <div className="page-head"><div><h1>How to use</h1><p>Read once, then keep selling.</p></div></div>
      <article className="panel panel-pad prose">
        <h2 style={{ marginTop: 0 }}>Every day</h2>
        <ol>
          <li><b>Make a bill:</b> tap New sale, tap items, then Review bill. Change quantity or price, choose Cash, UPI or Card, and tap Save bill.</li>
          <li><b>Give the bill:</b> tap Print / PDF (choose a printer or Save as PDF) or WhatsApp.</li>
          <li><b>New fish or goods:</b> Stock in. Enter quantity, cost and supplier. Stock goes up.</li>
          <li><b>Fish died or something broke:</b> Dead stock. Enter quantity and a reason. The loss shows in Reports.</li>
        </ol>
        <h2>Items</h2>
        <ul>
          <li><b>Live fish</b> defaults to HSN 0301 and GST exempt. <b>Dry goods</b> (tanks, food, filters) default to 18%. <b>Services</b> such as tank cleaning default to SAC 9987 at 18% and have no stock.</li>
          <li>Confirm dry-goods HSN and rate from the supplier bill or your CA. You can edit every item.</li>
          <li>Selling prices include GST unless you switch to "GST added on top" in Settings.</li>
          <li>Low items show on Home.</li>
        </ul>
        <h2>Mistakes</h2>
        <ul>
          <li>Wrong bill? Sales → open it → Cancel bill, with a reason. Stock is put back. The number is kept and never reused.</li>
          <li>Wrong stock count? Use Stock in or Dead stock so there is a record.</li>
        </ul>
        <h2>Bill headings</h2>
        <ul>
          <li><b>Tax Invoice:</b> regular GST, all items taxable.</li>
          <li><b>Bill of Supply:</b> only exempt items (live fish), or the composition scheme.</li>
          <li><b>Invoice-cum-Bill of Supply:</b> regular GST with fish and taxable items on one bill.</li>
          <li>Composition bills include: "{COMPOSITION_STATEMENT}".</li>
          <li>Not registered: the heading is Bill, with no tax.</li>
        </ul>
        <h2>End of month</h2>
        <ul>
          <li>Reports shows sales, GST by HSN, rough profit, stock value and dead stock.</li>
          <li>Export CSV or a new Google Sheet for your CA. The app does not file returns.</li>
        </ul>
        <h2>Your phone</h2>
        <ul>
          <li>Add this page to the home screen so it opens like an app. Android Chrome: menu → Add to Home screen or Install app. iPhone Safari: Share → Add to Home Screen.</li>
          <li>Your books are a Google Sheet in the signed-in Gmail's Drive. Another phone with the same Gmail sees the same shop.</li>
          <li>If the network drops, the screen says Waiting to sync. It saves to Drive when you are online again.</li>
          <li>Bill numbers restart on 1 April and are not reused. Two phones billing at the exact same second can still clash — use one phone at the counter.</li>
        </ul>
        <Disclaimer />
      </article>
    </>
  );
}
