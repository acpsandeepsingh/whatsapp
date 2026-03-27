const SELECTORS = {
  messageBox: [
    'footer [contenteditable="true"][data-tab="10"]',
    'footer [contenteditable="true"][data-tab="1"]',
    'footer div[role="textbox"][contenteditable="true"]'
  ],
  sendButton: [
    'button[aria-label="Send"]',
    'span[data-icon="send"]',
    'button span[data-icon="send"]'
  ],
  attachButton: [
    'button[title="Attach"]',
    'div[aria-label="Attach"]',
    'span[data-icon="plus-rounded"]'
  ],
  fileInput: [
    'input[type="file"]',
    'input[accept*="image"], input[accept*="video"], input[accept*="*/*"]'
  ],
  participantsContainer: [
    'div[aria-label*="Participants"]',
    '#app div[role="application"] div[tabindex="-1"]'
  ],
  participantRows: [
    '[role="listitem"]',
    'div[data-testid="cell-frame-container"]',
    'div[tabindex="-1"]'
  ]
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizePhone(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

function buildPersonalizedMessage(template, row) {
  const safeTemplate = String(template || '');
  return safeTemplate
    .replace(/\{\{\s*sr\s*no\s*\}\}/gi, row.srNo ?? '')
    .replace(/\{\{\s*mobile\s*number\s*\}\}/gi, row.phone ?? '')
    .trim();
}

function queryWithFallback(selectors, root = document) {
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    if (el) return el;
  }
  return null;
}

function queryAllWithFallback(selectors, root = document) {
  for (const selector of selectors) {
    const els = [...root.querySelectorAll(selector)];
    if (els.length) return els;
  }
  return [];
}

async function downloadAttachmentAsFile(url) {
  const response = await fetch(url, { method: 'GET', credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`Attachment download failed (${response.status})`);
  }

  const blob = await response.blob();
  const parsed = new URL(url, window.location.href);
  const pathname = parsed.pathname.split('/').pop() || `attachment-${Date.now()}`;
  const hasExt = pathname.includes('.');
  const fileName = hasExt ? pathname : `${pathname}.${blob.type.split('/')[1] || 'bin'}`;

  return new File([blob], fileName, {
    type: blob.type || 'application/octet-stream',
    lastModified: Date.now()
  });
}

async function waitForElement(selectors, timeoutMs = 20000, pollMs = 250, root = document) {
  const maxTries = Math.ceil(timeoutMs / pollMs);
  for (let i = 0; i < maxTries; i += 1) {
    const found = queryWithFallback(selectors, root);
    if (found) return found;
    await wait(pollMs);
  }
  return null;
}

async function openChatByPhone(phone) {
  const normalized = normalizePhone(phone);
  const target = `https://web.whatsapp.com/send?phone=${encodeURIComponent(normalized)}`;
  if (window.location.href !== target) {
    window.location.href = target;
  }

  const messageBox = await waitForElement(SELECTORS.messageBox, 30000);
  if (!messageBox) throw new Error('Unable to open chat or message box not found.');
  return messageBox;
}

async function setMessageAndSend(text) {
  const box = await waitForElement(SELECTORS.messageBox, 20000);
  if (!box) throw new Error('Message box not found.');

  box.focus();
  document.execCommand('insertText', false, text);
  await wait(200);

  const sendEl = queryWithFallback(SELECTORS.sendButton);
  if (sendEl) {
    sendEl.closest('button')?.click();
    sendEl.click();
  } else {
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }
}

async function uploadAndSendAttachment(file) {
  const attach = queryWithFallback(SELECTORS.attachButton);
  if (!attach) throw new Error('Attachment button not found.');

  attach.closest('button')?.click();
  attach.click();
  await wait(800);

  const input = await waitForElement(SELECTORS.fileInput, 8000);
  if (!input) throw new Error('File input not found after clicking attach.');

  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));

  await wait(1500);

  const sendEl = queryWithFallback(SELECTORS.sendButton);
  if (!sendEl) throw new Error('Send button not visible after file upload.');

  sendEl.closest('button')?.click();
  sendEl.click();
  await wait(1200);
}

function readContactFromRow(row) {
  const titleNode = row.querySelector('[title]');
  const text = titleNode?.getAttribute('title') || row.textContent || '';
  const phoneMatch = text.match(/\+?\d[\d\s-]{6,}/);
  return {
    name: titleNode?.textContent?.trim() || text.trim() || 'Unknown',
    phone: phoneMatch ? normalizePhone(phoneMatch[0]) : ''
  };
}

async function scrapeGroupContacts() {
  const panel = queryWithFallback(SELECTORS.participantsContainer) || document.body;
  const discovered = new Map();

  let unchangedScrolls = 0;
  let previousCount = 0;

  for (let i = 0; i < 30; i += 1) {
    const rows = queryAllWithFallback(SELECTORS.participantRows, panel);
    rows.forEach((row) => {
      const contact = readContactFromRow(row);
      if (contact.phone) discovered.set(contact.phone, contact);
    });

    panel.scrollTop = panel.scrollHeight;
    await wait(550);

    if (discovered.size === previousCount) {
      unchangedScrolls += 1;
      if (unchangedScrolls >= 4) break;
    } else {
      unchangedScrolls = 0;
    }

    previousCount = discovered.size;
  }

  return [...discovered.values()];
}

async function sendSingleMessage({ srNo, phone, message, attachmentUrl }) {
  await openChatByPhone(phone);
  const personalized = buildPersonalizedMessage(message, { srNo, phone });

  let attachmentError = null;

  if (attachmentUrl) {
    try {
      const file = await downloadAttachmentAsFile(attachmentUrl);
      await uploadAndSendAttachment(file);
      if (personalized.trim()) {
        await wait(650);
        await setMessageAndSend(personalized);
      }
      return { ok: true, mode: 'attachment+text' };
    } catch (error) {
      attachmentError = error;
    }
  }

  const fallbackText = attachmentUrl
    ? `${personalized}\n\nAttachment: ${attachmentUrl}`.trim()
    : personalized;

  await setMessageAndSend(fallbackText);

  return {
    ok: true,
    mode: attachmentUrl && attachmentError ? 'text+url-fallback' : 'text',
    warning: attachmentError?.message
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case 'PING':
        sendResponse({ ok: true });
        break;
      case 'SCRAPE_CONTACTS': {
        const contacts = await scrapeGroupContacts();
        sendResponse(contacts);
        break;
      }
      case 'SEND_MESSAGE': {
        const result = await sendSingleMessage(message.data);
        sendResponse(result);
        break;
      }
      default:
        sendResponse({ ok: false, error: 'Unsupported content action' });
    }
  })().catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});
