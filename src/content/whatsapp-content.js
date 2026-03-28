const ACTIONS = Object.freeze({
  GET_GROUPS: 'GET_GROUPS',
  FETCH_CONTACTS: 'FETCH_CONTACTS',
  START_AUTOMATION: 'START_AUTOMATION',
  SEND_MESSAGE: 'SEND_MESSAGE',
  SAVE_SETTINGS: 'SAVE_SETTINGS',
  LOAD_SETTINGS: 'LOAD_SETTINGS',
  UPDATE_PROGRESS: 'UPDATE_PROGRESS',
  GET_PROGRESS: 'GET_PROGRESS',
  OPEN_DASHBOARD: 'OPEN_DASHBOARD',
  OPEN_CHAT: 'OPEN_CHAT',
  SCRAPE_GROUP: 'SCRAPE_GROUP',
  START_CAMPAIGN_FROM_STORAGE: 'START_CAMPAIGN_FROM_STORAGE',
  PAUSE_AUTOMATION: 'PAUSE_AUTOMATION',
  RESUME_AUTOMATION: 'RESUME_AUTOMATION',
  STOP_AUTOMATION: 'STOP_AUTOMATION',
  GET_CHAT_SNAPSHOT: 'GET_CHAT_SNAPSHOT',
  PING: 'PING'
});

function getAction(message = {}) {
  return message.action || message.type || '';
}

