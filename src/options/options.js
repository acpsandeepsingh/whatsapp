import { parseWorkbook, validatePhone } from '../services/xls-parser.js';
import { DEFAULT_SETTINGS } from '../services/settings.js';

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
  labels: [],
  countryCodes: []
};

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
  const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  return response?.settings || { ...DEFAULT_SETTINGS };
}

async function saveSettings() {
  const payload = {
    minDelayMs: Number(ui.minDelayMs.value || DEFAULT_SETTINGS.minDelayMs),
    maxDelayMs: Number(ui.maxDelayMs.value || DEFAULT_SETTINGS.maxDelayMs),
    maxMessagesPerSession: Number(ui.maxMessagesPerSession.value || DEFAULT_SETTINGS.maxMessagesPerSession),
    maxRetries: Number(ui.maxRetries.value || DEFAULT_SETTINGS.maxRetries),
    randomDelayEnabled: ui.randomDelayEnabled.checked,
    attachmentSendingEnabled: ui.attachmentSendingEnabled.checked,
    defaultTemplate: ui.defaultTemplate.value || DEFAULT_SETTINGS.defaultTemplate
  };

  const response = await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload });
  if (!response?.ok) {
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

  if (primary === 'specific_group') {
    buildSecondaryOptions(chatSnapshot.groups || [], 'Choose group');
    return;
  }
  if (primary === 'specific_label') {
    buildSecondaryOptions(chatSnapshot.labels || [], 'Choose label');
    return;
  }
  if (primary === 'specific_country') {
    buildSecondaryOptions(chatSnapshot.countryCodes || [], 'Choose country code');
    return;
  }

  ui.secondaryFilter.innerHTML = '<option value="">Not required</option>';
  ui.secondaryFilter.disabled = true;
}

function filteredRowsFromSnapshot() {
  const primary = ui.primaryFilter.value;
  const secondary = ui.secondaryFilter.value;

  const chats = chatSnapshot.chats || [];

  if (!chats.length) {
    setStatus('No chat snapshot data. Click Sync Chats first.', true);
    return [];
  }

  if (primary === 'all_chats' || primary === 'all_contacts') {
    return chats;
  }
  if (primary === 'unread_chats') {
    return chats.filter((chat) => Number(chat.unreadCount) > 0);
  }
  if (primary === 'read_chats') {
    return chats.filter((chat) => Number(chat.unreadCount) === 0);
  }
  if (primary === 'specific_group') {
    return chats.filter((chat) => chat.isGroup && chat.name === secondary);
  }
  if (primary === 'specific_label') {
    return chats.filter((chat) => (chat.labels || []).includes(secondary));
  }
  if (primary === 'specific_country') {
    return chats.filter((chat) => chat.countryCode === secondary);
  }

  return chats;
}

async function applySelectedFilterToTable() {
  const filtered = filteredRowsFromSnapshot();
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
  const response = await chrome.runtime.sendMessage({ type: 'GET_CHAT_SNAPSHOT' });
  if (!response?.ok) {
    setStatus(`Sync failed: ${response?.error || 'Unknown error'}`, true);
    return;
  }

  chatSnapshot = {
    chats: response.chats || [],
    groups: response.groups || [],
    labels: response.labels || [],
    countryCodes: response.countryCodes || []
  };

  refreshSecondaryFilter();
  setStatus(
    `Synced ${chatSnapshot.chats.length} chats | groups: ${chatSnapshot.groups.length} | countries: ${chatSnapshot.countryCodes.length}`
  );
}

async function scrapeSelectedGroup() {
  const groupName = ui.secondaryFilter.value;
  if (ui.primaryFilter.value !== 'specific_group' || !groupName) {
    setStatus('Select "From Specific Group" and choose a group first.', true);
    return;
  }

  const response = await chrome.runtime.sendMessage({ type: 'SCRAPE_CONTACTS', groupName });
  if (!response?.ok) {
    setStatus(`Group scrape failed: ${response?.error || 'Unknown error'}`, true);
    return;
  }

  const contacts = response.contacts || [];
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

  const response = await chrome.runtime.sendMessage({
    type: 'START_CAMPAIGN',
    payload: { rows: validRows, settings }
  });

  if (!response?.ok) {
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
ui.pauseBtn.addEventListener('click', async () => chrome.runtime.sendMessage({ type: 'PAUSE_CAMPAIGN' }));
ui.resumeBtn.addEventListener('click', async () => chrome.runtime.sendMessage({ type: 'RESUME_CAMPAIGN' }));
ui.stopBtn.addEventListener('click', async () => chrome.runtime.sendMessage({ type: 'STOP_CAMPAIGN' }));
ui.checkStatusBtn.addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ type: 'GET_PROGRESS' });
  if (!response?.ok) {
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
  if (message.type === 'PROGRESS_UPDATE') {
    renderProgress(message.progress, message.latest);
  }
});

(async function init() {
  await loadRows();
  renderRows();

  const settings = await getSettingsFromBackground();
  renderSettings(settings);

  const progressResponse = await chrome.runtime.sendMessage({ type: 'GET_PROGRESS' });
  if (progressResponse?.ok) {
    renderProgress(progressResponse.progress);
  }

  refreshSecondaryFilter();
})();
