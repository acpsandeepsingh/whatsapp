import { parseWorkbook, validatePhone } from '../services/xls-parser.js';
import { DEFAULT_SETTINGS } from '../services/settings.js';
import { ACTIONS, createMessage, getAction } from '../shared/actions.js';

const STORAGE_KEY = 'dashboardRows';

const ui = {
  xlsInput: document.getElementById('xlsInput'),
  importBtn: document.getElementById('importBtn'),
  addRowBtn: document.getElementById('addRowBtn'),
  saveRowsBtn: document.getElementById('saveRowsBtn'),
  startBtn: document.getElementById('startBtn'),
  pauseBtn: document.getElementById('pauseBtn'),
  resumeBtn: document.getElementById('resumeBtn'),
  stopBtn: document.getElementById('stopBtn'),
  checkStatusBtn: document.getElementById('checkStatusBtn'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  syncChatsBtn: document.getElementById('syncChatsBtn'),
  applyFilterBtn: document.getElementById('applyFilterBtn'),
  scrapeGroupBtn: document.getElementById('scrapeGroupBtn'),
  primaryFilter: document.getElementById('primaryFilter'),
  secondaryFilter: document.getElementById('secondaryFilter'),
  statusText: document.getElementById('statusText'),
  progressLine: document.getElementById('progressLine'),
  progressBar: document.getElementById('progressBar'),
  latestLog: document.getElementById('latestLog'),
  rowsTableBody: document.getElementById('rowsTableBody'),
  minDelayMs: document.getElementById('minDelayMs'),
  maxDelayMs: document.getElementById('maxDelayMs'),
  maxMessagesPerSession: document.getElementById('maxMessagesPerSession'),
  maxRetries: document.getElementById('maxRetries'),
  randomDelayEnabled: document.getElementById('randomDelayEnabled'),
  attachmentSendingEnabled: document.getElementById('attachmentSendingEnabled'),
  defaultTemplate: document.getElementById('defaultTemplate')
};

let rows = [];
let chatSnapshot = {
  chats: [],
  groups: [],
  countryCodes: []
};

const CHAT_SCOPE_OPTIONS = [
  { value: 'all_chats', label: 'All Chats' },
  { value: 'unread_chats', label: 'Unread Chats' },
  { value: 'read_chats', label: 'Read Chats' }
];

function uid() {
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toDigits(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

function defaultRow() {
  return {
    id: uid(),
    srNo: rows.length + 1,
    mobileNumber: '',
    name: '',
    messageTemplate: 'Hello {{name}}, your mobile is {{mobile}} and serial is {{sr_no}}',
    attachmentUrl: '',
    status: 'Pending',
    raw: {}
  };
}

async function saveRows() {
  await chrome.storage.local.set({ [STORAGE_KEY]: rows });
}

async function loadRows() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  rows = Array.isArray(stored?.[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];

  if (!rows.length) {
    rows = [defaultRow()];
    await saveRows();
  }
}

function renderRows() {
  ui.rowsTableBody.innerHTML = '';

  rows.forEach((row, index) => {
    const tr = document.createElement('tr');
    const phoneValid = validatePhone(row.mobileNumber || '');

    tr.innerHTML = `
      <td contenteditable="true" data-index="${index}" data-field="srNo">${row.srNo ?? index + 1}</td>
      <td contenteditable="true" data-index="${index}" data-field="mobileNumber">${row.mobileNumber || ''}</td>
      <td contenteditable="true" data-index="${index}" data-field="name">${row.name || ''}</td>
      <td contenteditable="true" data-index="${index}" data-field="messageTemplate">${row.messageTemplate || ''}</td>
      <td contenteditable="true" data-index="${index}" data-field="attachmentUrl">${row.attachmentUrl || ''}</td>
      <td><span class="status-pill ${(row.status || 'Pending').toLowerCase()}">${row.status || 'Pending'}${phoneValid ? '' : ' (Invalid Number)'}</span></td>
      <td>
        <button data-action="attach-local" data-index="${index}" class="secondary">Attach Local</button>
        <button data-action="delete-row" data-index="${index}" class="danger">Delete</button>
      </td>
    `;

    ui.rowsTableBody.appendChild(tr);
  });
}

function setStatus(text, isError = false) {
  ui.statusText.textContent = text;
  ui.statusText.style.color = isError ? '#f87171' : '#93c5fd';
}

function renderProgress(progress, latest = null) {
  const total = progress?.total || rows.length;
  const sent = progress?.stats?.sent || 0;
  const failed = progress?.stats?.failed || 0;
  const pending = progress?.stats?.pending ?? Math.max(total - (sent + failed), 0);
  const done = sent + failed;
  const percent = total ? Math.round((done / total) * 100) : 0;
  const state = progress?.running ? (progress?.paused ? 'Paused' : 'Running') : 'Idle';

  ui.progressBar.value = percent;
  ui.progressLine.textContent = `State: ${state} | Total: ${total} | Sent: ${sent} | Failed: ${failed} | Pending: ${pending}`;

  if (latest) {
    ui.latestLog.textContent = JSON.stringify(latest, null, 2);
    applyLiveStatusUpdate(latest);
  }
}

function applyLiveStatusUpdate(latest) {
  if (!latest || typeof latest !== 'object') return;

  const targetIndex = latest.rowId ? rows.findIndex((row) => row.id === latest.rowId) : Number(latest.index) - 1;
  if (Number.isNaN(targetIndex) || targetIndex < 0 || !rows[targetIndex]) return;

  if (latest.status === 'success') {
    rows[targetIndex].status = 'Sent';
  } else if (latest.status === 'failed') {
    rows[targetIndex].status = 'Failed';
  } else if (latest.status === 'retrying') {
    rows[targetIndex].status = 'Pending';
  }

  renderRows();
  saveRows();
}

async function getSettingsFromBackground() {
  const response = await chrome.runtime.sendMessage(createMessage(ACTIONS.LOAD_SETTINGS));
  return response?.settings || { ...DEFAULT_SETTINGS };
}

async function saveSettings() {
  const settings = {
    minDelayMs: Number(ui.minDelayMs.value || DEFAULT_SETTINGS.minDelayMs),
    maxDelayMs: Number(ui.maxDelayMs.value || DEFAULT_SETTINGS.maxDelayMs),
    maxMessagesPerSession: Number(ui.maxMessagesPerSession.value || DEFAULT_SETTINGS.maxMessagesPerSession),
    maxRetries: Number(ui.maxRetries.value || DEFAULT_SETTINGS.maxRetries),
    randomDelayEnabled: ui.randomDelayEnabled.checked,
    attachmentSendingEnabled: ui.attachmentSendingEnabled.checked,
    defaultTemplate: ui.defaultTemplate.value || DEFAULT_SETTINGS.defaultTemplate
  };

  const response = await chrome.runtime.sendMessage(createMessage(ACTIONS.SAVE_SETTINGS, { settings }));
  if (!response?.success) {
    setStatus(`Unable to save settings: ${response?.error || 'Unknown error'}`, true);
    return null;
  }

  setStatus('Automation settings saved.');
  return response.settings;
}

function renderSettings(settings) {
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  ui.minDelayMs.value = s.minDelayMs;
  ui.maxDelayMs.value = s.maxDelayMs;
  ui.maxMessagesPerSession.value = s.maxMessagesPerSession;
  ui.maxRetries.value = s.maxRetries;
  ui.randomDelayEnabled.checked = Boolean(s.randomDelayEnabled);
  ui.attachmentSendingEnabled.checked = Boolean(s.attachmentSendingEnabled);
  ui.defaultTemplate.value = s.defaultTemplate;
}

function buildSecondaryOptions(values, placeholder = 'Select value') {
  ui.secondaryFilter.innerHTML = '';
  if (!values.length) {
    ui.secondaryFilter.disabled = true;
    ui.secondaryFilter.innerHTML = '<option value="">No values available</option>';
    return;
  }

  ui.secondaryFilter.disabled = false;
  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = placeholder;
  ui.secondaryFilter.appendChild(placeholderOption);

  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    ui.secondaryFilter.appendChild(option);
  });
}

function refreshSecondaryFilter() {
  const primary = ui.primaryFilter.value;

  if (primary === 'all_contacts') {
    buildSecondaryOptions(CHAT_SCOPE_OPTIONS.map((option) => option.value), 'Choose chat scope');

    const options = [...ui.secondaryFilter.options];
    options.forEach((option, index) => {
      if (index > 0) {
        option.textContent = CHAT_SCOPE_OPTIONS[index - 1].label;
      }
    });
    return;
  }

  if (primary === 'group') {
    buildSecondaryOptions(chatSnapshot.groups || [], 'Choose group');
    return;
  }
  if (primary === 'country') {
    buildSecondaryOptions(chatSnapshot.countryCodes || [], 'Choose country code');
    return;
  }

  ui.secondaryFilter.innerHTML = '<option value="">Not required</option>';
  ui.secondaryFilter.disabled = true;
}

async function filteredRowsFromSource() {
  const response = await chrome.runtime.sendMessage(
    createMessage(ACTIONS.FETCH_CONTACTS, {
      filter: {
        primary: ui.primaryFilter.value,
        secondary: ui.secondaryFilter.value
      }
    })
  );

  if (!response?.success) {
    setStatus(`Filter failed: ${response?.error || 'Unknown error'}`, true);
    return [];
  }

  if (response.snapshot) {
    chatSnapshot = {
      chats: response.snapshot.chats || [],
      groups: response.snapshot.groups || [],
      countryCodes: response.snapshot.countryCodes || []
    };
    refreshSecondaryFilter();
  }

  return response.data || [];
}

async function applySelectedFilterToTable() {
  const filtered = await filteredRowsFromSource();
  if (!filtered.length) {
    setStatus('No chats matched selected filter.', true);
    return;
  }

  rows = filtered.map((chat, index) => ({
    id: uid(),
    srNo: index + 1,
    mobileNumber: chat.phone || '',
    name: chat.name || '',
    messageTemplate: ui.defaultTemplate.value || DEFAULT_SETTINGS.defaultTemplate,
    attachmentUrl: '',
    status: validatePhone(chat.phone || '') ? 'Pending' : 'Failed',
    raw: {
      filter_source: ui.primaryFilter.value,
      unread_count: chat.unreadCount,
      country_code: chat.countryCode,
      is_group: chat.isGroup
    }
  }));

  renderRows();
  await saveRows();
  setStatus(`Loaded ${rows.length} row(s) from filter: ${ui.primaryFilter.value}`);
}

async function syncChatsSnapshot() {
  const response = await chrome.runtime.sendMessage(createMessage(ACTIONS.GET_CHAT_SNAPSHOT));
  if (!response?.success) {
    setStatus(`Sync failed: ${response?.error || 'Unknown error'}`, true);
    return;
  }

  chatSnapshot = {
    chats: response.chats || [],
    groups: response.groups || [],
    countryCodes: response.countryCodes || []
  };

  refreshSecondaryFilter();
  setStatus(
    `Synced ${chatSnapshot.chats.length} chats | groups: ${chatSnapshot.groups.length} | countries: ${chatSnapshot.countryCodes.length}`
  );
}

async function scrapeSelectedGroup() {
  const groupName = ui.secondaryFilter.value;
  if (ui.primaryFilter.value !== 'group' || !groupName) {
    setStatus('Select "Group" and choose a group first.', true);
    return;
  }

  const response = await chrome.runtime.sendMessage(createMessage(ACTIONS.SCRAPE_GROUP, { groupName }));
  if (!response?.success) {
    setStatus(`Group scrape failed: ${response?.error || 'Unknown error'}`, true);
    return;
  }

  const contacts = response.data || [];
  if (!contacts.length) {
    setStatus('No participant numbers found in selected group.', true);
    return;
  }

  const byPhone = new Map();
  contacts.forEach((contact) => {
    const phone = toDigits(contact.phone);
    if (phone) byPhone.set(phone, contact);
  });

  rows = [...byPhone.values()].map((contact, index) => ({
    id: uid(),
    srNo: index + 1,
    mobileNumber: contact.phone,
    name: contact.name || '',
    messageTemplate: ui.defaultTemplate.value || DEFAULT_SETTINGS.defaultTemplate,
    attachmentUrl: '',
    status: 'Pending',
    raw: { source_group: groupName }
  }));

  renderRows();
  await saveRows();
  setStatus(`Scraped ${rows.length} unique participant(s) from ${groupName}.`);
}

async function startCampaign() {
  const settings = await saveSettings();
  if (!settings) return;

  const validRows = rows
    .filter((row) => validatePhone(row.mobileNumber || ''))
    .map((row) => ({ ...row, status: 'Pending' }));

  if (!validRows.length) {
    setStatus('No valid rows available. Please add valid mobile numbers.', true);
    return;
  }

  rows = rows.map((row) => ({ ...row, status: validatePhone(row.mobileNumber || '') ? 'Pending' : 'Failed' }));
  renderRows();
  await saveRows();

  const response = await chrome.runtime.sendMessage(
    createMessage(ACTIONS.START_AUTOMATION, {
      rows: validRows,
      settings
    })
  );

  if (!response?.success) {
    setStatus(`Start failed: ${response?.error || 'Unknown error'}`, true);
    return;
  }

  setStatus(`Campaign started with ${validRows.length} valid row(s).`);
  renderProgress(response.progress, { status: 'started' });
}

ui.rowsTableBody.addEventListener(
  'blur',
  async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.dataset.field) return;

    const index = Number(target.dataset.index);
    if (Number.isNaN(index) || !rows[index]) return;

    const field = target.dataset.field;
    rows[index][field] = target.textContent.trim();

    if (field === 'mobileNumber' && !validatePhone(rows[index][field])) {
      rows[index].status = 'Failed';
    }

    await saveRows();
    renderRows();
  },
  true
);

