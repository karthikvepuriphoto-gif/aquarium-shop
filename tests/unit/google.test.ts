import { test } from "vitest";
import assert from "node:assert/strict";
import { DRIVE_SCOPE } from "../../src/config";
import {
  DriveAccessError,
  GoogleApiError,
  driveAccessGranted,
  parseGoogleError,
  shouldAskConsentAgain,
  signInPrompt,
} from "../../src/lib/googleError";

const scopeBody = JSON.stringify({
  error: {
    code: 403,
    message: "Request had insufficient authentication scopes.",
    status: "PERMISSION_DENIED",
    errors: [
      {
        message: "Insufficient Permission",
        domain: "global",
        reason: "insufficientPermissions",
      },
    ],
  },
});

test("403 insufficientPermissions names the Drive consent box and keeps the raw reason", () => {
  const parsed = parseGoogleError(403, scopeBody);
  assert.equal(parsed.reason, "insufficientPermissions");
  assert.equal(parsed.status, "PERMISSION_DENIED");
  assert.match(parsed.hint, /tick the box/);
  assert.match(parsed.hint, /Drive/);
  assert.match(parsed.raw, /insufficientPermissions/);
  assert.match(parsed.raw, /PERMISSION_DENIED/);
  assert.match(parsed.raw, /insufficient authentication scopes/i);
});

test("ACCESS_TOKEN_SCOPE_INSUFFICIENT is treated as a missing Drive tick", () => {
  const parsed = parseGoogleError(
    403,
    JSON.stringify({
      error: {
        status: "PERMISSION_DENIED",
        message: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
        errors: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }],
      },
    }),
  );
  assert.equal(parsed.reason, "ACCESS_TOKEN_SCOPE_INSUFFICIENT");
  assert.match(parsed.hint, /Drive permission/);
  assert.match(parsed.raw, /ACCESS_TOKEN_SCOPE_INSUFFICIENT/);
});

test("accessNotConfigured names the API and the Cloud project", () => {
  const parsed = parseGoogleError(
    403,
    JSON.stringify({
      error: {
        code: 403,
        message:
          "Google Sheets API has not been used in project 799269548849 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=799269548849",
        status: "PERMISSION_DENIED",
        errors: [{ reason: "accessNotConfigured", message: "Google Sheets API has not been used" }],
      },
    }),
  );
  assert.equal(parsed.reason, "accessNotConfigured");
  assert.match(parsed.hint, /Google Sheets API/);
  assert.match(parsed.hint, /aquarium-shop-514520/);
  assert.match(parsed.raw, /accessNotConfigured/);
});

test("SERVICE_DISABLED is the same disabled-API case", () => {
  const parsed = parseGoogleError(
    403,
    JSON.stringify({
      error: {
        status: "SERVICE_DISABLED",
        message: "Google Drive API has not been used in project aquarium-shop-514520 before or it is disabled.",
        errors: [{ reason: "SERVICE_DISABLED" }],
      },
    }),
  );
  assert.match(parsed.hint, /Google Drive API/);
  assert.match(parsed.hint, /aquarium-shop-514520/);
  assert.match(parsed.raw, /SERVICE_DISABLED/);
});

test("a plain forbidden 403 still shows Google's reason", () => {
  const parsed = parseGoogleError(
    403,
    JSON.stringify({
      error: {
        code: 403,
        message: "The user does not have sufficient permissions for this file.",
        errors: [{ reason: "forbidden", message: "The user does not have sufficient permissions for this file." }],
      },
    }),
  );
  assert.equal(parsed.reason, "forbidden");
  assert.match(parsed.hint, /forbidden/i);
  assert.match(parsed.raw, /forbidden/);
  assert.match(parsed.raw, /sufficient permissions/);
});

test("non-JSON bodies stay visible instead of being dropped", () => {
  const parsed = parseGoogleError(500, "backend exploded");
  assert.match(parsed.raw, /backend exploded/);
  assert.match(parsed.hint, /500/);
});

test("hasGrantedAllScopes false blocks Drive even if a scope string is present", () => {
  const response = { scope: `openid email ${DRIVE_SCOPE}` };
  assert.equal(
    driveAccessGranted(response, () => false),
    false,
  );
});

test("hasGrantedAllScopes true allows Drive", () => {
  assert.equal(
    driveAccessGranted({ scope: "" }, () => true),
    true,
  );
});

test("without the Google helper, the scope string decides", () => {
  assert.equal(driveAccessGranted({ scope: `openid email ${DRIVE_SCOPE}` }), true);
  assert.equal(driveAccessGranted({ scope: "openid email profile" }), false);
  assert.equal(driveAccessGranted({}), false);
});

test("a thrown scope checker falls back to the scope string", () => {
  assert.equal(
    driveAccessGranted({ scope: `openid ${DRIVE_SCOPE}` }, () => {
      throw new Error("gis");
    }),
    true,
  );
  assert.equal(
    driveAccessGranted({ scope: "openid email" }, () => {
      throw new Error("gis");
    }),
    false,
  );
});

test("missing Drive access asks for the consent screen on the next tap", () => {
  assert.equal(shouldAskConsentAgain(new DriveAccessError()), true);
  assert.equal(signInPrompt(true), "consent");
  assert.equal(signInPrompt(false), "select_account");
  const api = new GoogleApiError("tick the box", "insufficientPermissions · PERMISSION_DENIED");
  assert.equal(shouldAskConsentAgain(api), true);
  assert.equal(shouldAskConsentAgain(new GoogleApiError("forbidden", "forbidden · no")), false);
  assert.equal(shouldAskConsentAgain(new Error("network")), false);
});
