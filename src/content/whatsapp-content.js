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
  PING: 'PING',
  STOP_CONTACT_FETCH: 'STOP_CONTACT_FETCH'
});

const contactFetchRuntime = {
  stopRequested: false
};

const GROUP_METADATA_DB = Object.freeze({
  name: 'model-storage',
  store: 'group-metadata'
});
const PARTICIPANT_DB_STORE = 'participant';
const CONTACT_DB_STORE = 'contact';

function getAction(message = {}) {
  return message.action || message.type || '';
}

const SELECTORS = {
  appReady: ['#app'],
  paneSide: ['#pane-side'],
  chatSearchInputs: [
    'input[role="textbox"]',
    '[data-testid="chat-list-search"] [contenteditable="true"]',
    '[data-testid="chat-list-search"] [role="textbox"]',
    '[aria-label="Search input textbox"][contenteditable="true"]',
    '[contenteditable="true"][data-tab="3"]',
    'aside [role="textbox"][contenteditable="true"]',
    'div[role="search"] [contenteditable="true"]'
  ],
  sidebarChatRows: [
    '#pane-side [role="grid"] [role="row"] [role="gridcell"]',
    '#pane-side [role="gridcell"]',
    '#pane-side [role="row"] [role="gridcell"]',
    '#pane-side div[data-testid="cell-frame-container"]',
    '#pane-side > div > div > div > div'
  ],
  chatHeaderTitle: ['header [title]', 'header h1 span[title]', 'header h2 span[title]'],
  messageBox: [
    'footer [contenteditable="true"][data-tab="10"]',
    'footer [contenteditable="true"][data-tab="1"]',
    'footer div[role="textbox"][contenteditable="true"]'
  ],
  sendButton: [
    'button[aria-label="Send"]',
    'button[data-testid="compose-btn-send"]',
    'span[data-icon="send"]',
    'button span[data-icon="send"]'
  ],
  attachButton: ['button[title="Attach"]', 'div[aria-label="Attach"]', 'span[data-icon="plus-rounded"]'],
  fileInput: ['input[type="file"]', 'input[accept*="image"], input[accept*="video"], input[accept*="*/*"]'],
  chatHeaderClickable: ['header [title]', 'header h1', 'header [data-testid="conversation-info-header"]'],
  groupInfoHeading: ['[aria-label*="Group info"]', '[title="Group info"]', 'div[data-testid="drawer-header"]'],
  groupInfoPanel: ['[aria-label*="Group info"]', '[data-testid="drawer-left"]', '[data-testid="chat-drawer"]'],
  searchMembersPopup: ['[data-animate-modal-popup="true"][aria-label*="Search members"]', '[role="dialog"][aria-label*="Search members"]'],
  searchContactsInput: ['input[aria-label="Search contacts"]', 'input[placeholder="Search contacts"]'],
  participantsContainer: [
    '[aria-label*="Participants"] [tabindex="-1"]',
    '[aria-label*="Participants"]',
    'div[data-testid="group-participants"]',
    'div[role="dialog"] [tabindex="-1"]'
  ],
  participantRows: ['[aria-label*="Participants"] [role="row"]', 'div[data-testid="group-participants"] [role="row"]', '[role="row"]'],
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
const RESUME_STORAGE_KEY = 'waContentResumeState';
let isRunning = true;

function randomBetween(min, max) {
  const safeMin = Number(min) || 0;
  const safeMax = Number(max) || safeMin;
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

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

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function hasMemberLikeText(value) {
  const text = cleanText(value);
  if (!text) return false;
  if (extractPhoneFromText(text)) return true;

  const words = text
    .split(' ')
    .map((word) => word.trim())
    .filter(Boolean);

  if (!words.length || words.length > 10) return false;
  return words.some((word) => /[a-z]/i.test(word));
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
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
}

function setInputValueByTyping(input, value) {
  if (!(input instanceof HTMLInputElement)) return;
  input.focus();
  input.select();
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));

  const text = String(value || '');
  for (const char of text) {
    input.value += char;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }));
  }
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function humanTypeIntoInput(input, value, { minDelay = 50, maxDelay = 150 } = {}) {
  if (!(input instanceof HTMLInputElement)) return;
  input.focus();
  input.value = '';
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));

  const text = String(value || '');
  for (const char of text) {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    input.value += char;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
    await wait(randomBetween(minDelay, maxDelay));
  }
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function clearEditableBox(box) {
  if (!(box instanceof HTMLElement)) return;
  box.focus();
  box.textContent = '';
  box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
}

