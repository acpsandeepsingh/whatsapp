import { ACTIONS, createMessage, getAction } from '../shared/actions.js';

const ui = {
  primaryFilter: document.getElementById('primaryFilter'),
  secondaryFilter: document.getElementById('secondaryFilter'),
  fetchContactsBtn: document.getElementById('fetchContactsBtn'),
  openDashboardBtn: document.getElementById('openDashboardBtn'),
  statusText: document.getElementById('statusText'),
  latestLog: document.getElementById('latestLog')
};

let chatSnapshot = { groups: [], countryCodes: [] };

const CHAT_SCOPE_OPTIONS = [
  { value: 'all_chats', label: 'All Chats' },
  { value: 'unread_chats', label: 'Unread Chats' },
  { value: 'read_chats', label: 'Read Chats' }
];

function setStatus(text, isError = false) {
  ui.statusText.textContent = text;
  ui.statusText.style.color = isError ? '#fecaca' : '#93c5fd';
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
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    ui.secondaryFilter.appendChild(option);
  });
}

function refreshSecondaryFilter() {
  const primary = ui.primaryFilter.value;

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

  if (primary === 'specific_group') {
    buildSecondaryOptions(chatSnapshot.groups || [], 'Choose group');
    return;
  }

  if (primary === 'label') {
    ui.secondaryFilter.innerHTML = '<option value="">No labels available</option>';
    ui.secondaryFilter.disabled = true;
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
  const isValidTab = Boolean(activeTab?.id && activeTab.url?.startsWith('https://web.whatsapp.com/'));
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
    groups: response.groups || [],
    countryCodes: response.countryCodes || []
  };

  refreshSecondaryFilter();
  return true;
}

async function fetchContacts() {
  setStatus('Sending...');

  try {
    await ensureActiveWhatsAppTab();
  } catch (error) {
    setStatus(error.message, true);
    ui.latestLog.textContent = JSON.stringify({ success: false, error: error.message }, null, 2);
    return;
  }

  if (!(await fetchSnapshot())) return;

  const payload = createMessage(ACTIONS.FETCH_CONTACTS, {
    filter: {
      primary: ui.primaryFilter.value,
      secondary: ui.secondaryFilter.value
    }
  });

  const response = await chrome.runtime.sendMessage(payload);

  if (!response?.success) {
    setStatus('Error', true);
    ui.latestLog.textContent = `Fetch failed: ${response?.error || 'Unknown error'}`;
    return;
  }

  const count = response?.data?.length || 0;
  setStatus(`Success: ${count} contacts`);
  ui.latestLog.textContent = JSON.stringify(
    {
      action: ACTIONS.FETCH_CONTACTS,
      filter: payload.filter,
      contacts: response.data?.slice(0, 8) || []
    },
    null,
    2
  );
}

ui.openDashboardBtn.addEventListener('click', async () => {
  await chrome.runtime.openOptionsPage();
});

ui.fetchContactsBtn.addEventListener('click', fetchContacts);
ui.primaryFilter.addEventListener('change', refreshSecondaryFilter);

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
  await fetchSnapshot();
  refreshSecondaryFilter();
})();
