(() => {
  if (globalThis.__WA_CRM_CONTENT_SCRIPT_READY__) {
    console.log('[WA CRM][Content] Duplicate injection ignored.');
    return;
  }
  globalThis.__WA_CRM_CONTENT_SCRIPT_READY__ = true;

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

const SELECTORS = {
  appReady: ['#app'],
  paneSide: ['#pane-side'],
  chatSearchInputs: [
    '[data-testid="chat-list-search"] [contenteditable="true"]',
    '[data-testid="chat-list-search"] [role="textbox"]',
    '[aria-label="Search input textbox"][contenteditable="true"]',
    '[contenteditable="true"][data-tab="3"]',
    'aside [role="textbox"][contenteditable="true"]',
    'div[role="search"] [contenteditable="true"]'
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
SELECTORS.filterTabs = {
  all: ['button#all-filter', 'button[role="tab"][id="all-filter"]'],
  unread: ['button#unread-filter', 'button[role="tab"][id="unread-filter"]'],
  favorites: ['button#favorites-filter', 'button[role="tab"][id="favorites-filter"]'],
  additional: ['button#additional-filters', 'button[role="tab"][id="additional-filters"]']
};
SELECTORS.additionalFilterMenuItems = ['[role="menuitem"]', 'div[role="option"]'];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(...args) {
  console.log('[WA CRM][Content]', ...args);
}

function summarizeElementForLog(node) {
  if (!(node instanceof Element)) return 'non-element target';

  const label = node.getAttribute('aria-label') || node.getAttribute('title') || '';
  const testId = node.getAttribute('data-testid') || '';
  const role = node.getAttribute('role') || '';
  const className = String(node.className || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join('.');

  let text = (node.textContent || '').replace(/\s+/g, ' ').trim();
  if (text.length > 80) text = `${text.slice(0, 77)}...`;

  const parts = [
    node.tagName?.toLowerCase() || 'unknown',
    node.id ? `#${node.id}` : '',
    className ? `.${className}` : '',
    role ? `[role="${role}"]` : '',
    label ? `[label="${label}"]` : '',
    testId ? `[data-testid="${testId}"]` : '',
    text ? `text="${text}"` : ''
  ].filter(Boolean);

  return parts.join('');
}

function setupWhatsAppInteractionDebugLogs() {
  if (globalThis.__WA_CRM_CLICK_LOGGING_READY__) return;
  globalThis.__WA_CRM_CLICK_LOGGING_READY__ = true;

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const clickable = target?.closest('button, [role="button"], [role="option"], [data-testid], [title], [aria-label]');
      const summary = summarizeElementForLog(clickable || target);
      log('[Debug][Click]', summary);
    },
    true
  );

  if (!globalThis.__WA_CRM_FETCH_PATCHED__ && typeof window.fetch === 'function') {
    globalThis.__WA_CRM_FETCH_PATCHED__ = true;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const [resource, config = {}] = args;
      const url = typeof resource === 'string' ? resource : resource?.url || 'unknown-url';
      const method = (config?.method || (typeof resource !== 'string' && resource?.method) || 'GET').toUpperCase();
      const startedAt = performance.now();
      log('[Debug][Fetch][Start]', { method, url });
      try {
        const response = await originalFetch(...args);
        const durationMs = Math.round(performance.now() - startedAt);
        log('[Debug][Fetch][Done]', { method, url, status: response.status, durationMs });
        return response;
      } catch (error) {
        const durationMs = Math.round(performance.now() - startedAt);
        log('[Debug][Fetch][Error]', { method, url, durationMs, error: error?.message || String(error) });
        throw error;
      }
    };
  }

  if (!globalThis.__WA_CRM_XHR_PATCHED__ && typeof window.XMLHttpRequest === 'function') {
    globalThis.__WA_CRM_XHR_PATCHED__ = true;
    const originalOpen = window.XMLHttpRequest.prototype.open;
    const originalSend = window.XMLHttpRequest.prototype.send;

    window.XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
      this.__waCrmDebugMeta = { method: String(method || 'GET').toUpperCase(), url: String(url || '') };
      return originalOpen.call(this, method, url, ...rest);
    };

    window.XMLHttpRequest.prototype.send = function patchedSend(body) {
      const meta = this.__waCrmDebugMeta || { method: 'GET', url: 'unknown-url' };
      const startedAt = performance.now();
      log('[Debug][XHR][Start]', meta);
      this.addEventListener('loadend', () => {
        const durationMs = Math.round(performance.now() - startedAt);
        log('[Debug][XHR][Done]', { ...meta, status: this.status, durationMs });
      });
      return originalSend.call(this, body);
    };
  }

  log('[Debug] Interaction/API logging enabled.');
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

function extractPhoneFromText(value) {
  const text = String(value || '');
  const phoneMatch = text.match(/\+?\d[\d\s()-]{6,}/);
  return phoneMatch ? normalizePhone(phoneMatch[0]) : '';
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

async function ensureWhatsAppReady({ requireSearch = false } = {}) {
  const app = await waitForElement(SELECTORS.appReady, 25000);
  if (!app) throw new Error('WhatsApp UI not loaded yet.');
  const paneSide = await waitForElement(SELECTORS.paneSide, 30000);
  if (!paneSide) throw new Error('WhatsApp chat list is not ready yet (#pane-side missing).');

  if (!requireSearch) return { app, paneSide, search: null };

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

async function collectSidebarRows(paneSide) {
  const discovered = new Map();
  let unchanged = 0;
  let previousSize = 0;

  paneSide.scrollTop = 0;
  await wait(250);

  for (let i = 0; i < 60; i += 1) {
    const visibleRows = queryAllWithFallback(SELECTORS.sidebarChatRows, paneSide).filter((row) => row.textContent?.trim());

    visibleRows.forEach((row) => {
      const chat = detectChatTypeFromRow(row);
      const key = `${chat.name}|${chat.phone}`;
      if (!discovered.has(key)) discovered.set(key, chat);
    });

    paneSide.scrollTop = paneSide.scrollHeight;
    await wait(220);

    if (discovered.size === previousSize) {
      unchanged += 1;
      if (unchanged >= 6) break;
    } else {
      unchanged = 0;
    }

    previousSize = discovered.size;
  }

  paneSide.scrollTop = 0;
  await wait(120);

  return [...discovered.values()];
}

async function gatherSidebarData() {
  const { paneSide } = await ensureWhatsAppReady();
  const chats = await collectSidebarRows(paneSide);
  const groups = chats.filter((c) => c.isGroup).map((c) => c.name).sort((a, b) => a.localeCompare(b));
  const labels = [];
  const countryCodes = [...new Set(chats.map((c) => c.countryCode).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  return { chats, groups, labels, countryCodes };
}

async function clickFilterButton(filterName) {
  const selectors = SELECTORS.filterTabs[filterName];
  if (!selectors) return false;

  const button = queryWithFallback(selectors);
  if (!button) {
    log(`[Filter] Button not found for "${filterName}"`);
    return false;
  }

  (button.closest('button') || button).click();
  await wait(350);
  log(`[Filter] Applied "${filterName}"`);
  return true;
}

async function selectAdditionalFilterOption(label) {
  const opened = await clickFilterButton('additional');
  if (!opened) return false;

  const normalizedLabel = String(label || '').trim().toLowerCase();
  const menuItems = await waitForElement(SELECTORS.additionalFilterMenuItems, 3000);
  if (!menuItems) return false;

  const allItems = queryAllWithFallback(SELECTORS.additionalFilterMenuItems).filter((item) => item.textContent?.trim());
  const selectedItem = allItems.find((item) => {
    const itemLabel = (item.getAttribute('aria-label') || item.textContent || '').trim().toLowerCase();
    return itemLabel === normalizedLabel || itemLabel.includes(normalizedLabel);
  });

  if (!selectedItem) {
    log(`[Filter] Additional filter option not found for "${label}"`);
    return false;
  }

  (selectedItem.closest('[role="menuitem"]') || selectedItem).click();
  await wait(500);
  log(`[Filter] Applied additional option "${label}"`);
  return true;
}

async function applyNativeFilter(filter = {}) {
  const primary = filter.primary || 'all_contacts';
  const secondary = filter.secondary || '';

  if (primary === 'group') {
    await selectAdditionalFilterOption('Groups');
    return { primary, secondary };
  }

  if (primary === 'all_contacts' && secondary === 'unread_chats') {
    await clickFilterButton('unread');
    return { primary, secondary };
  }

  if (primary === 'favorites') {
    await clickFilterButton('favorites');
    return { primary, secondary };
  }

  await clickFilterButton('all');
  return { primary, secondary };
}

async function gatherSidebarDataForFilter(filter = {}) {
  await applyNativeFilter(filter);
  const snapshot = await gatherSidebarData();
  await clickFilterButton('all');
  return snapshot;
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

  await ensureWhatsAppReady({ requireSearch: true });
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
  const candidateStrings = [
    text,
    row.getAttribute('aria-label'),
    row.getAttribute('title'),
    row.getAttribute('data-id'),
    row.getAttribute('id')
  ].filter(Boolean);

  const attributePhone = candidateStrings.map(extractPhoneFromText).find(Boolean) || '';
  return {
    name: titleNode?.textContent?.trim() || text.trim() || 'Unknown',
    phone: attributePhone
  };
}

function isLikelyPhoneText(value) {
  const digits = normalizePhone(value);
  return digits.length >= 7;
}

async function closeContactOrActionPanels() {
  const closeSelectors = [
    'button[aria-label="Close"]',
    'button[title="Close"]',
    'button[aria-label="Back"]',
    'button[title="Back"]',
    'span[data-icon="x"]',
    'span[data-icon="back"]'
  ];

  for (let i = 0; i < 2; i += 1) {
    const closeBtn = queryWithFallback(closeSelectors);
    if (!closeBtn) break;
    (closeBtn.closest('button') || closeBtn).click();
    await wait(250);
  }
}

async function resolvePhoneFromMemberRow(row) {
  (row.closest('[role="button"]') || row).click();
  await wait(350);

  const infoEntry = [...document.querySelectorAll('[role="button"], [role="listitem"], li, div')]
    .find((node) => /contact info/i.test((node.textContent || '').trim()));

  if (!infoEntry) {
    await closeContactOrActionPanels();
    return '';
  }

  (infoEntry.closest('[role="button"]') || infoEntry).click();
  await wait(500);

  const selectableNodes = [...document.querySelectorAll('[data-testid="selectable-text"], span.copyable-text, div.copyable-text')];
  const phoneText = selectableNodes.map((node) => (node.textContent || '').trim()).find(isLikelyPhoneText) || '';
  const phone = phoneText ? normalizePhone(phoneText) : '';

  await closeContactOrActionPanels();
  return phone;
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
      const key = `${contact.name}|${contact.phone || ''}`;
      if (!discovered.has(key)) {
        discovered.set(key, { ...contact });
      }
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

  const unresolvedContacts = [...discovered.entries()].filter(([, contact]) => !contact.phone);
  for (const [key, contact] of unresolvedContacts) {
    const rows = queryAllWithFallback(SELECTORS.participantRows, panel).filter((row) =>
      (row.textContent || '').includes(contact.name)
    );
    const matchedRow = rows[0];
    if (!matchedRow) continue;

    try {
      const phone = await resolvePhoneFromMemberRow(matchedRow);
      if (phone) {
        discovered.set(key, { ...contact, phone });
      }
    } catch (error) {
      log('[Group Scrape] Unable to resolve member phone', contact.name, error?.message || error);
    }
  }

  const back = queryWithFallback(SELECTORS.closePanelButtons);
  if (back) {
    (back.closest('button') || back).click();
  }

  const uniqueByPhone = new Map();
  [...discovered.values()].forEach((contact) => {
    if (!contact.phone) return;
    if (!uniqueByPhone.has(contact.phone)) {
      uniqueByPhone.set(contact.phone, contact);
    }
  });

  return [...uniqueByPhone.values()];
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
        const snapshot = await gatherSidebarDataForFilter({ primary: 'all_contacts', secondary: 'all_chats' });
        sendResponse({ success: true, ...snapshot });
        break;
      }
      case ACTIONS.GET_GROUPS: {
        const snapshot = await gatherSidebarDataForFilter({ primary: 'group', secondary: '' });
        sendResponse({ success: true, groups: snapshot.groups });
        break;
      }
      case ACTIONS.FETCH_CONTACTS: {
        const snapshot = await gatherSidebarDataForFilter(message.filter || {});
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

setupWhatsAppInteractionDebugLogs();

})();
