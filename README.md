# Aquarium Shop

Phone-first billing, stock and GST helper for a small ornamental fish shop in Hyderabad (Telangana) or Vijayawada (Andhra Pradesh). Rohit signs in with his own Gmail. The shop's books are a Google Sheet in **his** Google Drive. Karthik can test with his own Google account first: that data stays in Karthik's Drive and is not copied across.

Live site: https://karthikvepuriphoto-gif.github.io/aquarium-shop/

Demo (this device only, no Google account): https://karthikvepuriphoto-gif.github.io/aquarium-shop/?demo=1#/setup

Shop details form (after sign-in, or in the demo): https://karthikvepuriphoto-gif.github.io/aquarium-shop/#/setup

This is a starter bookkeeping tool. It is **not certified GST software** and **not legal or tax advice**. Ask a CA to check a printed bill and the monthly export before filing returns.

## What it does

- First-run **shop details**: name, address, phone, state (Telangana or Andhra Pradesh), optional GSTIN (check digit), GST type (Regular, Composition, or not registered), bill prefix, UPI ID, optional sample items, optional shop PIN. The same form is in Settings later, and at `#/setup`.
- **Items**: live fish (HSN 0301, exempt by default), dry goods (18% by default), services (SAC 9987, 18%, no stock). Search, filters, low-stock warning. Rates and HSN are editable. Confirm dry-goods rates with the supplier bill or a CA.
- **Stock in** (supplier, city, bill number, cost) and **dead stock / mortality** with a reason and a monthly loss report.
- **New sale** with mixed GST rates. Prices include GST unless Settings says GST is added on top. Another state on the bill uses IGST instead of CGST + SGST.
- Bill headings follow the starter rules: Tax Invoice, Bill of Supply, Invoice-cum-Bill of Supply, or Bill. Composition bills include "Composition taxable person, not eligible to collect tax on supplies".
- **Print / PDF** for A4 or an 80 mm receipt, and **WhatsApp** (`wa.me`) text.
- Cancel keeps the bill number and puts stock back. Numbers look like `RA/26-27/0001`, restart on 1 April, and are not reused.
- **Reports**: daily and monthly sales, GST summary by HSN, stock value, rough profit, dead stock. CSV download or a new Google Sheet for the CA.
- Works offline on the phone. The header says **Saved to Google Drive** or **Waiting to sync**.

## Add it to the home screen

Android (Chrome): open the live link, tap the menu (⋮), then **Install app** or **Add to Home screen**.

iPhone (Safari): open the live link, tap **Share**, then **Add to Home Screen**. Name it Aquarium.

Sign in with Google from the home-screen icon if it asks. If the Google window does not open from the icon, sign in once in the browser first. After that, the sheet is in that Google account and shows up on any phone where the same account signs in.

## Where the data lives

Each signed-in person gets a folder named **Aquarium Shop** and a spreadsheet named **Aquarium Shop - Data (do not rename tabs)**. Tabs: Settings, Items, StockIn, Mortality, Sales, SaleLines, Counters. Settings has a link, **Open your Google Sheet**. Do not rename tabs or edit bill rows by hand. Cancel a bill in the app instead of deleting the row.

The website has no database of its own. `drive.file` only lets the app see files it created. A copy of the books is cached in this browser (IndexedDB) so the counter still works when the network drops. Writes wait in a queue and sync when the connection returns.

Demo mode (`?demo=1`) never calls Google. Sample items and bills stay in this browser.

## Google Cloud setup

The OAuth Web client ID is one public line in [`src/config.ts`](src/config.ts) (`GOOGLE_CLIENT_ID`). It is not a secret. There is no client secret. Sign-in uses Google Identity Services in the browser.

- Google Cloud project: **aquarium-shop-514520**
- OAuth client: Web application, client ID `799269548849-i8iugf22hl1e78ltqjbpmap4o6dojk91.apps.googleusercontent.com`
- Consent screen: **Testing**
- While the app is in Testing, every person who signs in must be added as a test user, including Rohit when he is ready: https://console.cloud.google.com/auth/audience?project=aquarium-shop-514520
- Test user already added: **karthikvepuriphoto@gmail.com**
- Authorized JavaScript origins:
  - `https://karthikvepuriphoto-gif.github.io`
  - `http://localhost:5173`
- Enabled APIs: Google Drive API, Google Sheets API
- Scopes at sign-in: `openid`, `email`, `profile` (`userinfo.email`, `userinfo.profile`), and `https://www.googleapis.com/auth/drive.file`. On the Google consent screen, the Drive box must stay ticked. Aquarium Shop only creates files it can see with `drive.file`; it does not ask for access to the rest of Drive.

If `GOOGLE_CLIENT_ID` is cleared, the app shows a setup message instead of crashing. Replace that one line and redeploy if the client ID ever changes.

A token lasts about an hour. The app asks Google for a new one quietly. If that fails, a large **Sign in again** button is shown. Bills typed while signed out stay on the phone until the next successful sign-in.

## Limitations

- Not certified GST software. Not a filing tool. No e-invoice (IRN) and no e-way bill.
- No udhaar / credit accounts, no input-tax-credit tracking, no supplier ledger.
- Live fish defaults to exempt HSN 0301. Services default to SAC 9987 at 18%. Dry goods default to 18%. Those defaults are editable and should be checked against supplier bills or a CA, especially after rate changes.
- Bill numbers are reserved with a Counters row (read, write a claim id, read it back). If two phones save a bill at the **exact same moment**, both can briefly believe they own the same number. Use one phone at the counter. A cancelled number is never issued again, and the sequence restarts on 1 April.
- The PIN is a cashier lock on this app, not a password on the Google account. Someone who can open the Google Sheet can read the books. The PIN hash is stored in the sheet so a second phone asks for the same PIN.

## Develop

```bash
npm install
npm run dev
```

Open http://localhost:5173/aquarium-shop/ or the demo at http://localhost:5173/aquarium-shop/?demo=1#/setup

```bash
npm test
npm run test:e2e
npm run build
```

Vite + React + TypeScript PWA. The base path is `/aquarium-shop/`. GitHub Actions runs the unit tests, Playwright (demo mode at 390×844 and 820×1180), and publishes `main` to GitHub Pages.

Icons: `python3 scripts/make_icons.py`.
