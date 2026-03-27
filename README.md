# WA Bulk Messenger Pro (Manifest V3)

A Chrome extension for WhatsApp Web automation with a fixed popup, full options dashboard, XLS/XLSX import, row-level personalization, queue controls, and live status tracking.

## Load Extension (Load Unpacked)

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository root folder (`/workspace/whatsapp`).
5. Open `https://web.whatsapp.com/` and ensure you are logged in.

## Popup (Fixed)

Clicking the extension icon now opens a popup with:

- **Open Dashboard** (opens options page in a full tab)
- **Start Automation** (runs campaign from saved dashboard rows)
- **Check Status** (fetches current campaign state)

## Open Dashboard (Options Page)

Use popup → **Open Dashboard**, or Chrome extension details → **Extension options**.

Dashboard includes:

- Editable table with columns:
  - Sr No
  - Mobile Number
  - Message Text
  - Attachment URL (local or remote)
  - Status
- **Add Row** button for manual entry
- XLS/XLSX import via SheetJS
- Inline editing for number/message/attachment URL
- Local file attach per row (stored as data URL)
- Save rows in `chrome.storage.local`

## XLS Import

1. In dashboard, choose an `.xls/.xlsx` file.
2. Click **Import XLS/XLSX**.
3. Table auto-fills from rows.
4. Validation marks bad phone numbers.

Supported headers (case-insensitive aliases):

- `Sr No`
- `Mobile Number`
- `Message Template`
- `Attachment URL`

## Template Variables

Example template:

```text
Hello {{mobile}}, your serial is {{sr_no}}
```

Also supports:

- `{{mobile_number}}`
- `{{number}}`
- Any XLS column key normalized to snake_case (from raw row data)

## Run Auto Sending

1. Keep WhatsApp Web open (`https://web.whatsapp.com/*`).
2. Fill rows manually or import XLS/XLSX.
3. Click **Start Sending**.
4. Use controls:
   - Start
   - Pause
   - Resume
   - Stop
5. Observe live progress + latest log in dashboard.

## Queue / Automation Notes

- Sequential one-by-one processing
- Delay range defaults to 3s–10s (configurable in settings storage)
- Attachment pipeline:
  - Remote URL: fetch → Blob → File → upload/send
  - Local attachment: file picker → data URL → fetch Blob in content script
- Status updates are pushed from service worker to popup/options via runtime messaging

## Troubleshooting

- **Popup not showing**: reload extension in `chrome://extensions`.
- **No send starts**: ensure WhatsApp Web tab is open and logged in.
- **Attachment issue**: remote URL may block fetch; extension falls back to text + URL.
- **No saved rows for popup start**: open dashboard and click **Save Rows** first.
