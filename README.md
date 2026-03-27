# WA Bulk Messenger Pro (Chrome Extension - Manifest V3)

> Educational automation scaffold for WhatsApp Web workflow orchestration.

## Features

- Extract WhatsApp group contacts (name + phone) using content-script auto-scroll.
- Upload XLS/XLSX-compatible tabular data (required columns below).
- Queue-based messaging with randomized delays (3–10 sec configurable).
- Personalized message templating with `{{Sr No}}` and `{{Mobile Number}}` placeholders.
- URL attachment workflow:
  - Download from URL with `fetch`
  - Convert to `Blob` -> `File`
  - Upload in WhatsApp chat and send
- Retry engine + error handling.
- Fallback behavior: if attachment fails, sends plain message with attachment URL.
- Popup dashboard with start/pause/resume/stop + progress tracking.

## Folder Structure

```text
manifest.json
libs/
  xlsx.full.min.js
samples/
  sample-bulk-format.csv
src/
  background/
    service-worker.js
  content/
    whatsapp-content.js
  popup/
    popup.html
    popup.css
    popup.js
  services/
    attachment-handler.js
    message-template.js
    xls-parser.js
  utils/
    delay.js
    selectors.js
```

## Required Input Columns

The parser expects these headers (case-insensitive fallbacks included):

1. `Sr No`
2. `Mobile Number`
3. `Message Template`
4. `Attachment URL`

See `samples/sample-bulk-format.csv`.

## Installation

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this repository root.
5. Open `https://web.whatsapp.com/` and keep it logged in.

## Usage

1. Click extension icon -> popup opens.
2. Upload your `.xls/.xlsx` file (or CSV while using bundled shim).
3. Configure min/max delay + retry count.
4. Click **Start**.
5. Use **Pause**, **Resume**, or **Stop** as needed.
6. Optional: click **Scrape Group Contacts** then download contacts JSON.

## Important Notes

- WhatsApp Web DOM changes frequently; selector fallback arrays are used in `src/utils/selectors.js`.
- This repo includes a lightweight local `libs/xlsx.full.min.js` shim for offline environments.
  - For production-grade XLS/XLSX support, replace `libs/xlsx.full.min.js` with the official SheetJS distribution file.
- Use responsibly and comply with WhatsApp policies and local anti-spam laws.

## Development Notes

- Background orchestration: `src/background/service-worker.js`
- DOM automation and contact scrape: `src/content/whatsapp-content.js`
- Parser and attachment conversion logic: `src/services/*`

## Troubleshooting

- **"Open WhatsApp Web in a tab first"**: ensure a tab with `https://web.whatsapp.com/*` is open.
- **Attachment upload fails**: URL may block CORS or file type may be unsupported by WhatsApp; engine falls back to URL text.
- **No contacts scraped**: open a group participant view before triggering scrape.
