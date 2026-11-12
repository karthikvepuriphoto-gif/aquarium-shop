import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isGoogleConfigured } from "./config";
import { ShopEngine, type Snapshot } from "./engine";
import { sampleItems } from "./logic";
import { fetchEmail, getValidToken, invalidateToken, peekToken, rememberEmail, requestTokenFromTap, warmGoogleSignIn } from "./lib/auth";
import { AuthExpiredError, OfflineError } from "./lib/errors";
import { GoogleApiError, shouldAskConsentAgain, signInPrompt } from "./lib/googleError";
import { loadBlob, saveBlob, type OutboxOp } from "./lib/idb";
import { claimsMatch, createExportSheet, ensureWorkbook, readSnapshot, sheetUrl, writeSnapshot } from "./lib/sheets";

export type SyncState = "saved" | "waiting" | "saving" | "signin" | "demo";

const WRITES = new Set(["setup", "saveSettings", "setPin", "saveItem", "stockIn", "mortality", "createSale", "cancelSale"]);
const PIN_KEY = "aquarium-shop-pin-token";

export interface ItemRow {
  id: string;
  name: string;
  type: string;
  hsn: string;
  gstRate: number;
  unit: string;
  costPrice: number;
  sellPrice: number;
  stock: number;
  lowStockAt: number;
  notes: string;
}

export interface SettingsRow {
  shopName: string;
  address: string;
  city: string;
  pincode: string;
  phone: string;
  email: string;
  gstin: string;
  state: string;
  stateName: string;
  gstMode: string;
  priceMode: string;
  invoicePrefix: string;
  upiId: string;
  invoiceFooter: string;
  paper: string;
  allowNegativeStock: string;
  setupDone: string;
  pinSet: boolean;
}

export interface Boot {
  setupDone: boolean;
  locked?: boolean;
  shopName?: string;
  today: string;
  settings?: SettingsRow;
  items?: ItemRow[];
  dashboard?: {
    today: { count: number; total: number; byPayment: Record<string, number> };
    month: { count: number; total: number };
    lowStock: ItemRow[];
    lowStockCount: number;
    deadThisMonth: number;
    date: string;
  };
}

interface ShopValue {
  booted: boolean;
  entered: boolean;
  demo: boolean;
  configured: boolean;
  email: string;
  sync: SyncState;
  syncLabel: string;
  sheetUrl: string;
  notice: string;
  noticeRaw: string;
  toast: string;
  boot: Boot | null;
  signIn: () => void;
  signOut: () => void;
  run: (action: string, payload?: Record<string, unknown>) => Promise<unknown>;
  forgotPin: () => void;
  exportSheet: (kind: string, month: string) => Promise<string>;
  read: (action: string, payload?: Record<string, unknown>) => unknown;
  ping: (message: string) => void;
}

const Ctx = createContext<ShopValue | null>(null);

export function useShop(): ShopValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("Shop is not ready.");
  return value;
}

function demoMode(): boolean {
  return new URLSearchParams(location.search).get("demo") === "1";
}

function readPinToken(): string | null {
  try {
    const raw = sessionStorage.getItem(PIN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token: string; exp: number };
    if (!parsed.token || parsed.exp < Date.now()) return null;
    return parsed.token;
  } catch {
    return null;
  }
}

function writePinToken(token: string | null) {
  try {
    if (!token) sessionStorage.removeItem(PIN_KEY);
    else sessionStorage.setItem(PIN_KEY, JSON.stringify({ token, exp: Date.now() + 21_600_000 }));
  } catch {
    /* ignore */
  }
}

function prepare(action: string, payload: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...payload };
  if (WRITES.has(action) && !next.bookedAt) next.bookedAt = new Date().toISOString();
  if (action === "setup" && String(next.addSamples) === "true" && !next.sampleIds) {
    next.sampleIds = sampleItems().map((item) => ({ name: item.name, id: crypto.randomUUID() }));
  }
  if (action === "createSale" && !next.clientId) next.clientId = crypto.randomUUID();
  if ((action === "stockIn" || action === "mortality") && !next.id) next.id = crypto.randomUUID();
  if (action === "saveItem" && !next.id && !next.archive) {
    next.id = crypto.randomUUID();
    next.createWithId = true;
  }
  return next;
}

function syncLabel(sync: SyncState): string {
  if (sync === "demo") return "Demo on this device";
  if (sync === "saved") return "Saved to Google Drive";
  if (sync === "saving") return "Saving…";
  if (sync === "signin") return "Sign in again";
  return "Waiting to sync";
}

