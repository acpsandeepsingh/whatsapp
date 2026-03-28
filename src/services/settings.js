export const SETTINGS_KEY = 'settings';
const LEGACY_SETTINGS_KEY = 'waBulkSettings';

export const DEFAULT_SETTINGS = {
  minDelayMs: 3000,
  maxDelayMs: 10000,
  randomDelayEnabled: true,
  maxMessagesPerSession: 250,
  attachmentSendingEnabled: true,
  defaultTemplate: 'Hello World',
  maxRetries: 2
};

export function sanitizeSettings(input = {}) {
  const minDelayMs = Math.max(500, Number(input.minDelayMs ?? DEFAULT_SETTINGS.minDelayMs));
  const maxDelayMs = Math.max(minDelayMs, Number(input.maxDelayMs ?? DEFAULT_SETTINGS.maxDelayMs));

  return {
    minDelayMs,
    maxDelayMs,
    randomDelayEnabled: Boolean(input.randomDelayEnabled ?? DEFAULT_SETTINGS.randomDelayEnabled),
    maxMessagesPerSession: Math.max(1, Number(input.maxMessagesPerSession ?? DEFAULT_SETTINGS.maxMessagesPerSession)),
    attachmentSendingEnabled: Boolean(input.attachmentSendingEnabled ?? DEFAULT_SETTINGS.attachmentSendingEnabled),
    defaultTemplate: String(input.defaultTemplate ?? DEFAULT_SETTINGS.defaultTemplate).trim() || DEFAULT_SETTINGS.defaultTemplate,
    maxRetries: Math.max(0, Number(input.maxRetries ?? DEFAULT_SETTINGS.maxRetries))
  };
}

export async function loadSettings() {
  const stored = await chrome.storage.local.get([SETTINGS_KEY, LEGACY_SETTINGS_KEY]);
  return sanitizeSettings(stored[SETTINGS_KEY] || stored[LEGACY_SETTINGS_KEY] || {});
}

export async function saveSettings(input) {
  const settings = sanitizeSettings(input);
  await chrome.storage.local.set({ settings });
  return settings;
}