function getEditableText(box) {
  return String(box?.innerText || '').replace(/\r/g, '');
}

function isInterruptedError(error) {
  return error?.name === 'AutomationInterruptedError' || /interrupted/i.test(String(error?.message || ''));
}

function assertRunning(stage = 'automation') {
  if (!isRunning) {
    log(`[STOP] Interrupt at ${stage}`);
    const error = new Error(`Automation interrupted during ${stage}`);
    error.name = 'AutomationInterruptedError';
    throw error;
  }
}

async function typeSearch(query) {
  assertRunning('search-start');
  const value = String(query || '').trim();
  if (!value) throw new Error('Missing contact/group search query.');

  const searchBox = (await waitForElement('input[role="textbox"]', 12000)) || (await waitForElement(SELECTORS.chatSearchInputs, 12000));
  if (!searchBox) throw new Error('Search box not found in WhatsApp sidebar.');

  log('[Search] Typing started:', value);
  if (searchBox instanceof HTMLInputElement) {
    searchBox.focus();
    searchBox.select();
    searchBox.value = '';
    searchBox.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    for (const char of value) {
      assertRunning('search-typing');
      searchBox.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
      searchBox.value += char;
      searchBox.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }));
      searchBox.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
      await wait(randomBetween(80, 150));
    }
  } else {
    clearEditableBox(searchBox);
    searchBox.focus();
    for (const char of value) {
      assertRunning('search-typing');
      searchBox.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
      document.execCommand('insertText', false, char);
      searchBox.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }));
      searchBox.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
      await wait(randomBetween(80, 150));
    }
  }
  log('[Search] Typing completed:', value);
}

async function waitForSearchResults(timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    assertRunning('search-results');
    const paneSide = queryWithFallback(SELECTORS.paneSide);
    const rows = queryAllWithFallback(
      ['#pane-side [role="gridcell"]', '#pane-side [role="grid"] [role="row"] [role="gridcell"]'],
      paneSide || document
    ).filter((row) => row?.textContent?.trim());
    if (rows.length) {
      log('[Search] Gridcell found:', rows.length);
      return rows;
    }
    await wait(150);
  }
  throw new Error('No sidebar chat item found');
}

async function typeMessage(message, { delayPerChar = 45, confirmTimeoutMs = 15000 } = {}) {
  assertRunning('message-start');
  const text = String(message || '');
  if (!text.trim()) throw new Error('Message is empty after template processing');

  const box = await waitForElement(['div[contenteditable="true"][role="textbox"]', ...SELECTORS.messageBox], 15000);
  if (!(box instanceof HTMLElement)) throw new Error('Message box is not editable.');

  clearEditableBox(box);
  box.focus();
  log('[Message] Typing started:', `${text.length} chars`);

  let typedChars = 0;
  for (const char of text) {
    assertRunning('message-typing');
    const activeBox = queryWithFallback(['div[contenteditable="true"][role="textbox"]', ...SELECTORS.messageBox]);
    if (!(activeBox instanceof HTMLElement)) throw new Error('Message box disappeared during typing.');
    activeBox.focus();
    activeBox.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    document.execCommand('insertText', false, char);
    activeBox.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }));
    activeBox.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
    typedChars += 1;
    if (typedChars % 10 === 0) log('[Message] Typing progress', `${typedChars}/${text.length}`);
    await wait(randomBetween(Math.max(30, delayPerChar), 80));
  }

  const started = Date.now();
  while (Date.now() - started < confirmTimeoutMs) {
    assertRunning('message-confirm');
    const currentBox = queryWithFallback(['div[contenteditable="true"][role="textbox"]', ...SELECTORS.messageBox]);
    if (!(currentBox instanceof HTMLElement)) {
      await wait(120);
      continue;
    }

    const currentText = getEditableText(currentBox);
    if (currentText === text) {
      log('[Message] Typing completed and confirmed');
      return currentBox;
    }

    if (text !== currentText) {
      const missing = text.slice(currentText.length > 0 ? currentText.length : 0);
      log('[Message] Retrying missing characters:', missing.length);
      currentBox.focus();
      for (const char of missing) {
        assertRunning('message-retry-missing');
        document.execCommand('insertText', false, char);
        currentBox.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }));
        await wait(randomBetween(30, 80));
      }
    }
    await wait(120);
  }

  throw new Error('Message confirmation failed before send.');
}

