import { ACTIONS, createMessage, getAction } from '../shared/actions.js';

const ui = {
  primaryFilter: document.getElementById('primaryFilter'),
  secondaryFilter: document.getElementById('secondaryFilter'),
  fetchContactsBtn: document.getElementById('fetchContactsBtn'),
  downloadContactsBtn: document.getElementById('downloadContactsBtn'),
  closePopupBtn: document.getElementById('closePopupBtn'),
  startFromStorageBtn: document.getElementById('startFromStorageBtn'),
  openDashboardBtn: document.getElementById('openDashboardBtn'),
  statusText: document.getElementById('statusText'),
  latestLog: document.getElementById('latestLog')
};

const POPUP_STATE_KEY = 'popupUiState';
let chatSnapshot = { groups: [], countryCodes: [] };
let latestFetchedContacts = [];

const CHAT_SCOPE_OPTIONS = [
  { value: 'all_chats', label: 'All Chats' },
  { value: 'unread_chats', label: 'Unread Chats' },
  { value: 'read_chats', label: 'Read Chats' }
];

function setStatus(text, isError = false) {
  ui.statusText.textContent = text;
  ui.statusText.style.color = isError ? '#fecaca' : '#93c5fd';
}

async function persistPopupState() {
  await chrome.storage.local.set({
    [POPUP_STATE_KEY]: {
      primaryFilter: ui.primaryFilter.value,
      secondaryFilter: ui.secondaryFilter.value,
      statusText: ui.statusText.textContent,
      latestLog: ui.latestLog.textContent,
      latestFetchedContacts,
      updatedAt: Date.now()
    }
  });
}

async function restorePopupState() {
  const stored = await chrome.storage.local.get([POPUP_STATE_KEY, 'lastContactsFetchResult']);
  const popupState = stored[POPUP_STATE_KEY] || {};
  const lastContactsFetchResult = stored.lastContactsFetchResult || {};

  if (popupState.primaryFilter) ui.primaryFilter.value = popupState.primaryFilter;
  refreshSecondaryFilter();

  if (popupState.secondaryFilter && !ui.secondaryFilter.disabled) {
    const hasOption = [...ui.secondaryFilter.options].some((option) => option.value === popupState.secondaryFilter);
    if (hasOption) ui.secondaryFilter.value = popupState.secondaryFilter;
  }

  const restoredContacts =
    (Array.isArray(popupState.latestFetchedContacts) && popupState.latestFetchedContacts) ||
    (Array.isArray(lastContactsFetchResult.data) && lastContactsFetchResult.data) ||
    [];

  latestFetchedContacts = restoredContacts;
  if (!latestFetchedContacts.length) {
    latestFetchedContacts = await loadContactsFromLocalDb();
  }
  ui.downloadContactsBtn.classList.toggle('hidden', !latestFetchedContacts.length);

  if (popupState.statusText) {
    setStatus(popupState.statusText, false);
  } else if (lastContactsFetchResult.completedAt) {
    setStatus(`Recovered previous contacts: ${restoredContacts.length}`);
  }

  if (popupState.latestLog) {
    ui.latestLog.textContent = popupState.latestLog;
  } else if (lastContactsFetchResult.completedAt) {
    ui.latestLog.textContent = JSON.stringify(lastContactsFetchResult, null, 2);
  }
}

