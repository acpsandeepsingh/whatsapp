const SELECTORS = {
  messageBox: [
    'footer [contenteditable="true"][data-tab="10"]',
    'footer [contenteditable="true"][data-tab="1"]',
    'footer div[role="textbox"][contenteditable="true"]'
  ],
  sendButton: ['button[aria-label="Send"]', 'span[data-icon="send"]', 'button span[data-icon="send"]'],
  attachButton: ['button[title="Attach"]', 'div[aria-label="Attach"]', 'span[data-icon="plus-rounded"]'],
  fileInput: ['input[type="file"]', 'input[accept*="image"], input[accept*="video"], input[accept*="*/*"]'],
  participantsContainer: ['div[aria-label*="Participants"]', '#app div[role="application"] div[tabindex="-1"]'],
  participantRows: ['[role="listitem"]', 'div[data-testid="cell-frame-container"]', 'div[tabindex="-1"]']
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(...args) {
  console.log('[WA Bulk][Content]', ...args);
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

function normalizePhone(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

async function waitForElement(selectors, timeoutMs = 25000, pollMs = 250, root = document) {
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
  if (!normalized) throw new Error('Invalid phone number');

  const target = `https://web.whatsapp.com/send?phone=${encodeURIComponent(normalized)}`;
  if (window.location.href !== target) {
    log('Navigating to chat URL for', normalized);
    window.location.href = target;
  }

  const messageBox = await waitForElement(SELECTORS.messageBox, 35000);
  if (!messageBox) throw new Error('Unable to open chat or locate message box');
  return messageBox;
}

async function setMessageAndSend(text) {
  const message = String(text || '').trim();
  if (!message) throw new Error('Message is empty after template processing');

  const box = await waitForElement(SELECTORS.messageBox, 15000);
  if (!box) throw new Error('Message box not found');

  box.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('insertText', false, message);
  box.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await wait(250);

  const sendEl = queryWithFallback(SELECTORS.sendButton);
  if (sendEl) {
    (sendEl.closest('button') || sendEl).click();
  } else {
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }

  await wait(800);
}

async function downloadAttachmentAsFile(url) {
  const response = await fetch(url, { method: 'GET', credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`Attachment download failed (${response.status})`);
  }

  const blob = await response.blob();
  let fileName = `attachment-${Date.now()}.${blob.type.split('/')[1] || 'bin'}`;

  if (!String(url).startsWith('data:')) {
    const parsed = new URL(url, window.location.href);
    const pathname = parsed.pathname.split('/').pop() || `attachment-${Date.now()}`;
    fileName = pathname.includes('.') ? pathname : `${pathname}.${blob.type.split('/')[1] || 'bin'}`;
  }

  return new File([blob], fileName, {
    type: blob.type || 'application/octet-stream',
    lastModified: Date.now()
  });
}

async function uploadAndSendAttachment(file) {
  const attach = queryWithFallback(SELECTORS.attachButton);
  if (!attach) throw new Error('Attachment button not found');

  (attach.closest('button') || attach).click();
  await wait(600);

  const input = await waitForElement(SELECTORS.fileInput, 8000);
  if (!input) throw new Error('File input not found after clicking attach');

  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(1500);

  const sendEl = await waitForElement(SELECTORS.sendButton, 10000);
  if (!sendEl) throw new Error('Send button not found after media upload');

  (sendEl.closest('button') || sendEl).click();
  await wait(1300);
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
    await wait(500);

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

async function sendSingleMessage({ srNo, phone, message, attachmentUrl, attachmentSendingEnabled = true }) {
  log('Processing row', srNo, phone);
  await openChatByPhone(phone);

  if (attachmentSendingEnabled && attachmentUrl) {
    try {
      const file = await downloadAttachmentAsFile(attachmentUrl);
      await uploadAndSendAttachment(file);
      if (message?.trim()) {
        await wait(700);
        await setMessageAndSend(message);
      }
      return { ok: true, mode: 'attachment+text' };
    } catch (error) {
      log('Attachment failed, using fallback', error.message);
      const fallbackText = [message, `Attachment: ${attachmentUrl}`].filter(Boolean).join('\n\n').trim();
      await setMessageAndSend(fallbackText);
      return { ok: true, mode: 'text+attachment-url-fallback', warning: error.message };
    }
  }

  await setMessageAndSend(message);
  return { ok: true, mode: 'text' };
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
  })().catch((error) => {
    log('Handler error', error);
    sendResponse({ ok: false, error: error.message });
  });

  return true;
});
