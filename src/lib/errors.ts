export class AuthExpiredError extends Error {
  constructor() {
    super("Sign in again to save to Google Drive.");
    this.name = "AuthExpiredError";
  }
}

export class OfflineError extends Error {
  constructor() {
    super("You are offline. The change is saved on this phone and will sync when you are back online.");
    this.name = "OfflineError";
  }
}