function escapeCsvValue(value) {
  const normalized = String(value ?? '');
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

function excelTextValue(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  const escaped = normalized.replace(/"/g, '""');
  return `="${escaped}"`;
}


async function loadContactsFromLocalDb() {
  const stored = await chrome.storage.local.get(['lastContactsFetchResult', 'dashboardRows']);

  const fetchedContacts = Array.isArray(stored?.lastContactsFetchResult?.data)
    ? stored.lastContactsFetchResult.data
    : [];
  if (fetchedContacts.length) return fetchedContacts;

  const dashboardRows = Array.isArray(stored?.dashboardRows) ? stored.dashboardRows : [];
  return dashboardRows
    .map((row) => ({
      phone: String(row?.mobileNumber || '').trim(),
      name: String(row?.name || '').trim()
    }))
    .filter((row) => row.phone || row.name);
}

async function downloadContactFormatWithName() {
  if (!latestFetchedContacts.length) {
    latestFetchedContacts = await loadContactsFromLocalDb();
  }

  if (!latestFetchedContacts.length) {
    setStatus('No synchronized contacts available to download.', true);
    return;
  }

  const headers = ['Sr No', 'Mobile Number', 'Name', 'Message Template', 'Attachment URL'];
  const selectedOptionLabel =
    ui.primaryFilter.value === 'group' ? (ui.secondaryFilter.selectedOptions?.[0]?.textContent || '').trim() : '';
  const selectedGroupName = selectedOptionLabel || (ui.primaryFilter.value === 'group' ? (ui.secondaryFilter.value || '') : '');
  const rows = latestFetchedContacts.map((contact, index) => {
    const normalizedPhone = String(contact.phone || '').replace(/\s+/g, '');
    const normalizedName = String(contact.name || contact.contactName || '').replace(/\s+/g, ' ').trim();

    return [
      index + 1,
      excelTextValue(normalizedPhone),
      excelTextValue(normalizedName),
      selectedGroupName || 'Hello {{name}}',
      ''
    ];
  });

  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => escapeCsvValue(cell)).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const timestamp = new Date().toISOString().slice(0, 10);
  const safeGroupName = selectedGroupName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  link.href = url;
  link.download = `wa-synced-contacts-with-name${safeGroupName ? `-${safeGroupName}` : ''}-${timestamp}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  setStatus(`Downloaded ${latestFetchedContacts.length} contacts in requested format.`);
  persistPopupState();
}

function buildSecondaryOptions(values, placeholder = 'Select value') {
  if (!values.length) {
    ui.secondaryFilter.disabled = true;
    ui.secondaryFilter.innerHTML = '<option value="">No values available</option>';
    return;
  }

  ui.secondaryFilter.disabled = false;
  ui.secondaryFilter.innerHTML = `<option value="">${placeholder}</option>`;

  values.forEach((value) => {
    const optionValue = typeof value === 'string' ? value : value?.id ?? '';
    const optionLabel = typeof value === 'string' ? value : value?.subject ?? '';
    if (!optionLabel) return;
    const option = document.createElement('option');
    option.value = optionValue || optionLabel;
    option.textContent = optionLabel;
    ui.secondaryFilter.appendChild(option);
  });
}

function refreshSecondaryFilter() {
  const primary = ui.primaryFilter.value;

  if (primary === 'popup_contacts') {
    ui.secondaryFilter.innerHTML = '<option value="">Not required</option>';
    ui.secondaryFilter.disabled = true;
    return;
  }

  if (primary === 'all_contacts') {
    buildSecondaryOptions(
      CHAT_SCOPE_OPTIONS.map((option) => option.value),
      'Choose chat scope'
    );

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

async function ensureActiveWhatsAppTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isValidTab = Boolean(activeTab?.id && /^https:\/\/web\.whatsapp\.com(\/|$)/.test(String(activeTab.url || '')));
  if (isValidTab) return activeTab;
  throw new Error('Open WhatsApp Web in the active tab, then try again.');
}

async function loadSettings() {
  const response = await chrome.runtime.sendMessage(createMessage(ACTIONS.LOAD_SETTINGS));
  if (!response?.success) {
    setStatus(`Settings load failed: ${response?.error || 'Unknown error'}`, true);
    return;
  }

  ui.latestLog.textContent = JSON.stringify({ settings: response.settings }, null, 2);
}

async function fetchSnapshot() {
  const response = await chrome.runtime.sendMessage(createMessage(ACTIONS.GET_CHAT_SNAPSHOT));
  if (!response?.success) {
    setStatus(`Unable to sync chats: ${response?.error || 'Unknown error'}`, true);
    return false;
  }

  chatSnapshot = {
    groups: (response.groups || []).map((group, index) =>
      typeof group === 'string' ? { id: `snapshot-${index}`, subject: group } : group
    ),
    countryCodes: response.countryCodes || []
  };

  refreshSecondaryFilter();
  return true;
}

async function fetchGroupsForSecondaryFilter() {
  const response = await chrome.runtime.sendMessage(createMessage(ACTIONS.GET_GROUPS));
  if (!response?.success) {
    setStatus(`Unable to load groups: ${response?.error || 'Unknown error'}`, true);
    return;
  }

  chatSnapshot.groups = (response.groups || []).map((group, index) =>
    typeof group === 'string' ? { id: `groups-${index}`, subject: group } : group
  );
  refreshSecondaryFilter();
}

async function fetchContacts() {
  ui.fetchContactsBtn.disabled = true;
  setStatus('Capturing contacts...');

  try {
    await ensureActiveWhatsAppTab();
  } catch (error) {
    ui.fetchContactsBtn.disabled = false;
    setStatus(error.message, true);
    ui.latestLog.textContent = JSON.stringify({ success: false, error: error.message }, null, 2);
    await persistPopupState();
    return;
  }

  const selectedPrimary = ui.primaryFilter.value;
  if (selectedPrimary !== 'popup_contacts') {
    if (!(await fetchSnapshot())) {
      ui.fetchContactsBtn.disabled = false;
      await persistPopupState();
      return;
    }
  }

  const payload =
    selectedPrimary === 'popup_contacts'
      ? createMessage(ACTIONS.SCRAPE_GROUP)
      : createMessage(ACTIONS.FETCH_CONTACTS, {
          filter: {
            primary: selectedPrimary,
            secondary: ui.secondaryFilter.value
          }
        });

  const response = await chrome.runtime.sendMessage(payload);
  ui.fetchContactsBtn.disabled = false;

  if (!response?.success) {
    setStatus('Error', true);
    ui.latestLog.textContent = `Fetch failed: ${response?.error || 'Unknown error'}`;
    await persistPopupState();
    return;
  }

  const count = response?.data?.length || 0;
  latestFetchedContacts = response.data || [];
  ui.downloadContactsBtn.classList.toggle('hidden', !count);
  setStatus(
    response?.recovered
      ? `Recovered running fetch: ${count} contacts`
      : response?.stopped
        ? `Fetch stopped: ${count} contacts captured`
      : selectedPrimary === 'popup_contacts'
        ? `Popup capture complete: ${count} contacts`
        : `Success: ${count} contacts`
  );
  ui.latestLog.textContent = JSON.stringify(
    {
      action: selectedPrimary === 'popup_contacts' ? ACTIONS.SCRAPE_GROUP : ACTIONS.FETCH_CONTACTS,
      recovered: Boolean(response?.recovered),
      stopped: Boolean(response?.stopped),
      filter: {
        primary: selectedPrimary,
        secondary: ui.secondaryFilter.value
      },
      contacts: response.data?.slice(0, 8) || []
    },
    null,
    2
  );

  await persistPopupState();
}

async function restoreRunningOrPreviousState() {
  const response = await chrome.runtime.sendMessage(createMessage(ACTIONS.GET_CONTACT_FETCH_STATE));
  if (!response?.success) return;

  if (response.running) {
    setStatus('Recovered running fetch job...');
    ui.fetchContactsBtn.disabled = true;
    const recovered = await chrome.runtime.sendMessage(createMessage(ACTIONS.WAIT_FOR_CONTACT_FETCH_RESULT));
    ui.fetchContactsBtn.disabled = false;
    if (recovered?.success && Array.isArray(recovered.data)) {
      latestFetchedContacts = recovered.data;
      ui.downloadContactsBtn.classList.toggle('hidden', !latestFetchedContacts.length);
      setStatus(`Recovered completed fetch: ${latestFetchedContacts.length} contacts`);
      ui.latestLog.textContent = JSON.stringify({ recovered: true, contacts: recovered.data.slice(0, 8) }, null, 2);
      await persistPopupState();
    }
    return;
  }

  if (Array.isArray(response.lastResult?.data) && response.lastResult.data.length) {
    latestFetchedContacts = response.lastResult.data;
    ui.downloadContactsBtn.classList.toggle('hidden', false);
    setStatus(`Loaded previous contacts: ${latestFetchedContacts.length}`);
    ui.latestLog.textContent = JSON.stringify({ restored: true, ...response.lastResult }, null, 2);
    await persistPopupState();
  }
}

async function stopFetchAndClosePopup() {
  ui.closePopupBtn.disabled = true;
  try {
    const stateResponse = await chrome.runtime.sendMessage(createMessage(ACTIONS.GET_CONTACT_FETCH_STATE));
    if (stateResponse?.success && stateResponse.running) {
      setStatus('Stopping capture and saving collected contacts...');
      const stopResponse = await chrome.runtime.sendMessage(createMessage(ACTIONS.STOP_CONTACT_FETCH));
      const recoveredResult = stopResponse?.result;
      if (recoveredResult?.success && Array.isArray(recoveredResult.data)) {
        latestFetchedContacts = recoveredResult.data;
        ui.downloadContactsBtn.classList.toggle('hidden', !latestFetchedContacts.length);
        setStatus(`Fetch stopped: ${latestFetchedContacts.length} contacts captured`);
        ui.latestLog.textContent = JSON.stringify(
          {
            action: recoveredResult.action,
            stopped: true,
            contacts: recoveredResult.data.slice(0, 8)
          },
          null,
          2
        );
        await persistPopupState();
      }
    }
  } catch (error) {
    setStatus(`Unable to stop running fetch: ${error.message}`, true);
    await persistPopupState();
  } finally {
    window.close();
  }
}

ui.fetchContactsBtn.addEventListener('click', fetchContacts);
ui.downloadContactsBtn?.addEventListener('click', downloadContactFormatWithName);
ui.closePopupBtn?.addEventListener('click', stopFetchAndClosePopup);

ui.primaryFilter.addEventListener('change', async () => {
  if (ui.primaryFilter.value !== 'popup_contacts' && !chatSnapshot.groups.length && !chatSnapshot.countryCodes.length) {
    await fetchSnapshot();
  }

  if (ui.primaryFilter.value === 'group') {
    await fetchGroupsForSecondaryFilter();
    await persistPopupState();
    return;
  }
  refreshSecondaryFilter();
  await persistPopupState();
});

ui.secondaryFilter.addEventListener('change', persistPopupState);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  if (changes.settings?.newValue) {
    ui.latestLog.textContent = JSON.stringify({ settings: changes.settings.newValue }, null, 2);
  }
});

chrome.runtime.onMessage.addListener((message) => {
  const action = getAction(message);
  console.log('[WA CRM][Popup] ACTION:', action, message);

  if (action === ACTIONS.UPDATE_PROGRESS) {
    const latest = message.latest || {};
    setStatus(`Automation: ${latest.status || 'running'}`);
  }
});

(async function init() {
  await loadSettings();
  ui.primaryFilter.value = ui.primaryFilter.value || 'popup_contacts';
  refreshSecondaryFilter();
  await restorePopupState();
  await restoreRunningOrPreviousState();
})();
