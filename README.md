# Refrigerator Cabinet Validation System

Starter application using React + Tailwind CSS, Node.js + Express, and Microsoft SQL Server.

## Decisions implemented
- Two fixed workstations: `FREEZER_PRE` and `FREEZER_POST`.
- No login, logout, signup, or user accounts.
- After saving, remain on the selected workstation and reset for the next cabinet.
- Each foaming barcode can be verified once per area: one record in `FREEZER_PRE` and one in `FREEZER_POST` (SQL unique constraint on `foaming_barcode` + `area`).
- Barcode format: `F4` followed by exactly 13 digits.
- NFC values are compared exactly after trimming whitespace.
- Records are inserted only after successful validation and manual Save.
- NFC cards are read directly by the Zebra TC22's built-in NFC reader through Chrome (Web NFC). Keyboard-wedge input still works for desktop PCs.
- The Inner/Outer comparison and the database use the 20-digit serial stored on the card. The card UID is not compared or stored, because two different cards have different UIDs.

## Prerequisites
- Node.js 20+
- Microsoft SQL Server (local or network server)
- SQL Server Management Studio or another SQL client

## 1. Create the database
Run `database/schema.sql` in SQL Server Management Studio, in the database named by `DB_DATABASE` in `backend/.env`. It creates `dbo.cabinet_nfc_verification`.

Note: the Inner NFC column is named `inner_ncf` in the table (as supplied). The backend uses that exact name.

## 2. Start backend
```bash
cd backend
npm install
```
Copy `.env.example` to `.env` and set the SQL Server credentials and connection details. For a named SQL Server instance, configure the correct server/instance connection supported by your environment; the starter uses host plus port.

```bash
npm run dev
```
API: `http://localhost:5000`
Health check: `http://localhost:5000/api/health`

## 3. Start frontend
In another terminal:
```bash
cd frontend
npm install
npm run dev
```
Open the Vite URL shown in the terminal (normally `http://localhost:5173`).

## API
`POST /api/cabinet-scans`

```json
{
  "foamingBarcode": "F41234567890123",
  "innerNfc": "NFC123456",
  "outerNfc": "NFC123456",
  "area": "FREEZER_PRE"
}
```

The API validates all fields again. SQL Server's unique constraint rejects a barcode already saved in the same area (returns HTTP 409), including concurrent requests. The same barcode may still be saved once in the other area.

## Notes before production
- This starter does not include authentication by design. Restrict network access to the factory LAN and the authorized workstation devices; without authentication, anyone who can reach the API can submit data.
- Confirm whether the barcode pattern and NFC case sensitivity match actual production data.
- Confirm the NFC reader model and whether it types into the focused field and appends Enter. If not, add its vendor SDK/bridge integration.
- Test scanner timing, duplicate submissions, SQL connectivity, and workstation behavior on the actual production PCs before go-live.

## Zebra TC22 (Android) setup

### How it works
- **Barcode:** the TC22 scanner types the barcode into the focused field through Zebra DataWedge.
- **NFC:** the app reads the card with Chrome's Web NFC API. The operator holds the card against the back of the device. The app takes the 20-digit serial from the card's NDEF text record (the same data `nfc_tag_new.exe` extracts) and fills Inner NFC, then Outer NFC.
- The old PC reader (`nfc_tag_new.exe`) is not needed on the TC22 and cannot run on Android. It can stay in use on Windows PCs.

### Requirements
1. Chrome on the TC22 (Web NFC is not available in other browsers or WebViews).
2. NFC switched on in Android Settings.
3. The page must be opened over **HTTPS**. Web NFC does not work on plain `http://` addresses.

### HTTPS
The frontend now serves HTTPS (self-signed certificate) and proxies `/api` to the backend, so the tablet only talks to one address:
```bash
cd frontend
npm install
npm run dev        # or: npm run build && npm run preview
```
Open `https://<server-PC-IP>:5173` on the TC22. Keep the backend running on the server PC (port 5000). If the backend is on another machine, start the frontend with `API_TARGET=http://<backend-ip>:5000`.

A self-signed certificate shows a warning in Chrome. Preferred fix: install your company's CA certificate on the TC22 (or use a certificate from your IT team). Fallback: in Chrome open `chrome://flags`, enable **Insecure origins treated as secure**, add the server address (for example `http://192.168.1.50:5173`), and relaunch Chrome. Test NFC on the actual device before go-live.

### DataWedge (barcode scanner)
Create a profile for Chrome (`com.android.chrome`):
- Barcode input: enabled, with Code 128 and any other symbologies your Foaming labels use.
- Keystroke output: enabled, with **Send Enter key** after the data.
- Fields use `inputMode="none"`, so the on-screen keyboard does not pop up when a field gets focus.

### Operator flow
1. Open the workstation. Tap **Enable NFC reader** once (it starts automatically after permission is granted).
2. Scan the Foaming Barcode with the scanner button.
3. Tap the Inner NFC card, then the Outer NFC card.
4. If they match, press **SAVE CABINET**. If not, tap the Outer card again, or press **Clear & rescan**.
- Tapping the same card for both Inner and Outer is rejected. To allow it for testing, set `REJECT_SAME_CARD = false` in `frontend/src/pages/WorkstationPage.jsx`.

## Android APK (Cabinet Validation app for the TC22)

The `android/` folder is a small Android app that opens this web app full-screen and reads NFC cards with the TC22's built-in reader. Compared with Chrome it needs no HTTPS setup and no browser permission prompts.

### Step A: run the server (on the server PC, once)
```bash
cd frontend
npm install
npm run build        # builds the web app into frontend/dist
cd ../backend
npm install
npm start            # serves the web app AND the API on port 5000
```
Find the PC's IP address (`ipconfig`, for example `192.168.1.50`). The app is then at `http://192.168.1.50:5000`. Allow port 5000 through Windows Firewall. Keep SQL Server and `backend/.env` configured as described above.

### Step B: get the APK
**Option 1: no Android Studio (GitHub builds it for you)**
1. Create a free GitHub account and a new private repository.
2. Upload the whole `cabinet-validation` folder contents to it (the `.github` folder must be included).
3. Open the repository, click **Actions**, then **Build Android APK**, then **Run workflow**.
4. When it finishes (about 3 to 5 minutes), open the run and download the **cabinet-validation-apk** artifact. Unzip it to get `app-debug.apk`.

**Option 2: Android Studio**
Open the `android` folder in Android Studio, then **Build > Build Bundle(s) / APK(s) > Build APK(s)**. The file is `android/app/build/outputs/apk/debug/app-debug.apk`.

### Step C: install on the TC22
1. Copy `app-debug.apk` to the TC22 (USB cable, or email/Drive/MDM).
2. On the TC22 open the file (Files app) and tap it. If asked, allow installing from this source.
3. Open **Cabinet Validation**. On first start enter the server address, for example `http://192.168.1.50:5000`, and tap **Connect**. The address is remembered. Change it later from **Server settings** on the first screen.
4. Turn on NFC in Android Settings.

### DataWedge (barcode scanner) for the app
Create or edit a DataWedge profile and associate it with the package `com.factory.cabinetvalidation` (activity `*`): barcode input enabled for your Foaming label type, keystroke output enabled, with **Send Enter key** after the data.
