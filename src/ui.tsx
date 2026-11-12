import { useEffect, useState, type ReactNode } from "react";

export function go(path: string) {
  const next = "#/" + path.replace(/^#\/?/, "");
  if (location.hash !== next) location.hash = next;
  else window.scrollTo(0, 0);
}

export function useRoute(): { name: string; bill: string } {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const onHash = () => setHash(location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const raw = hash.replace(/^#\/?/, "");
  if (raw.startsWith("bill/")) return { name: "bill", bill: decodeURIComponent(raw.slice(5)) };
  const known = ["setup", "home", "items", "stock", "dead", "sale", "sales", "reports", "settings", "help"];
  return { name: known.includes(raw) ? raw : "home", bill: "" };
}

export function Fish({ large = false }: { large?: boolean }) {
  return (
    <svg className={large ? "ic lg" : "ic"} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M2.5 12c2.2-4.2 6.2-6.5 10.4-6.5 1.6 0 3.1.4 4.3 1.1L21.5 4l-1.2 4.2c.5.9.8 1.9.8 2.8s-.3 1.9-.8 2.8L21.5 20l-4.3-2.6c-1.2.7-2.7 1.1-4.3 1.1-4.2 0-8.2-2.3-10.4-6.5Z" />
      <circle cx="14.2" cy="10.6" r="1" fill="#0E5C55" />
    </svg>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small className="hint">{hint}</small> : null}
    </label>
  );
}

export function Disclaimer() {
  return (
    <div className="note">
      <span>
        This is a starter billing and stock tool, not certified GST software and not legal or tax advice. Ask your CA to check the bill and your returns before filing. Live ornamental fish defaults to HSN 0301 (exempt). Services default to SAC 9987 at 18%. Dry goods default to 18% — confirm each rate with the supplier bill or your CA.
      </span>
    </div>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return <div className="error-box">{children}</div>;
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1500);
}
