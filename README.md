# WA Bulk Messenger Pro (Manifest V3)

A Chrome extension for controlled WhatsApp Web bulk messaging with XLS/XLSX import, template personalization, attachment support, queue orchestration, and a full options dashboard.

## Project Structure

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
  options/
    options.html
    options.css
    options.js
  popup/
    popup.html
    popup.css
    popup.js
  services/
    attachment-handler.js
    message-template.js
    settings.js
    xls-parser.js
  utils/
    delay.js
    selectors.js
```

## Features

- ✅ Manifest V3 popup + service worker + content script connection fixed.
- ✅ Options page (`src/options/options.html`) with persistent settings in `chrome.storage`.
- ✅ XLS/XLSX upload and parsing through SheetJS.
- ✅ Preview table with inline message template editing and phone validation.
- ✅ Dynamic variables (`{{number}}`, `{{sr_no}}`, and custom column-based placeholders).
- ✅ Sequential queue engine (pause/resume/stop, retries, progress stats).
- ✅ Attachment send workflow (`fetch -> Blob -> File -> WhatsApp upload`) with fallback.
- ✅ Runtime logs and UI progress updates.

## Load Extension (Load Unpacked)

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository root folder.
5. Open `https://web.whatsapp.com/` and ensure you are logged in.

## Configure Settings (Options Page)

1. Click extension icon.
2. Click **Settings** (top-right), or open extension details -> **Extension options**.
3. Configure:
   - Min/Max delay between messages
   - Random delay toggle
   - Max messages per session
   - Max retries
   - Attachment sending toggle
   - Default message template
4. Click **Save Settings**.

## XLS Import Format

Expected columns (case-insensitive):

- `Sr No`
- `Mobile Number`
- `Message Template`
- `Attachment URL`

You can also add custom columns, and reference them in template placeholders.

Example template:

```text
Hello {{number}}, your ID is {{sr_no}}.
```

Custom column example:

```text
Hi {{customer_name}}, invoice {{invoice_id}} is ready.
```

## Run Automation Safely

1. Keep WhatsApp Web tab open and active.
2. Upload XLS/XLSX in popup.
3. Review table preview:
   - Invalid phone numbers are flagged.
   - Edit message templates inline if needed.
4. Click **Start**.
5. Monitor progress (Sent/Pending/Failed) and logs.
6. Use **Pause/Resume/Stop** as needed.

### Safety recommendations

- Start with a small test batch first.
- Keep delay values conservative.
- Respect WhatsApp and anti-spam policies.
- Use only verified, consented recipient lists.

## Troubleshooting

- **No UI / popup not working**: reload extension in `chrome://extensions`.
- **Automation not starting**: ensure WhatsApp Web tab is open (`https://web.whatsapp.com/*`).
- **Attachment fails**: remote URL may block CORS or be inaccessible; system falls back to text + attachment URL.
- **No contacts scraped**: open group participant list before clicking **Scrape Group Contacts**.