ui.rowsTableBody.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const action = target.dataset.action;
  const index = Number(target.dataset.index);
  if (Number.isNaN(index) || !rows[index]) return;

  if (action === 'delete-row') {
    rows.splice(index, 1);
    rows = rows.map((row, i) => ({ ...row, srNo: i + 1 }));
    renderRows();
    await saveRows();
    return;
  }

  if (action === 'attach-local') {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '*/*';
    picker.addEventListener('change', async () => {
      const file = picker.files?.[0];
      if (!file) return;

      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed reading local file'));
        reader.readAsDataURL(file);
      });

      rows[index].attachmentUrl = String(dataUrl);
      rows[index].raw = { ...(rows[index].raw || {}), local_attachment_name: file.name };
      await saveRows();
      renderRows();
      setStatus(`Local file attached for row ${index + 1}: ${file.name}`);
    });
    picker.click();
  }
});

ui.addRowBtn.addEventListener('click', async () => {
  rows.push(defaultRow());
  renderRows();
  await saveRows();
});

ui.saveRowsBtn.addEventListener('click', async () => {
  await saveRows();
  setStatus('Rows saved to chrome.storage.local');
});

ui.importBtn.addEventListener('click', async () => {
  try {
    const file = ui.xlsInput.files?.[0];
    if (!file) {
      setStatus('Select an XLS/XLSX file first.', true);
      return;
    }

    const parsed = await parseWorkbook(file);
    console.log('[WA CRM][Options] Parsed XLS rows:', parsed);
    if (!parsed.length) {
      setStatus('Import finished, but 0 valid contacts were found. Check mobile number column.', true);
      return;
    }

    rows = parsed.map((row, index) => ({
      ...row,
      id: row.id || uid(),
      srNo: row.srNo || index + 1,
      name: row.name || row.raw?.name || '',
      status: 'Pending'
    }));
    renderRows();
    await saveRows();
    setStatus(`Imported ${rows.length} row(s) from ${file.name}.`);
  } catch (error) {
    setStatus(`Import failed: ${error.message}`, true);
  }
});