if (window.__WA_CRM_CONTENT_SCRIPT_READY__) {
  console.log('[WA CRM][Content] Duplicate injection ignored.');
} else {
  window.__WA_CRM_CONTENT_SCRIPT_READY__ = true;

const SELECTORS = {
  appReady: ['#app'],
  paneSide: ['#pane-side'],
  chatSearchInputs: [
    'div[role="search"] [contenteditable="true"]',
    'div[aria-label="Search input textbox"][contenteditable="true"]',
    '[data-testid="chat-list-search"] [contenteditable="true"]',
    '[contenteditable="true"][data-tab="3"]',
    'aside [role="textbox"][contenteditable="true"]'
  ],
  sidebarChatRows: [
    '#pane-side [role="listitem"]',
    '#pane-side div[data-testid="cell-frame-container"]',
    '#pane-side > div > div > div > div'
  ],
  chatHeaderTitle: ['header [title]', 'header h1 span[title]', 'header h2 span[title]'],
  messageBox: [
    'footer [contenteditable="true"][data-tab="10"]',
    'footer [contenteditable="true"][data-tab="1"]',
    'footer div[role="textbox"][contenteditable="true"]'
  ],
  sendButton: ['button[aria-label="Send"]', 'span[data-icon="send"]', 'button span[data-icon="send"]'],
  attachButton: ['button[title="Attach"]', 'div[aria-label="Attach"]', 'span[data-icon="plus-rounded"]'],
  fileInput: ['input[type="file"]', 'input[accept*="image"], input[accept*="video"], input[accept*="*/*"]'],
  chatHeaderClickable: ['header [title]', 'header h1', 'header [data-testid="conversation-info-header"]'],
  groupInfoHeading: ['[aria-label*="Group info"]', '[title="Group info"]', 'div[data-testid="drawer-header"]'],
  participantsContainer: [
    '[aria-label*="Participants"] [tabindex="-1"]',
    '[aria-label*="Participants"]',
    'div[data-testid="group-participants"]',
    'div[role="dialog"] [tabindex="-1"]'
  ],
  participantRows: ['[aria-label*="Participants"] [role="listitem"]', 'div[data-testid="cell-frame-container"]', '[role="listitem"]'],
  closePanelButtons: ['button[aria-label="Back"]', 'span[data-icon="back"]', 'button[title="Back"]']
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(...args) {
  console.log('[WA CRM][Content]', ...args);
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
    const els = [...root.querySelectorAll(selector)].filter(Boolean);
    if (els.length) return els;
  }
  return [];
}

function normalizePhone(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

function extractCountryCode(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return '';

  const commonCodes = ['1', '7', '20', '27', '30', '31', '32', '33', '34', '39', '40', '41', '44', '49', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66', '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98'];
  for (const code of commonCodes.sort((a, b) => b.length - a.length)) {
    if (digits.startsWith(code) && digits.length > code.length + 5) {
      return `+${code}`;
    }
  }

  return `+${digits.slice(0, Math.min(3, digits.length))}`;
}

function setEditableValue(el, value) {
  el.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);
  document.execCommand('insertText', false, value);
  el.dispatchEvent(new InputEvent('input', { bubbles: true }));
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

async function ensureWhatsAppReady() {
  const app = await waitForElement(SELECTORS.appReady, 25000);
  if (!app) throw new Error('WhatsApp UI not loaded yet.');
  const paneSide = await waitForElement(SELECTORS.paneSide, 30000);
  if (!paneSide) throw new Error('WhatsApp chat list is not ready yet (#pane-side missing).');
  const search = await waitForElement(SELECTORS.chatSearchInputs, 30000);
  if (!search) throw new Error('Unable to locate WhatsApp search input in sidebar.');
  return { app, paneSide, search };
}

function detectChatTypeFromRow(row) {
  const text = row.textContent || '';
  const title = row.querySelector('[title]')?.getAttribute('title') || '';
  const isGroup = Boolean(
    row.querySelector('[data-icon="group"]') ||
      row.querySelector('[data-testid*="group"]') ||
      /\bgroup\b/i.test(row.getAttribute('data-testid') || '') ||
      (text.match(/,/g) || []).length >= 2
  );

  const phoneMatch = `${title} ${text}`.match(/\+?\d[\d\s()-]{6,}/);
  const phone = phoneMatch ? normalizePhone(phoneMatch[0]) : '';

  return {
    name: title.trim() || text.trim().split('\n')[0] || 'Unknown',
    phone,
    countryCode: phone ? extractCountryCode(phone) : '',
    isGroup,
    unreadCount: row.querySelector('[aria-label*="unread" i]') ? 1 : 0,
    labels: []
  };
}

async function gatherSidebarData() {
  await ensureWhatsAppReady();
  const rows = queryAllWithFallback(SELECTORS.sidebarChatRows).filter((row) => row.textContent?.trim());
  const map = new Map();

  rows.forEach((row) => {
    const chat = detectChatTypeFromRow(row);
    const key = `${chat.name}|${chat.phone}`;
    if (!map.has(key)) {
      map.set(key, chat);
    }
  });

  const chats = [...map.values()];
  const groups = chats.filter((c) => c.isGroup).map((c) => c.name).sort((a, b) => a.localeCompare(b));
  const labels = [];
  const countryCodes = [...new Set(chats.map((c) => c.countryCode).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  return { chats, groups, labels, countryCodes };
}

function filterChats(snapshot = {}, filter = {}) {
  const chats = Array.isArray(snapshot.chats) ? snapshot.chats : [];
  const primary = filter.primary || 'all_contacts';
  const secondary = filter.secondary || '';

  if (primary === 'all_contacts') {
    if (secondary === 'unread_chats') return chats.filter((chat) => Number(chat.unreadCount) > 0);
    if (secondary === 'read_chats') return chats.filter((chat) => Number(chat.unreadCount) === 0);
    return chats;
  }
  if (primary === 'group') return chats.filter((chat) => chat.isGroup && (!secondary || chat.name === secondary));
  if (primary === 'country') return chats.filter((chat) => chat.countryCode === secondary);

  return chats;
}

async function openChatBySearch(queryValue) {
  const query = String(queryValue || '').trim();
  if (!query) throw new Error('Missing contact/group search query.');

  await ensureWhatsAppReady();
  const searchBox = await waitForElement(SELECTORS.chatSearchInputs, 12000);
  if (!searchBox) throw new Error('Search box not found in WhatsApp sidebar.');

  setEditableValue(searchBox, query);
  await wait(600);

  const sideRows = queryAllWithFallback(SELECTORS.sidebarChatRows).filter((row) => row.textContent?.trim());
  const normalizedQuery = query.toLowerCase();

  const candidate =
    sideRows.find((row) => (row.textContent || '').toLowerCase().includes(normalizedQuery)) ||
    sideRows.find((row) => normalizePhone(row.textContent || '').includes(normalizePhone(query)));

  if (candidate) {
    candidate.click();
  } else {
    searchBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  }

  await wait(700);

  setEditableValue(searchBox, '');
  searchBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));

  const messageBox = await waitForElement(SELECTORS.messageBox, 16000);
  if (!messageBox) throw new Error(`Unable to open chat for query: ${query}`);
  return messageBox;
}

async function openChatByPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error('Invalid phone number');
  return openChatBySearch(normalized);
}

async function setMessageAndSend(text) {
  const message = String(text || '').trim();
  if (!message) throw new Error('Message is empty after template processing');

  const box = await waitForElement(SELECTORS.messageBox, 15000);
  if (!box) throw new Error('Message box not found');

  setEditableValue(box, message);
  await wait(250);

  const sendEl = queryWithFallback(SELECTORS.sendButton);
  if (sendEl) {
    (sendEl.closest('button') || sendEl).click();
  } else {
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }

  await wait(900);
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
  await wait(1800);

  const sendEl = await waitForElement(SELECTORS.sendButton, 10000);
  if (!sendEl) throw new Error('Send button not found after media upload');

  (sendEl.closest('button') || sendEl).click();
  await wait(1400);
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

async function openGroupInfo(groupName) {
  await openChatBySearch(groupName);

  const header = await waitForElement(SELECTORS.chatHeaderClickable, 8000);
  if (!header) {
    throw new Error('Chat header not found while opening group info.');
  }

  (header.closest('button') || header).click();
  const panel = await waitForElement(SELECTORS.groupInfoHeading, 8000);
  if (!panel) {
    throw new Error('Group info panel did not open.');
  }

  await wait(500);
}

async function scrapeGroupContacts(groupName) {
  if (groupName) {
    await openGroupInfo(groupName);
  }

  const panel = (await waitForElement(SELECTORS.participantsContainer, 12000)) || document.body;
  const discovered = new Map();

  let unchangedScrolls = 0;
  let previousCount = 0;

  for (let i = 0; i < 45; i += 1) {
    const rows = queryAllWithFallback(SELECTORS.participantRows, panel);
    rows.forEach((row) => {
      const contact = readContactFromRow(row);
      if (contact.phone) discovered.set(contact.phone, contact);
    });

    panel.scrollTop = panel.scrollHeight;
    await wait(400);

    if (discovered.size === previousCount) {
      unchangedScrolls += 1;
      if (unchangedScrolls >= 5) break;
    } else {
      unchangedScrolls = 0;
    }

    previousCount = discovered.size;
  }

  const back = queryWithFallback(SELECTORS.closePanelButtons);
  if (back) {
    (back.closest('button') || back).click();
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
      return { success: true, mode: 'attachment+text' };
    } catch (error) {
      log('Attachment failed, using fallback', error.message);
      const fallbackText = [message, `Attachment: ${attachmentUrl}`].filter(Boolean).join('\n\n').trim();
      await setMessageAndSend(fallbackText);
      return { success: true, mode: 'text+attachment-url-fallback', warning: error.message };
    }
  }

  await setMessageAndSend(message);
  return { success: true, mode: 'text' };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    const action = getAction(message);
    log('ACTION:', action, message);

    if (action !== ACTIONS.PING) {
      await ensureWhatsAppReady();
    }

    switch (action) {
      case ACTIONS.PING:
        sendResponse({ success: true });
        break;
      case ACTIONS.GET_CHAT_SNAPSHOT: {
        const snapshot = await gatherSidebarData();
        sendResponse({ success: true, ...snapshot });
        break;
      }
      case ACTIONS.GET_GROUPS: {
        const snapshot = await gatherSidebarData();
        sendResponse({ success: true, groups: snapshot.groups });
        break;
      }
      case ACTIONS.FETCH_CONTACTS: {
        const snapshot = await gatherSidebarData();
        const contacts = filterChats(snapshot, message.filter || {});
        sendResponse({ success: true, data: contacts, snapshot });
        break;
      }
      case ACTIONS.SCRAPE_GROUP: {
        const contacts = await scrapeGroupContacts(message.groupName || '');
        sendResponse({ success: true, data: contacts });
        break;
      }
      case ACTIONS.OPEN_CHAT: {
        await openChatBySearch(message.query || message.phone || '');
        sendResponse({ success: true });
        break;
      }
      case ACTIONS.SEND_MESSAGE: {
        const result = await sendSingleMessage(message.data || {});
        sendResponse(result);
        break;
      }
      default:
        sendResponse({ success: false, error: `Unknown content action: ${action || 'undefined'}` });
    }
  })().catch((error) => {
    log('Handler error', error);
    sendResponse({ success: false, error: error.message });
  });

  return true;
});
}
