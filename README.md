# WA CRM Automation Extension (Manifest V3)

A production-oriented WhatsApp Web automation Chrome extension with DOM-only sending (no tab navigation/reload), contact filters, group participant scraping, XLS import, template variables, and campaign queue controls.

## Key Stability Fix (Reload Issue)

This build **does not use `wa.me` or `web.whatsapp.com/send?phone=...` navigation** during automation.

Instead, every send action stays inside the same WhatsApp Web tab and uses DOM steps only:

1. Use sidebar search box.
2. Open chat from search results.
3. Fill message input.
4. Upload/send attachment if provided.
5. Send and continue queue.

This prevents the previous repeated reload/navigation bug during bulk sending.

## Features Implemented

### 1) Contact Filter Engine

Primary filter:
- All Contacts
- All Chats
- Unread Chats
- Read Chats
- From Specific Group
- From Specific Label
- From Specific Country

Secondary filter is dynamic:
- Groups list from sidebar snapshot
- Labels (if available)
- Country codes inferred from detected phone numbers

Use **Sync Chats** first, then **Apply Filter to Table**.

### 2) Group Auto Scraper

- Detect group names from WhatsApp sidebar data.
- Select a group from filter.
- Click **Scrape Group Members**:
  - Opens group chat via search
  - Opens group info panel
  - Scrolls participant list
  - Extracts name + phone
  - Deduplicates by phone

### 3) XLS + Editable Table System

- Import `.xls/.xlsx` with SheetJS.
- Columns:
  - Sr No
  - Mobile Number
  - Name
  - Message Template
  - Attachment URL
- Inline editable cells.
- Add row manually.
- Per-row local file attach (stored as data URL).
- Phone validation with status badges.

### 4) Template Engine

Supports:
- `{{sr_no}}`
- `{{mobile}}`
- `{{name}}`

Also supports normalized XLS column keys (snake_case).

### 5) Stable Auto-Send Engine

Queue worker in service worker + DOM automation in content script:
- opens chat by sidebar search (no navigation)
- injects personalized message
- fetches remote attachment URL -> Blob -> File -> file input upload
- sends message
- random delay between min/max settings (3s–10s default)

### 6) Queue + Controls

- Sequential queue
- Start / Pause / Resume / Stop
- Retry failed rows (max retries configurable)
- Progress tracking (Sent / Pending / Failed / Retries)

### 7) Options Dashboard

- Full options page for table + import + controls + settings
- Settings:
  - min delay
  - max delay
  - random delay toggle
  - max messages per session
  - max retries
  - attachment enable/disable
  - default template

## IndexedDB Contact Export Mapping

When **All Contacts → All Chats** is selected from popup filters, the extension reads WhatsApp Web IndexedDB (`model-storage`) and maps records as follows:

- Stores scanned:
  - `contact` (contact records)
  - `chat`, `group-metadata`, `group` (group-like stores used for membership/name lookup)
- Contact ID (JID) detection:
  1. First string value ending with `@c.us`
  2. Otherwise first string containing `@`
- Exported columns:
  - `Sr No`: row index + 1
  - `Mobile No`: `jid.split('@')[0]`
  - `Saved Name`: `name || shortName`
  - `Public Name`: `pushname`
  - `Groups`: all matching group names joined by ` | `
- Group name field priority:
  - `name`, `subject`, `title`, `formattedTitle`, `displayName`

This keeps output resilient across small shape differences in WhatsApp's internal object stores.

## Setup (Load Unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repo root (`/workspace/whatsapp`).
5. Open `https://web.whatsapp.com/` and log in.

## How to Use

1. Open extension popup -> **Open Dashboard**.
2. Optional: click **Sync Chats**.
3. Pick filter + secondary value (if required).
4. Click **Apply Filter to Table** or import XLS.
5. Adjust settings.
6. Click **Start**.
7. Use Pause/Resume/Stop as needed.

## Safe Automation Notes

- Keep one WhatsApp Web tab open and logged in.
- Do not manually navigate away while queue is running.
- Use conservative delays to reduce risk.
- Verify message templates and attachments before large runs.

## Troubleshooting

- **"Open WhatsApp Web in a tab first"**: open `https://web.whatsapp.com/`.
- **No chat sync data**: WhatsApp may still be loading; wait and click Sync again.
- **Attachment fallback**: if URL blocks download/CORS, extension sends text + attachment URL fallback.
- **Group scrape empty**: participant details vary by account privacy and WhatsApp UI changes.
