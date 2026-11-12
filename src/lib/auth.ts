import { BASE_SCOPES, DRIVE_SCOPE, GOOGLE_CLIENT_ID, isGoogleConfigured } from "../config";
import { AuthExpiredError } from "./errors";
import { DriveAccessError, driveAccessGranted, scopeListIncludes } from "./googleError";

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
}

interface TokenClient {
  requestAccessToken: (override?: { prompt?: string; scope?: string; include_granted_scopes?: boolean }) => void;
}

interface Session {
  accessToken: string;
  expiresAt: number;
  scopes: string[];
  email: string;
}

type HasGranted = (tokenResponse: GoogleTokenResponse, ...scopes: string[]) => boolean;

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: GoogleTokenResponse) => void;
            error_callback?: (err: { type?: string; message?: string }) => void;
            include_granted_scopes?: boolean;
          }) => TokenClient;
          hasGrantedAllScopes?: HasGranted;
        };
      };
    };
  }
}

const STORAGE_KEY = "aquarium-shop-session";
let session: Session | null = null;
let client: TokenClient | null = null;
let gisPromise: Promise<void> | null = null;
let pending: { resolve: (token: string) => void; reject: (error: Error) => void } | null = null;

function readStored(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed.accessToken || parsed.expiresAt < Date.now() + 60_000) return null;
    if (!scopeListIncludes(parsed.scopes?.join(" "), DRIVE_SCOPE)) return null;
    session = parsed;
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(next: Session | null) {
  session = next;
  try {
    if (!next) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
}

export function peekSession(): Session | null {
  if (session && session.expiresAt > Date.now() + 60_000 && scopeListIncludes(session.scopes.join(" "), DRIVE_SCOPE)) {
    return session;
  }
  return readStored();
}

export function peekToken(): string | null {
  return peekSession()?.accessToken ?? null;
}

export function invalidateToken() {
  writeStored(null);
  client = null;
}

export function rememberEmail(email: string) {
  if (!session) return;
  writeStored({ ...session, email });
}

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>("script[data-aquarium-gis]");
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("gis")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.dataset.aquariumGis = "1";
      script.onload = () => resolve();
      script.onerror = () => {
        gisPromise = null;
        reject(new Error("Could not reach Google sign-in. Check the connection and try again."));
      };
      document.head.appendChild(script);
    });
  }
  return gisPromise;
}

/** Load Google's script before the tap, so the tap itself can open the window. */
export function warmGoogleSignIn(): void {
  if (!isGoogleConfigured()) return;
  void loadGis().catch(() => undefined);
}

function ensureClient(): TokenClient {
  if (client) return client;
  const google = window.google;
  if (!google?.accounts?.oauth2) throw new Error("Could not reach Google sign-in. Check the connection and try again.");
  client = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: BASE_SCOPES.join(" "),
    include_granted_scopes: true,
    callback: (response) => {
      const waiter = pending;
      pending = null;
      if (!waiter) return;
      if (!response.access_token || response.error) {
        waiter.reject(new AuthExpiredError());
        return;
      }
      const oauth2 = window.google?.accounts?.oauth2;
      const checker = oauth2?.hasGrantedAllScopes
        ? (token: { scope?: string }, ...scopes: string[]) => oauth2.hasGrantedAllScopes!(token, ...scopes)
        : undefined;
      if (!driveAccessGranted(response, checker)) {
        waiter.reject(new DriveAccessError());
        return;
      }
      const scopes = (response.scope || "").split(/\s+/).filter(Boolean);
      const next: Session = {
        accessToken: response.access_token,
        expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
        scopes: scopeListIncludes(scopes.join(" "), DRIVE_SCOPE) ? scopes : [...scopes, DRIVE_SCOPE],
        email: session?.email ?? "",
      };
      writeStored(next);
      waiter.resolve(next.accessToken);
    },
    error_callback: () => {
      const waiter = pending;
      pending = null;
      waiter?.reject(new AuthExpiredError());
    },
  });
  return client;
}

/**
 * Open the Google window from the click, with no await before requestAccessToken.
 * iOS drops the user gesture if anything is awaited first, and the popup never opens.
 */
export function requestTokenFromTap(prompt: "select_account" | "consent"): Promise<string> {
  if (!isGoogleConfigured()) return Promise.reject(new Error("Google sign-in is not set up yet."));
  if (!window.google?.accounts?.oauth2) {
    warmGoogleSignIn();
    return Promise.reject(new Error("Google sign-in is still loading. Wait a moment and tap Sign in again."));
  }
  const tokenClient = ensureClient();
  return new Promise((resolve, reject) => {
    if (pending) {
      reject(new Error("Sign-in is already open."));
      return;
    }
    const timer = window.setTimeout(() => {
      if (!pending) return;
      pending = null;
      reject(new AuthExpiredError());
    }, 90_000);
    pending = {
      resolve: (token) => {
        window.clearTimeout(timer);
        resolve(token);
      },
      reject: (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    };
    try {
      tokenClient.requestAccessToken({ prompt, scope: BASE_SCOPES.join(" "), include_granted_scopes: true });
    } catch (error) {
      pending = null;
      window.clearTimeout(timer);
      reject(error instanceof Error ? error : new AuthExpiredError());
    }
  });
}

/** Silent reuse of a token that already includes Drive. Not used for the Sign in tap. */
export async function getValidToken(): Promise<string> {
  const current = peekSession();
  if (current) return current.accessToken;
  if (!isGoogleConfigured()) throw new Error("Google sign-in is not set up yet.");
  await loadGis();
  const tokenClient = ensureClient();
  return new Promise((resolve, reject) => {
    if (pending) {
      reject(new Error("Sign-in is already open."));
      return;
    }
    const timer = window.setTimeout(() => {
      if (!pending) return;
      pending = null;
      reject(new AuthExpiredError());
    }, 90_000);
    pending = {
      resolve: (token) => {
        window.clearTimeout(timer);
        resolve(token);
      },
      reject: (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    };
    try {
      tokenClient.requestAccessToken({ prompt: "", scope: BASE_SCOPES.join(" "), include_granted_scopes: true });
    } catch (error) {
      pending = null;
      window.clearTimeout(timer);
      reject(error instanceof Error ? error : new AuthExpiredError());
    }
  });
}

export async function fetchEmail(token: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Error("Could not reach Google to confirm the account.");
  }
  if (response.status === 401) throw new AuthExpiredError();
  if (!response.ok) throw new Error("Could not read the Google account email.");
  const data = (await response.json()) as { email?: string };
  return data.email ?? "";
}