export function ShopProvider({ children }: { children: ReactNode }) {
  const demo = useMemo(demoMode, []);
  const configured = isGoogleConfigured();
  const engineRef = useRef(new ShopEngine());
  const outbox = useRef<OutboxOp[]>([]);
  const spreadsheetId = useRef("");
  const folderId = useRef("");
  const googleToken = useRef("");
  const emailRef = useRef("");
  const consentRetry = useRef(false);
  const chain = useRef(Promise.resolve());
  const [booted, setBooted] = useState(false);
  const [entered, setEntered] = useState(false);
  const [email, setEmail] = useState("");
  const [sync, setSync] = useState<SyncState>(demo ? "demo" : "saved");
  const [url, setUrl] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeRaw, setNoticeRaw] = useState("");
  const [toast, setToast] = useState("");
  const [pinToken, setPinToken] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const engine = engineRef.current;

  async function persist() {
    const key = demo ? "demo" : emailRef.current;
    if (!key) return;
    await saveBlob(key, {
      snapshot: engine.exportSnapshot(),
      outbox: outbox.current,
      spreadsheetId: spreadsheetId.current || undefined,
      folderId: folderId.current || undefined,
      email: emailRef.current || undefined,
    });
  }

  function showNotice(hint: string, raw = "") {
    setNotice(hint);
    setNoticeRaw(raw);
  }

  function clearNotice() {
    setNotice("");
    setNoticeRaw("");
  }

  function adoptPin() {
    const pin = readPinToken();
    if (pin) engine.adoptToken(pin);
    setPinToken(pin);
    return pin;
  }

  async function flushOnce(google: string, retried = false): Promise<void> {
    if (!spreadsheetId.current) return;
    setSync("saving");
    try {
      let remote = await readSnapshot(google, spreadsheetId.current);
      if (outbox.current.length === 0) {
        const local = engine.exportSnapshot();
        if (remote.settings.setupDone !== "true" && local.settings.setupDone === "true") {
          await writeSnapshot(google, spreadsheetId.current, stampClaims(local));
        } else if (remote.settings.setupDone === "true") {
          engine.replaceData(remote);
          adoptPin();
          setTick((n) => n + 1);
        }
        await persist();
        setSync("saved");
        return;
      }
      for (let attempt = 0; attempt < 4; attempt++) {
        const replay = ShopEngine.fromSnapshot(remote);
        const pin = readPinToken();
        if (pin) replay.adoptToken(pin);
        for (const op of outbox.current) {
          const res = replay.api(op.action, { ...op.payload, replay: true });
          if (!res.ok) throw new Error(res.error || "Could not sync.");
        }
        const snap = stampClaims(replay.exportSnapshot());
        await writeSnapshot(google, spreadsheetId.current, snap);
        const after = await readSnapshot(google, spreadsheetId.current);
        const ours = new Set(snap.sales.map((sale) => String(sale.invoiceNo)));
        const extra = after.sales.some((sale) => !ours.has(String(sale.invoiceNo)));
        const claimed = snap.counters.length === 0 || claimsMatch(snap.counters, after.counters);
        if (extra || !claimed) {
          remote = after;
          continue;
        }
        engine.replaceData(snap);
        if (pin) engine.adoptToken(pin);
        outbox.current = [];
        await persist();
        setTick((n) => n + 1);
        setSync("saved");
        return;
      }
      setSync("waiting");
      showNotice("Waiting to sync. If two phones saved a bill at the same moment, wait a few seconds and open the app again.");
    } catch (error) {
      if (error instanceof AuthExpiredError && !retried) {
        try {
          const next = await getValidToken();
          googleToken.current = next;
          await flushOnce(next, true);
          return;
        } catch {
          setSync("signin");
          return;
        }
      }
      if (error instanceof AuthExpiredError) {
        setSync("signin");
        return;
      }
      setSync("waiting");
      if (error instanceof GoogleApiError) showNotice(error.message, error.raw);
      else if (!(error instanceof OfflineError)) showNotice(error instanceof Error ? error.message : "Waiting to sync");
    }
  }

  function enqueueFlush() {
    const google = googleToken.current;
    if (!google || demo) return;
    chain.current = chain.current.then(() => flushOnce(google)).catch(() => undefined);
  }

  async function openAccount(google: string) {
    const who = await fetchEmail(google);
    rememberEmail(who);
    emailRef.current = who;
    setEmail(who);
    googleToken.current = google;
    const blob = await loadBlob(who);
    if (blob?.snapshot) {
      engine.replaceData(blob.snapshot);
      outbox.current = blob.outbox || [];
      spreadsheetId.current = blob.spreadsheetId || "";
      folderId.current = blob.folderId || "";
    }
    adoptPin();
    if (!navigator.onLine) {
      setSync(outbox.current.length ? "waiting" : "saved");
    } else {
      const book = await ensureWorkbook(google, spreadsheetId.current);
      spreadsheetId.current = book.spreadsheetId;
      folderId.current = book.folderId;
      setUrl(sheetUrl(book.spreadsheetId));
      await flushOnce(google);
    }
    setEntered(true);
    setTick((n) => n + 1);
  }

  useEffect(() => {
    if (!demo && configured) warmGoogleSignIn();
  }, [demo, configured]);

  useEffect(() => {
    let live = true;
    (async () => {
      adoptPin();
      if (demo) {
        const blob = await loadBlob("demo");
        if (!live) return;
        if (blob?.snapshot) {
          engine.replaceData(blob.snapshot);
          outbox.current = blob.outbox || [];
        }
        adoptPin();
        setSync("demo");
        setEntered(true);
        setBooted(true);
        setTick((n) => n + 1);
        return;
      }
      if (!configured || !peekToken()) {
        if (live) {
          clearNotice();
          setBooted(true);
        }
        if (!demo && configured) warmGoogleSignIn();
        return;
      }
      try {
        const google = await getValidToken();
        if (!live) return;
        await openAccount(google);
      } catch {
        if (live) clearNotice();
      } finally {
        if (live) setBooted(true);
      }
    })();
    const online = () => {
      if (!demo && googleToken.current) enqueueFlush();
    };
    const offline = () => {
      if (!demo) setSync("waiting");
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      live = false;
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
    // Boot once per mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  const boot = useMemo(() => {
    const res = engine.api("bootstrap", {}, pinToken);
    if (!res.ok) return null;
    return res.data as Boot;
  }, [engine, pinToken, tick]);

  async function run(action: string, payload: Record<string, unknown> = {}) {
    const prepared = prepare(action, payload);
    const result = engine.api(action, prepared, pinToken);
    if (!result.ok) throw new Error(result.error || "Something went wrong.");
    if (action === "unlock" || action === "setPin" || action === "setup") {
      const data = result.data as { token?: string | null; pinSet?: boolean };
      if (data.token) {
        writePinToken(data.token);
        engine.adoptToken(data.token);
        setPinToken(data.token);
      } else if (action === "setPin" && data.pinSet === false) {
        writePinToken(null);
        setPinToken(null);
      }
    }
    if (WRITES.has(action)) {
      outbox.current.push({ id: crypto.randomUUID(), action, payload: prepared });
      await persist();
      if (demo) setSync("demo");
      else if (!navigator.onLine || !googleToken.current) setSync("waiting");
      else enqueueFlush();
    }
    setTick((n) => n + 1);
    return result.data;
  }

  function signIn() {
    clearNotice();
    const prompt = signInPrompt(consentRetry.current);
    void requestTokenFromTap(prompt)
      .then(async (google) => {
        consentRetry.current = false;
        await openAccount(google);
        setBooted(true);
      })
      .catch((error: unknown) => {
        if (shouldAskConsentAgain(error)) consentRetry.current = true;
        if (error instanceof GoogleApiError) {
          showNotice(error.message, error.raw);
        } else {
          const message = error instanceof Error ? error.message : "Sign in again.";
          const extra =
            error instanceof AuthExpiredError
              ? " If Google says the app is not verified, add this Gmail as a test user on the Aquarium Shop Cloud project."
              : "";
          showNotice(`${message}${extra}`);
        }
        setSync("signin");
        setEntered(false);
      });
  }

  function signOut() {
    invalidateToken();
    googleToken.current = "";
    writePinToken(null);
    setPinToken(null);
    setEntered(false);
    setEmail("");
    emailRef.current = "";
  }

  function forgotPin() {
    if (demo) {
      if (!window.confirm("Remove the demo PIN on this device?")) return;
      finishForgotPin();
      return;
    }
    void requestTokenFromTap(signInPrompt(consentRetry.current))
      .then((google) => {
        googleToken.current = google;
        finishForgotPin();
      })
      .catch((error: unknown) => {
        if (shouldAskConsentAgain(error)) consentRetry.current = true;
        showNotice(error instanceof Error ? error.message : "Sign in again.", error instanceof GoogleApiError ? error.raw : "");
      });
  }

  function finishForgotPin() {
    engine.clearPin();
    writePinToken(null);
    setPinToken(null);
    outbox.current.push({ id: crypto.randomUUID(), action: "setPin", payload: { remove: true, bookedAt: new Date().toISOString() } });
    void persist().then(() => {
      if (!demo) enqueueFlush();
      else setSync("demo");
      setTick((n) => n + 1);
    });
  }

  async function exportSheet(kind: string, month: string) {
    if (demo || !googleToken.current || !folderId.current) {
      throw new Error("Sign in with Google to create a Sheet for your CA. In demo mode, download the CSV instead.");
    }
    const built = engine.buildExport({ kind, month });
    const name = engine.exportSnapshot().settings.shopName || "Aquarium Shop";
    return createExportSheet(googleToken.current, `${name} - ${built.name}`, built.rows, folderId.current);
  }

  function read(action: string, payload: Record<string, unknown> = {}) {
    const result = engine.api(action, payload, pinToken);
    if (!result.ok) throw new Error(result.error || "Could not load.");
    return result.data;
  }

  function ping(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }

  const value: ShopValue = {
    booted,
    entered,
    demo,
    configured,
    email,
    sync,
    syncLabel: syncLabel(sync),
    sheetUrl: url,
    notice,
    noticeRaw,
    toast,
    boot,
    signIn,
    signOut,
    run,
    forgotPin,
    exportSheet,
    read,
    ping,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function stampClaims(snap: Snapshot): Snapshot {
  const claimId = crypto.randomUUID();
  const claimedAt = new Date().toISOString();
  return {
    ...snap,
    counters: snap.counters.map((row) => ({ ...row, claimId, claimedAt })),
  };
}