async function waitForElement(selectors, timeoutMs = 25000, pollMs = 250, root = document) {
  const normalizedSelectors = Array.isArray(selectors) ? selectors : [selectors];
  const immediate = queryWithFallback(normalizedSelectors, root);
  if (immediate) return immediate;

  if (typeof MutationObserver === 'function') {
    return await new Promise((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        observer.disconnect();
        resolve(null);
      }, timeoutMs);

      const observer = new MutationObserver(() => {
        if (!isRunning) return;
        const found = queryWithFallback(normalizedSelectors, root);
        if (!found || resolved) return;
        resolved = true;
        clearTimeout(timer);
        observer.disconnect();
        resolve(found);
      });

      observer.observe(root === document ? document.documentElement : root, {
        childList: true,
        subtree: true,
        attributes: true
      });
    });
  }

  const maxTries = Math.ceil(timeoutMs / pollMs);
  for (let i = 0; i < maxTries; i += 1) {
    const found = queryWithFallback(normalizedSelectors, root);
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

async function collectSidebarRows(paneSide, shouldStop = () => false) {
  const discovered = new Map();
  if (shouldStop()) return [];

  const visibleRows = queryAllWithFallback(SELECTORS.sidebarChatRows, paneSide).filter((row) => row.textContent?.trim());
  visibleRows.forEach((row) => {
    const chat = detectChatTypeFromRow(row);
    const key = `${chat.name}|${chat.phone}`;
    if (!discovered.has(key)) discovered.set(key, chat);
  });

  return [...discovered.values()];
}

async function gatherSidebarData() {
  const { paneSide } = await ensureWhatsAppReady();
  const chats = await collectSidebarRows(paneSide, () => contactFetchRuntime.stopRequested);
  const groups = chats.filter((c) => c.isGroup).map((c) => c.name).sort((a, b) => a.localeCompare(b));
  const labels = [];
  const countryCodes = [...new Set(chats.map((c) => c.countryCode).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  return { chats, groups, labels, countryCodes };
}

function normalizeGroupMetadataRow(row = {}, index = 0) {
  const id = cleanText(row.id || row.gid || row.groupId || row._id || `${index}`);
  const subject = cleanText(row.subject || row.name || row.title || '');
  if (!subject) return null;
  return { id, subject };
}

function cleanPhoneFromContact(value) {
  if (!value) return '';
  return String(value).replace(/@c\.us$/, '').trim();
}

function pickContactName(contact = {}) {
  return cleanText(contact.name || contact.pushname || contact.formattedName || contact.shortName || 'Unknown');
}

async function loadGroupMetadataFromIndexedDb() {
  const openDb = () =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open(GROUP_METADATA_DB.name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Unable to open IndexedDB'));
    });

  const readAll = (db) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(GROUP_METADATA_DB.store, 'readonly');
      const os = tx.objectStore(GROUP_METADATA_DB.store);
      const req = os.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error || new Error('Unable to read group metadata store'));
    });

  let db;
  try {
    db = await openDb();
    const rows = await readAll(db);
    return rows.map((row, index) => normalizeGroupMetadataRow(row, index)).filter(Boolean);
  } catch (error) {
    log('[GroupMetadata] IndexedDB read failed:', error?.message || error);
    return [];
  } finally {
    try {
      db?.close?.();
    } catch (_error) {
      // no-op
    }
  }
}

async function loadGroupContactsByIdFromIndexedDb(groupId) {
  const normalizedGroupId = cleanText(groupId);
  if (!normalizedGroupId) return [];

  const openDb = () =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open(GROUP_METADATA_DB.name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Unable to open IndexedDB'));
    });

  const getByKey = (store, key) =>
    new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('Unable to read IndexedDB item'));
    });

  const getAll = (store) =>
    new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error || new Error('Unable to read IndexedDB items'));
    });

  let db;
  try {
    db = await openDb();
    const storeNames = db.objectStoreNames;
    const hasStores =
      storeNames.contains(GROUP_METADATA_DB.store) &&
      storeNames.contains(PARTICIPANT_DB_STORE) &&
      storeNames.contains(CONTACT_DB_STORE);
    if (!hasStores) return [];

    const tx = db.transaction([GROUP_METADATA_DB.store, PARTICIPANT_DB_STORE, CONTACT_DB_STORE], 'readonly');
    const groupStore = tx.objectStore(GROUP_METADATA_DB.store);
    const participantStore = tx.objectStore(PARTICIPANT_DB_STORE);
    const contactStore = tx.objectStore(CONTACT_DB_STORE);

    const group = await getByKey(groupStore, normalizedGroupId);
    if (!group) return [];

    const participantRows = await getAll(participantStore);
    const participantRecord = participantRows.find(
      (row) => cleanText(row.groupId) === normalizedGroupId || cleanText(row.id) === normalizedGroupId
    );
    if (!participantRecord || !Array.isArray(participantRecord.participants)) return [];

    const contacts = [];
    for (const lid of participantRecord.participants) {
      const contact = await getByKey(contactStore, lid);
      contacts.push({
        groupId: group.id || normalizedGroupId,
        groupName: cleanText(group.subject || group.name || group.title || ''),
        id: lid,
        name: pickContactName(contact || {}),
        phone: cleanPhoneFromContact(contact?.phoneNumber)
      });
    }

    return contacts.filter((contact) => contact.phone || contact.name);
  } catch (error) {
    log('[GroupContacts] IndexedDB group participant read failed:', error?.message || error);
    return [];
  } finally {
    try {
      db?.close?.();
    } catch (_error) {
      // no-op
    }
  }
}

