import { DRIVE_SCOPE, GOOGLE_CLOUD_PROJECT } from "../config";

/** Thrown when Google Identity Services returns a token without drive.file. */
export class DriveAccessError extends Error {
  constructor() {
    super(
      "Google didn't give Drive access. Tap Sign in again and tick the box that lets Aquarium Shop see, edit and create its own files in Google Drive.",
    );
    this.name = "DriveAccessError";
  }
}

/** A Google API error with a plain hint and the raw reason for a screenshot. */
export class GoogleApiError extends Error {
  readonly raw: string;
  constructor(hint: string, raw: string) {
    super(hint);
    this.name = "GoogleApiError";
    this.raw = raw;
  }
}

export interface ParsedGoogleError {
  reason: string;
  status: string;
  message: string;
  hint: string;
  raw: string;
}

interface GoogleErrorBody {
  error?:
    | string
    | {
        message?: string;
        status?: string;
        errors?: { reason?: string; message?: string }[];
        details?: { reason?: string; message?: string }[];
      };
  error_description?: string;
}

/** Pull reason, status and message out of a Google API error body. */
export function parseGoogleError(httpStatus: number, body: string): ParsedGoogleError {
  let reason = "";
  let status = "";
  let message = "";
  const trimmed = body.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const json = JSON.parse(trimmed) as GoogleErrorBody;
      const err = json.error;
      if (typeof err === "string") {
        message = err;
      } else if (err && typeof err === "object") {
        message = String(err.message || "");
        status = String(err.status || "");
        const fromErrors = err.errors?.find((item) => item?.reason)?.reason;
        const fromDetails = err.details?.find((item) => item?.reason)?.reason;
        reason = String(fromErrors || fromDetails || "");
      }
      if (!message && json.error_description) message = String(json.error_description);
    } catch {
      message = trimmed.slice(0, 300);
    }
  } else if (trimmed) {
    message = trimmed.slice(0, 300);
  }

  const key = `${reason} ${status} ${message}`.toUpperCase();
  const apiName = apiNameFrom(message);
  let hint: string;
  if (/INSUFFICIENTPERMISSIONS|ACCESS_TOKEN_SCOPE_INSUFFICIENT|INSUFFICIENT_AUTHENTICATION/.test(key)) {
    hint =
      "Google didn't include Drive permission on this sign-in. Tap Sign in again and tick the box that lets Aquarium Shop see, edit and create its own files in Google Drive.";
  } else if (/ACCESSNOTCONFIGURED|SERVICE_DISABLED|API_NOT_ENABLED|CONSUMER_INVALID/.test(key)) {
    hint = apiName
      ? `${apiName} is not enabled on Google Cloud project ${GOOGLE_CLOUD_PROJECT}. Enable it, then sign in again.`
      : `A Google API is not enabled on project ${GOOGLE_CLOUD_PROJECT}. Enable Drive API and Sheets API, then sign in again.`;
  } else if (httpStatus === 403 || /FORBIDDEN/.test(key)) {
    hint = "Google refused this request (forbidden). The reason from Google is under this message.";
  } else if (/RATE|QUOTA|DAILYLIMIT|USERATE/.test(key)) {
    hint = "Google is limiting requests for a few minutes. Wait, then try again.";
  } else {
    hint = `Google could not finish that (${httpStatus}).`;
  }

  const raw = [reason, status, message].filter(Boolean).join(" · ") || `HTTP ${httpStatus}`;
  return { reason, status, message, hint, raw };
}

function apiNameFrom(message: string): string {
  const named = message.match(/([A-Za-z][A-Za-z0-9 .'-]{0,40}API)/);
  if (named) return named[1]!.replace(/\s+/g, " ").trim();
  const host = message.match(/api\/([a-z0-9.]+)/i);
  if (host?.[1]?.includes("sheets")) return "Google Sheets API";
  if (host?.[1]?.includes("drive")) return "Google Drive API";
  return "";
}

export function scopeListIncludes(scope: string | undefined, required: string): boolean {
  return (scope || "").split(/\s+/).filter(Boolean).includes(required);
}

/**
 * True only when this token response includes drive.file.
 * Prefer Google's hasGrantedAllScopes when the sign-in library provides it.
 */
export function driveAccessGranted(
  response: { scope?: string },
  hasGrantedAllScopes?: (tokenResponse: { scope?: string }, ...scopes: string[]) => boolean,
): boolean {
  if (hasGrantedAllScopes) {
    try {
      return hasGrantedAllScopes(response, DRIVE_SCOPE);
    } catch {
      /* use the scope string */
    }
  }
  return scopeListIncludes(response.scope, DRIVE_SCOPE);
}

/** Next Sign in tap should force the consent screen so the Drive box can be ticked. */
export function shouldAskConsentAgain(error: unknown): boolean {
  if (error instanceof DriveAccessError) return true;
  if (error instanceof GoogleApiError) {
    return /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|INSUFFICIENT_AUTHENTICATION/i.test(
      `${error.raw} ${error.message}`,
    );
  }
  return false;
}

export function signInPrompt(askConsentAgain: boolean): "select_account" | "consent" {
  return askConsentAgain ? "consent" : "select_account";
}