ui.startBtn.addEventListener('click', startCampaign);
ui.pauseBtn.addEventListener('click', async () => chrome.runtime.sendMessage(createMessage(ACTIONS.PAUSE_AUTOMATION)));
ui.resumeBtn.addEventListener('click', async () => chrome.runtime.sendMessage(createMessage(ACTIONS.RESUME_AUTOMATION)));
ui.stopBtn.addEventListener('click', async () => chrome.runtime.sendMessage(createMessage(ACTIONS.STOP_AUTOMATION)));
ui.checkStatusBtn.addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage(createMessage(ACTIONS.GET_PROGRESS));
  if (!response?.success) {
    setStatus(`Status error: ${response?.error || 'Unknown error'}`, true);
    return;
  }

  renderProgress(response.progress);
  setStatus('Progress refreshed.');
});

ui.saveSettingsBtn.addEventListener('click', saveSettings);
ui.syncChatsBtn.addEventListener('click', syncChatsSnapshot);
ui.applyFilterBtn.addEventListener('click', applySelectedFilterToTable);
ui.scrapeGroupBtn.addEventListener('click', scrapeSelectedGroup);
ui.primaryFilter.addEventListener('change', refreshSecondaryFilter);

chrome.runtime.onMessage.addListener((message) => {
  const action = getAction(message);
  console.log('[WA CRM][Options] ACTION:', action, message);

  if (action === ACTIONS.UPDATE_PROGRESS) {
    renderProgress(message.progress, message.latest);
  }
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;

  if (changes.settings?.newValue) {
    renderSettings(changes.settings.newValue);
    setStatus('Settings synchronized from storage.');
  }

  if (changes.dashboardRows?.newValue) {
    rows = Array.isArray(changes.dashboardRows.newValue) ? changes.dashboardRows.newValue : rows;
    renderRows();
  }
});

(async function init() {
  await loadRows();
  renderRows();

  const settings = await getSettingsFromBackground();
  renderSettings(settings);

  const progressResponse = await chrome.runtime.sendMessage(createMessage(ACTIONS.GET_PROGRESS));
  if (progressResponse?.success) {
    renderProgress(progressResponse.progress);
  }

  refreshSecondaryFilter();
})();