async function resolveGroupFilterValue(value) {
  const selectedValue = cleanText(value);
  if (!selectedValue) return '';

  const metadata = await loadGroupMetadataFromIndexedDb();
  const match = metadata.find((group) => group.id === selectedValue || group.subject === selectedValue);
  return match?.subject || selectedValue;
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

async function gatherSidebarDataForFilter(_filter = {}) {
  // Native WhatsApp tab clicking (All/Unread/Favorites/etc) is intentionally disabled.
  // We always capture the full sidebar list once, then apply requested filters in JS.
  return gatherSidebarData();
}

function filterChats(snapshot = {}, filter = {}) {
  const chats = Array.isArray(snapshot.chats) ? snapshot.chats : [];
  const primary = filter.primary || 'all_contacts';
  const secondary = filter.secondary || '';

  if (primary === 'all_contacts') {
    const contactChats = chats.filter((chat) => !chat.isGroup && chat.phone);
    if (secondary === 'unread_chats') return contactChats.filter((chat) => Number(chat.unreadCount) > 0);
    if (secondary === 'read_chats') return contactChats.filter((chat) => Number(chat.unreadCount) === 0);
    return contactChats;
  }
  if (primary === 'group') return chats.filter((chat) => chat.isGroup && (!secondary || chat.name === secondary));
  if (primary === 'country') return chats.filter((chat) => chat.countryCode === secondary);

  return chats;
}

function getChatRowSearchText(cell) {
  if (!(cell instanceof HTMLElement)) return '';

  const parts = [
    cell.innerText || cell.textContent || '',
    cell.getAttribute('title') || '',
    cell.getAttribute('aria-label') || '',
    cell.getAttribute('data-testid') || ''
  ];
  const namedNodes = cell.querySelectorAll('[title], [aria-label]');
  namedNodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    parts.push(node.getAttribute('title') || '');
    parts.push(node.getAttribute('aria-label') || '');
    parts.push(node.textContent || '');
  });

  return cleanText(parts.filter(Boolean).join(' '));
}

function collectSidebarSearchDebugData(sidebarCells = []) {
  return sidebarCells.map((cell, index) => {
    if (!(cell instanceof HTMLElement)) {
      return { index, validElement: false };
    }

    const rect = cell.getBoundingClientRect();
    const style = window.getComputedStyle(cell);
    const text = getChatRowSearchText(cell);
    const titleNode = cell.querySelector('[title]');
    const ariaNode = cell.querySelector('[aria-label]');

    return {
      index,
      validElement: true,
      text,
      normalizedText: normalizePhone(text),
      hidden: cell.hidden,
      display: style.display,
      visibility: style.visibility,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      dataTestId: cell.getAttribute('data-testid') || '',
      role: cell.getAttribute('role') || '',
      title: cleanText(cell.getAttribute('title') || titleNode?.getAttribute?.('title') || ''),
      ariaLabel: cleanText(cell.getAttribute('aria-label') || ariaNode?.getAttribute?.('aria-label') || '')
    };
  });
}

