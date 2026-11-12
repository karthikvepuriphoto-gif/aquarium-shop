/** Replace this one line if the OAuth Web client ID ever changes. Public client ID, not a secret. */
export const GOOGLE_CLIENT_ID = "799269548849-i8iugf22hl1e78ltqjbpmap4o6dojk91.apps.googleusercontent.com";

/** GCP project that owns the OAuth client. Consent screen is in Testing mode. */
export const GOOGLE_CLOUD_PROJECT = "aquarium-shop-514520";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** Requested at sign-in. drive.file only lets the app see files it created. */
export const BASE_SCOPES = ["openid", "email", "profile", DRIVE_SCOPE];

export const DATA_FOLDER = "Aquarium Shop";
export const DATA_FILE_NAME = "Aquarium Shop - Data (do not rename tabs)";

export const SHEET_TABS = ["Settings", "Items", "StockIn", "Mortality", "Sales", "SaleLines", "Counters"] as const;

export function isGoogleConfigured(id: string = GOOGLE_CLIENT_ID): boolean {
  const trimmed = id.trim();
  if (trimmed.length < 20) return false;
  if (trimmed.includes("YOUR_GOOGLE_CLIENT_ID")) return false;
  if (!trimmed.endsWith(".apps.googleusercontent.com")) return false;
  return true;
}
