import { DEFAULT_SETTINGS } from '../services/settings.js';

const form = document.getElementById('settingsForm');
const statusText = document.getElementById('statusText');

const fields = {
  minDelayMs: document.getElementById('minDelayMs'),
  maxDelayMs: document.getElementById('maxDelayMs'),
  maxMessagesPerSession: document.getElementById('maxMessagesPerSession'),
  maxRetries: document.getElementById('maxRetries'),
  randomDelayEnabled: document.getElementById('randomDelayEnabled'),
  attachmentSendingEnabled: document.getElementById('attachmentSendingEnabled'),
  defaultTemplate: document.getElementById('defaultTemplate')
};

function render(settings) {
  fields.minDelayMs.value = settings.minDelayMs;
  fields.maxDelayMs.value = settings.maxDelayMs;
  fields.maxMessagesPerSession.value = settings.maxMessagesPerSession;
  fields.maxRetries.value = settings.maxRetries;
  fields.randomDelayEnabled.checked = settings.randomDelayEnabled;
  fields.attachmentSendingEnabled.checked = settings.attachmentSendingEnabled;
  fields.defaultTemplate.value = settings.defaultTemplate;
}

function collect() {
  return {
    minDelayMs: Number(fields.minDelayMs.value),
    maxDelayMs: Number(fields.maxDelayMs.value),
    maxMessagesPerSession: Number(fields.maxMessagesPerSession.value),
    maxRetries: Number(fields.maxRetries.value),
    randomDelayEnabled: fields.randomDelayEnabled.checked,
    attachmentSendingEnabled: fields.attachmentSendingEnabled.checked,
    defaultTemplate: fields.defaultTemplate.value
  };
}

async function load() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  render(response?.ok ? { ...DEFAULT_SETTINGS, ...response.settings } : DEFAULT_SETTINGS);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  statusText.textContent = 'Saving...';

  const response = await chrome.runtime.sendMessage({
    type: 'SAVE_SETTINGS',
    payload: collect()
  });

  if (!response?.ok) {
    statusText.textContent = `Error: ${response?.error || 'Unable to save settings'}`;
    return;
  }

  render(response.settings);
  statusText.textContent = 'Settings saved successfully.';
});

load();