async function openChat(queryValue) {
  assertRunning('open-chat-start');
  const query = String(queryValue || '').trim();
  if (!query) throw new Error('Missing contact/group search query.');
  const normalizedQuery = normalizePhone(query);
  const normalizedQueryLower = query.toLowerCase();
  const relaxedQuery = normalizedQueryLower.replace(/[^a-z0-9]+/g, '');

  log('[Chat] Opening chat:', query);
  await ensureWhatsAppReady();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    assertRunning('open-chat-attempt');
    log(`[Chat] Attempt ${attempt} for ${query}`);
    await typeSearch(query);
    await waitForSearchResults(10000);
    const sidebarCells = queryAllWithFallback(SELECTORS.sidebarChatRows).filter((cell) => {
      if (!(cell instanceof HTMLElement)) return false;
      if (cell.hidden) return false;
      const style = window.getComputedStyle(cell);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = cell.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (!sidebarCells.length) throw new Error('No visible sidebar chat item found');
    const debugRows = collectSidebarSearchDebugData(sidebarCells);
    log('[Search][Results] Visible rows:', debugRows.length);
    log('[Search][Results][Data]', {
      query,
      normalizedQuery,
      queryLower: normalizedQueryLower,
      relaxedQuery,
      rows: debugRows
    });

    let matchedCell =
      sidebarCells.find((cell) => {
        const cellText = getChatRowSearchText(cell);
        if (!cellText) return false;
        const cellTextLower = cellText.toLowerCase();
        if (cellTextLower.includes(normalizedQueryLower) || normalizedQueryLower.includes(cellTextLower)) return true;
        const relaxedCellText = cellTextLower.replace(/[^a-z0-9]+/g, '');
        if (relaxedQuery && relaxedCellText && (relaxedCellText.includes(relaxedQuery) || relaxedQuery.includes(relaxedCellText))) return true;
        if (!normalizedQuery) return false;
        const normalizedCellText = normalizePhone(cellText);
        return Boolean(normalizedCellText && (normalizedCellText.includes(normalizedQuery) || normalizedQuery.includes(normalizedCellText)));
      }) ||
      (sidebarCells.length === 1 ? sidebarCells[0] : null);

    if (!matchedCell) {
      log('[Search][Results][NoMatch]', {
        query,
        normalizedQuery,
        queryLower: normalizedQueryLower,
        relaxedQuery,
        rows: debugRows
      });
      throw new Error(`No matching visible chat found for query: ${query}`);
    }

    const clickableTarget =
      matchedCell.querySelector(
        '[data-testid="cell-frame-container"], [role="button"], [tabindex], button, a, div[aria-selected], div[aria-label], div[title]'
      ) || matchedCell;
    clickableTarget.scrollIntoView({ block: 'center', behavior: 'instant' });
    await wait(200);
    assertRunning('open-chat-click');
    simulateUserClick(clickableTarget);
    log('[Chat] Chat clicked:', cleanText(matchedCell.innerText || ''));

    const switched = await confirmChatSwitched(query, 12000);
    if (switched) {
      const messageBox = await waitForElement(['div[contenteditable="true"][role="textbox"]', ...SELECTORS.messageBox], 16000);
      if (messageBox) return messageBox;
    }
    if (attempt < 3) await wait(800);
  }

  throw new Error(`Unable to open chat for query: ${query}`);
}

async function confirmChatSwitched(expectedContact, timeoutMs = 12000) {
  const expected = String(expectedContact || '').trim().toLowerCase();
  const expectedPhone = normalizePhone(expectedContact);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    assertRunning('chat-confirm');
    const header = queryWithFallback(['header span[title]', ...SELECTORS.chatHeaderTitle]);
    const rawTitle = cleanText(header?.getAttribute?.('title') || header?.textContent || '');
    const title = rawTitle.toLowerCase();
    const titlePhone = normalizePhone(rawTitle);
    if (title && (title.includes(expected) || expected.includes(title) || (expectedPhone && titlePhone && (titlePhone.includes(expectedPhone) || expectedPhone.includes(titlePhone))))) {
      log('[Chat] Chat switched:', title || rawTitle);
      return true;
    }
    await wait(150);
  }
  return false;
}

async function openChatBySearch(queryValue) {
  return openChat(queryValue);
}

async function openChatByPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error('Invalid phone number');
  return openChat(normalized);
}

async function sendMessageSafe() {
  assertRunning('send-before');
  const box = queryWithFallback(['div[contenteditable="true"][role="textbox"]', ...SELECTORS.messageBox]);
  if (!(box instanceof HTMLElement)) throw new Error('Message box not found');
  await wait(200);
  assertRunning('send-enter');
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  box.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  log('[Message] Send action fired');
  await wait(900);
}

