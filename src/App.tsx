import { useEffect } from "react";
import { Help, Home, Invoice, Items, Lock, Reports, Sale, Sales, Settings, Setup, Welcome } from "./pages";
import { useShop } from "./shop";
import { Fish, go, useRoute } from "./ui";

const NAV = [
  ["home", "Home"],
  ["sale", "New sale"],
  ["items", "Stock"],
  ["sales", "Sales"],
  ["reports", "Reports"],
] as const;

function currentNav(name: string): string {
  if (name === "bill") return "sales";
  if (name === "items" || name === "stock" || name === "dead") return "items";
  return name;
}

export function App() {
  const shop = useShop();
  const route = useRoute();

  useEffect(() => {
    const onPrint = () => {
      const root = document.getElementById("print-root");
      if (root) root.innerHTML = "";
    };
    window.addEventListener("afterprint", onPrint);
    return () => window.removeEventListener("afterprint", onPrint);
  }, []);

  useEffect(() => {
    if (!shop.entered || !shop.boot || shop.boot.locked) return;
    if (!shop.boot.setupDone && route.name !== "setup" && route.name !== "help") go("setup");
  }, [shop.entered, shop.boot, route.name]);

  if (!shop.booted) {
    return (
      <div className="boot">
        <div className="boot-mark"><Fish large /></div>
        <p>Opening your shop…</p>
      </div>
    );
  }
  if (!shop.entered) return <Welcome />;
  if (shop.boot?.locked) return <Lock />;

  const showNav = !!shop.boot?.setupDone;
  const page = renderPage(route.name, route.bill, showNav);
  const here = currentNav(route.name);

  return (
    <>
      <div className={showNav ? "shell" : "shell no-nav"}>
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark"><Fish /></div>
            <div style={{ minWidth: 0 }}>
              <div className="brand-name">{shop.boot?.settings?.shopName || shop.boot?.shopName || "Aquarium Shop"}</div>
              <div className={"sync-status " + (shop.sync === "saved" || shop.sync === "demo" ? "ok" : "wait")} role="status">{shop.syncLabel}</div>
            </div>
          </div>
          <button className="icon-btn" type="button" aria-label="How to use" aria-current={route.name === "help" ? "page" : undefined} onClick={() => go("help")}>?</button>
          <button className="icon-btn" type="button" aria-label="Settings" aria-current={route.name === "settings" || route.name === "setup" ? "page" : undefined} onClick={() => go("settings")}>⚙</button>
        </header>
        <div className="layout">
          <nav className="side" aria-label="Main">{showNav ? navButtons(here) : null}</nav>
          <main>
            {shop.sync === "signin" ? (
              <div className="error-box banner">
                <div>
                  <strong>Sign in again</strong>
                  <p>Google needs a fresh sign-in before new bills can reach your Drive. What you already entered stays on this phone.</p>
                  <button className="btn btn-primary" type="button" onClick={() => void shop.signIn()}>Sign in again</button>
                </div>
              </div>
            ) : null}
            {shop.notice && shop.sync === "waiting" ? <div className="note banner"><span>{shop.notice}</span></div> : null}
            {page}
          </main>
        </div>
        {showNav ? <nav className="bottom-nav" aria-label="Main">{navButtons(here)}</nav> : null}
      </div>
      {shop.toast ? <div className="toast on" role="status">{shop.toast}</div> : null}
    </>
  );
}

function navButtons(here: string) {
  return NAV.map(([id, label]) => (
    <button key={id} className={"nav-btn" + (id === "sale" ? " sell" : "")} type="button" aria-current={here === id ? "page" : undefined} onClick={() => go(id)}>
      <span>{label}</span>
    </button>
  ));
}

function renderPage(name: string, bill: string, setupDone: boolean) {
  if (!setupDone && name !== "help") return <Setup />;
  if (name === "setup") return setupDone ? <Setup editing /> : <Setup />;
  if (name === "items") return <Items initialTab="items" />;
  if (name === "stock") return <Items initialTab="stock" />;
  if (name === "dead") return <Items initialTab="dead" />;
  if (name === "sale") return <Sale />;
  if (name === "sales") return <Sales />;
  if (name === "bill" && bill) return <Invoice bill={bill} />;
  if (name === "reports") return <Reports />;
  if (name === "settings") return <Settings />;
  if (name === "help") return <Help />;
  return <Home />;
}