async function setMessageAndSend(text) {
  const message = String(text || '').trim();
  if (!message) throw new Error('Message is empty after template processing');

  await typeMessage(message);
  await wait(200);
  if (!isRunning) {
    log('[Message] Send skipped (STOP triggered)');
    assertRunning('send-protection');
  }
  const latestBox = queryWithFallback(['div[contenteditable="true"][role="textbox"]', ...SELECTORS.messageBox]);
  const latestText = getEditableText(latestBox);
  if (latestText !== message) throw new Error('Send blocked because message text is not fully typed.');
  await sendMessageSafe();
}

function simulateUserClick(node) {
  if (!(node instanceof Element)) return;
  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
    node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window }));
  });
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

function isValidParticipantRow(row) {
  if (!(row instanceof Element)) return false;
  if (row.querySelector('[data-icon="group"], [data-testid*="group"]')) return false;

  const text = (row.textContent || '').replace(/\s+/g, ' ').trim();
  if (!text) return false;

  const phone = extractPhoneFromText(text);
  if (phone) return true;

  const words = text.split(' ').filter(Boolean);
  return words.length >= 1 && words.length <= 8;
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

  const infoEntry = [...document.querySelectorAll('[role="button"], [role="row"], [role="gridcell"], li, div')]
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

async function resolvePhoneFromOpenChatProfile() {
  const header = await waitForElement(SELECTORS.chatHeaderClickable, 8000);
  if (!header) return '';

  (header.closest('button') || header).click();
  await wait(450);

  const infoEntry = [...document.querySelectorAll('[role="button"], [role="row"], [role="gridcell"], li, div')]
    .find((node) => /contact info/i.test((node.textContent || '').trim()));

  if (infoEntry) {
    (infoEntry.closest('[role="button"]') || infoEntry).click();
    await wait(500);
  }

  const selectableNodes = [...document.querySelectorAll('[data-testid="selectable-text"], span.copyable-text, div.copyable-text')];
  const phoneText = selectableNodes.map((node) => (node.textContent || '').trim()).find(isLikelyPhoneText) || '';
  const phone = phoneText ? normalizePhone(phoneText) : '';

  await closeContactOrActionPanels();
  return phone;
}

async function enrichDirectChatsWithProfilePhones(chats = [], filter = {}) {
  const primary = filter.primary || 'all_contacts';
  const shouldResolve = primary === 'all_contacts' || primary === 'country';
  if (!shouldResolve) return chats;

  const enriched = chats.map((chat) => ({ ...chat }));
  const unresolved = enriched.filter((chat) => !chat.isGroup && !chat.phone && chat.name && chat.name !== 'Unknown');

  for (const chat of unresolved) {
    try {
      await openChatBySearch(chat.name);
      const resolvedPhone = await resolvePhoneFromOpenChatProfile();
      if (!resolvedPhone) continue;

      chat.phone = resolvedPhone;
      if (!chat.countryCode) {
        chat.countryCode = extractCountryCode(resolvedPhone);
      }
      log('[Contacts] Resolved saved contact phone from profile', chat.name, chat.phone);
    } catch (error) {
      log('[Contacts] Unable to resolve saved contact phone', chat.name, error?.message || error);
    }
  }

  return enriched;
}

async function openGroupInfo(groupName) {
  const alreadyInGroupInfo = Boolean(
    queryWithFallback(SELECTORS.groupInfoHeading) || queryWithFallback(SELECTORS.groupInfoPanel)
  );

  if (!alreadyInGroupInfo) {
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
  }

  await wait(500);
}

function getSearchMembersPopup() {
  const fromSelectors = queryWithFallback(SELECTORS.searchMembersPopup);
  if (fromSelectors) return fromSelectors;

  const popoverBucket = document.querySelector('#wa-popovers-bucket') || document.body;
  return [...popoverBucket.querySelectorAll('[data-animate-modal-popup="true"], [role="dialog"]')]
    .find((dialog) => dialog.querySelector('input[aria-label="Search contacts"], input[placeholder="Search contacts"]')) || null;
}

function getWaPopoverBucketDialog() {
  const popoverBucket = document.querySelector('#wa-popovers-bucket');
  if (!popoverBucket) return null;

  const dialogs = [...popoverBucket.querySelectorAll('[data-animate-modal-popup="true"], [role="dialog"]')];
  return (
    dialogs.find((dialog) => {
      const hasMemberRows = Boolean(dialog.querySelector('[role="row"], [role="gridcell"]'));
      const hasSearchInput = Boolean(dialog.querySelector('input[aria-label="Search contacts"], input[placeholder="Search contacts"]'));
      return hasMemberRows || hasSearchInput;
    }) || null
  );
}

async function openViewAllMembersDialog(root = document) {
  const existing = getSearchMembersPopup();
  if (existing) return existing;

  const candidateButtons = [...root.querySelectorAll('[role="button"], button, [tabindex="0"]')];
  const viewAll = candidateButtons.find((node) => /view all\s*\(\d+\s*more\)|view all|see all/i.test(cleanText(node.textContent)));
  if (!viewAll) return null;

  (viewAll.closest('[role="button"],button') || viewAll).click();
  await wait(700);

  return getSearchMembersPopup();
}

async function ensureMembersPopupOpen(root = document) {
  const existing = getWaPopoverBucketDialog() || getSearchMembersPopup();
  if (existing) return existing;

  const reopened = await openViewAllMembersDialog(root);
  if (reopened) return reopened;

  return getWaPopoverBucketDialog() || getSearchMembersPopup() || null;
}

function collectVisibleMembersFromPanel(panel, discovered) {
  const candidates = [
    ...panel.querySelectorAll('[role="row"]'),
    ...panel.querySelectorAll('[role="gridcell"]'),
    ...panel.querySelectorAll('div[tabindex="-1"]'),
    ...panel.querySelectorAll('div[tabindex="0"]')
  ];

  candidates.forEach((row) => {
    const raw = (row.innerText || row.textContent || '').trim();
    if (!hasMemberLikeText(raw)) return;

    const phone = extractPhoneFromText(raw);
    const lines = raw
      .split('\n')
      .map((line) => cleanText(line))
      .filter(Boolean);
    const name = cleanText((lines[0] || '').replace(/group admin/gi, '').replace(/^~/, '').replace(phone, ''));
    if (!name && !phone) return;
    if (/^(you|#)$/i.test(name)) return;

    const key = `${name || phone}|${phone || ''}`;
    if (!discovered.has(key)) {
      discovered.set(key, { name: name || phone, phone: normalizePhone(phone) || '' });
    }
  });
}

async function scrapeGroupContacts(groupName, options = {}) {
  const resolveMissingPhones = Boolean(options.resolveMissingPhones);

  if (groupName) {
    await openGroupInfo(groupName);
  }

  const popupDialog = (await openViewAllMembersDialog(document)) || getWaPopoverBucketDialog();
  if (!popupDialog) {
    throw new Error('Popup not found under #wa-popovers-bucket. Open "View all" members popup first.');
  }

  let panel = popupDialog;

  const discovered = new Map();

  if (!contactFetchRuntime.stopRequested) {
    const activePopup = getWaPopoverBucketDialog() || getSearchMembersPopup();
    const activePanel = activePopup || panel;
    if (activePanel) {
      panel = activePanel;
      const rows = queryAllWithFallback(SELECTORS.participantRows, activePanel).filter(isValidParticipantRow);
      rows.forEach((row) => {
        const contact = readContactFromRow(row);
        if (!contact.name || contact.name === 'Unknown') return;
        const key = `${contact.name}|${contact.phone || ''}`;
        if (!discovered.has(key)) discovered.set(key, { ...contact });
      });
      collectVisibleMembersFromPanel(activePanel, discovered);
    }
  }

  if (resolveMissingPhones) {
    const unresolvedContacts = [...discovered.entries()].filter(([, contact]) => !contact.phone);
    for (const [key, contact] of unresolvedContacts) {
      if (contactFetchRuntime.stopRequested) break;

      const currentPanel = getWaPopoverBucketDialog() || getSearchMembersPopup() || panel;
      const rows = queryAllWithFallback(SELECTORS.participantRows, currentPanel)
        .filter(isValidParticipantRow)
        .filter((row) => (row.textContent || '').includes(contact.name));
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
  log('Loop started');
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

async function getResumeState() {
  const stored = await chrome.storage.local.get([RESUME_STORAGE_KEY]);
  return stored[RESUME_STORAGE_KEY] || { currentIndex: 0 };
}

async function setResumeState(nextState) {
  await chrome.storage.local.set({ [RESUME_STORAGE_KEY]: nextState });
}

async function runSendLoop(rows = []) {
  const queue = Array.isArray(rows) ? rows : [];
  const initialState = await getResumeState();
  const startIndex = Number(initialState.currentIndex) || 0;
  isRunning = true;
  await chrome.storage.local.set({ isRunning: true });

  for (const [offset, row] of queue.slice(startIndex).entries()) {
    assertRunning('loop-contact-start');
    const index = startIndex + offset;
    let success = false;

    for (let retry = 0; retry <= 2; retry += 1) {
      try {
        assertRunning('loop-before-send');
        await sendSingleMessage(row);
        success = true;
        break;
      } catch (error) {
        if (isInterruptedError(error)) {
          await setResumeState({ currentIndex: index, interruptedAt: Date.now(), row });
          return { success: false, stopped: true, index, error: error.message };
        }
        log(`[Loop] Contact failed at index ${index} (retry ${retry + 1}/2):`, error?.message || error);
        await setResumeState({ currentIndex: index, failedRow: row, failedAt: Date.now() });
        if (retry < 2) await wait(randomBetween(2000, 5000));
      }
    }

    if (!success) {
      return { success: false, index, error: `Failed after retries at index ${index}` };
    }

    await setResumeState({ currentIndex: index + 1, updatedAt: Date.now() });
    if (index + 1 < queue.length) {
      assertRunning('loop-post-send-delay');
      await wait(randomBetween(2000, 5000));
    }
  }

  await setResumeState({ currentIndex: 0, updatedAt: Date.now(), completed: true });
  return { success: true, processed: queue.length };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    const action = getAction(message);
    log('ACTION:', action, message);

    const isLocalOnlyGroupAction =
      action === ACTIONS.GET_GROUPS ||
      (action === ACTIONS.FETCH_CONTACTS && String(message?.filter?.primary || '') === 'group');

    if (action !== ACTIONS.PING && !isLocalOnlyGroupAction) {
      await ensureWhatsAppReady();
    }

    switch (action) {
      case ACTIONS.PING:
        sendResponse({ success: true });
        break;
      case ACTIONS.STOP_CONTACT_FETCH:
        contactFetchRuntime.stopRequested = true;
        sendResponse({ success: true, stopping: true });
        break;
      case ACTIONS.GET_CHAT_SNAPSHOT: {
        const snapshot = await gatherSidebarDataForFilter({ primary: 'all_contacts', secondary: 'all_chats' });
        sendResponse({ success: true, ...snapshot });
        break;
      }
      case ACTIONS.GET_GROUPS: {
        const metadataGroups = await loadGroupMetadataFromIndexedDb();
        sendResponse({
          success: true,
          groups: metadataGroups,
          source: 'indexeddb-group-metadata'
        });
        break;
      }
      case ACTIONS.FETCH_CONTACTS: {
        contactFetchRuntime.stopRequested = false;
        const requestedFilter = { ...(message.filter || {}) };
        if (requestedFilter.primary === 'group' && requestedFilter.secondary) {
          const groupContacts = await loadGroupContactsByIdFromIndexedDb(requestedFilter.secondary);
          sendResponse({
            success: true,
            data: groupContacts,
            snapshot: { chats: [], groups: [], labels: [], countryCodes: [] },
            source: 'indexeddb-group-participants',
            stopped: contactFetchRuntime.stopRequested
          });
          break;
        }
        const snapshot = await gatherSidebarDataForFilter(requestedFilter);
        const enrichedChats = await enrichDirectChatsWithProfilePhones(snapshot.chats || [], requestedFilter);
        const enrichedSnapshot = { ...snapshot, chats: enrichedChats };
        const contacts = filterChats(enrichedSnapshot, requestedFilter);
        sendResponse({
          success: true,
          data: contacts,
          snapshot: enrichedSnapshot,
          stopped: contactFetchRuntime.stopRequested
        });
        break;
      }
      case ACTIONS.SCRAPE_GROUP: {
        contactFetchRuntime.stopRequested = false;
        const contacts = await scrapeGroupContacts(message.groupName || '', { resolveMissingPhones: false });
        sendResponse({ success: true, data: contacts, stopped: contactFetchRuntime.stopRequested });
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
      case ACTIONS.START_CAMPAIGN_FROM_STORAGE: {
        isRunning = true;
        await chrome.storage.local.set({ isRunning: true });
        const result = await runSendLoop(message.rows || message.data || []);
        sendResponse(result);
        break;
      }
      case ACTIONS.STOP_AUTOMATION: {
        isRunning = false;
        log('[STOP] STOP triggered from popup/background');
        await chrome.storage.local.set({ isRunning: false });
        sendResponse({ success: true, stopped: true });
        break;
      }
      case ACTIONS.PAUSE_AUTOMATION: {
        isRunning = false;
        await chrome.storage.local.set({ isRunning: false });
        sendResponse({ success: true, paused: true });
        break;
      }
      case ACTIONS.RESUME_AUTOMATION: {
        isRunning = true;
        await chrome.storage.local.set({ isRunning: true });
        sendResponse({ success: true, resumed: true });
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
