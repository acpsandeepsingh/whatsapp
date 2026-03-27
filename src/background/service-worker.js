import { randomBetween, wait } from '../utils/delay.js';
import { applyTemplate, normalizePhone } from '../services/message-template.js';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, sanitizeSettings } from '../services/settings.js';

const state = {
  queue: [],
  currentIndex: 0,
  running: false,
  paused: false,
  stats: {
    total: 0,
    sent: 0,
    failed: 0,
    pending: 0,
    retries: 0
  },
  activeTabId: null,
  settings: { ...DEFAULT_SETTINGS }
};

async function getWhatsAppTab() {
  if (state.activeTabId) {
    try {
      const tab = await chrome.tabs.get(state.activeTabId);
      if (tab?.url?.startsWith('https://web.whatsapp.com/')) return tab;
    } catch (_error) {
      state.activeTabId = null;
    }
  }

  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  if (!tabs.length) throw new Error('Open WhatsApp Web in a tab first.');

  state.activeTabId = tabs[0].id;
  return tabs[0];
}

async function sendToContent(payload) {
  const tab = await getWhatsAppTab();
  return chrome.tabs.sendMessage(tab.id, payload);
}

function getProgress() {
  return {
    running: state.running,
    paused: state.paused,
    currentIndex: state.currentIndex,
    stats: { ...state.stats },
    total: state.queue.length,
    settings: { ...state.settings }
  };
}

async function persistState() {
  await chrome.storage.local.set({ campaignState: getProgress() });
}

async function broadcastProgress(latest = null) {
  const payload = { type: 'PROGRESS_UPDATE', progress: getProgress(), latest };
  try {
    await chrome.runtime.sendMessage(payload);
  } catch (_err) {
    // popup/options can be closed
  }
  await persistState();
}

function getPerMessageDelay() {
  const { minDelayMs, maxDelayMs, randomDelayEnabled } = state.settings;
  if (!randomDelayEnabled || minDelayMs === maxDelayMs) return minDelayMs;
  return randomBetween(minDelayMs, maxDelayMs);
}

function transformQueueRows(rows = []) {
  return rows.slice(0, state.settings.maxMessagesPerSession).map((row, index) => {
    const effectiveTemplate = row.messageTemplate || state.settings.defaultTemplate;
    return {
      ...row,
      srNo: row.srNo || index + 1,
      rowId: row.id || `row-${index + 1}`,
      mobileNumber: normalizePhone(row.mobileNumber || ''),
      messageTemplate: effectiveTemplate,
      renderedMessage: applyTemplate(effectiveTemplate, row),
      attachmentUrl: row.attachmentUrl || '',
      _retryCount: 0
    };
  });
}

async function startCampaign(rows = [], incomingSettings = {}) {
  state.settings = sanitizeSettings({ ...state.settings, ...incomingSettings });
  await saveSettings(state.settings);

  state.queue = transformQueueRows(rows || []);
  state.currentIndex = 0;
  state.running = true;
  state.paused = false;
  state.stats = {
    total: state.queue.length,
    sent: 0,
    failed: 0,
    pending: state.queue.length,
    retries: 0
  };

  await getWhatsAppTab();
  await broadcastProgress({ status: 'started' });
  processQueue();
  return getProgress();
}

async function processQueue() {
  if (!state.running) return;

  while (state.currentIndex < state.queue.length && state.running) {
    if (state.paused) {
      await wait(300);
      continue;
    }

    const item = state.queue[state.currentIndex];
    const payload = {
      type: 'SEND_MESSAGE',
      data: {
        srNo: item.srNo,
        rowId: item.rowId,
        phone: item.mobileNumber,
        message: item.renderedMessage,
        attachmentUrl: state.settings.attachmentSendingEnabled ? item.attachmentUrl : '',
        attachmentSendingEnabled: state.settings.attachmentSendingEnabled,
        rawRow: item.raw || {}
      }
    };

    try {
      console.log('[WA CRM] Sending row', state.currentIndex + 1, payload.data);
      const result = await sendToContent(payload);
      if (!result?.ok) throw new Error(result?.error || 'Unknown send error');

      state.stats.sent += 1;
      state.currentIndex += 1;
      state.stats.pending = state.queue.length - state.currentIndex;
      await broadcastProgress({
        status: 'success',
        index: state.currentIndex,
        rowId: item.rowId,
        phone: item.mobileNumber,
        detail: result.mode || 'text'
      });
    } catch (error) {
      item._retryCount += 1;
      if (item._retryCount <= state.settings.maxRetries) {
        state.stats.retries += 1;
        await broadcastProgress({
          status: 'retrying',
          index: state.currentIndex + 1,
          rowId: item.rowId,
          retry: item._retryCount,
          phone: item.mobileNumber,
          reason: error.message
        });
        await wait(1200);
        continue;
      }

      state.stats.failed += 1;
      state.currentIndex += 1;
      state.stats.pending = state.queue.length - state.currentIndex;
      await broadcastProgress({
        status: 'failed',
        index: state.currentIndex,
        rowId: item.rowId,
        phone: item.mobileNumber,
        reason: error.message
      });
    }

    await wait(getPerMessageDelay());
  }

  if (state.currentIndex >= state.queue.length) {
    state.running = false;
    state.paused = false;
    await broadcastProgress({ status: 'completed' });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case 'GET_SETTINGS': {
        sendResponse({ ok: true, settings: state.settings });
        break;
      }
      case 'SAVE_SETTINGS': {
        state.settings = await saveSettings(message.payload || {});
        sendResponse({ ok: true, settings: state.settings });
        break;
      }
      case 'GET_PROGRESS': {
        sendResponse({ ok: true, progress: getProgress() });
        break;
      }
      case 'GET_CHAT_SNAPSHOT': {
        const result = await sendToContent({ type: 'GET_CHAT_SNAPSHOT' });
        sendResponse(result);
        break;
      }
      case 'SCRAPE_CONTACTS': {
        const result = await sendToContent({ type: 'SCRAPE_CONTACTS', groupName: message.groupName || '' });
        sendResponse(result);
        break;
      }
      case 'OPEN_CHAT': {
        const result = await sendToContent({ type: 'OPEN_CHAT', query: message.query || message.phone || '' });
        sendResponse(result);
        break;
      }
      case 'START_CAMPAIGN': {
        const progress = await startCampaign(message.payload?.rows || [], message.payload?.settings || {});
        sendResponse({ ok: true, progress });
        break;
      }
      case 'START_CAMPAIGN_FROM_STORAGE': {
        const stored = await chrome.storage.local.get('dashboardRows');
        const storageRows = Array.isArray(stored.dashboardRows) ? stored.dashboardRows : [];
        if (!storageRows.length) {
          throw new Error('No saved rows found. Open dashboard and add/import rows first.');
        }

        const progress = await startCampaign(storageRows, {});
        sendResponse({ ok: true, progress });
        break;
      }
      case 'PAUSE_CAMPAIGN': {
        state.paused = true;
        await broadcastProgress({ status: 'paused' });
        sendResponse({ ok: true });
        break;
      }
      case 'RESUME_CAMPAIGN': {
        if (state.running) {
          state.paused = false;
          await broadcastProgress({ status: 'resumed' });
          processQueue();
        }
        sendResponse({ ok: true });
        break;
      }
      case 'STOP_CAMPAIGN': {
        state.running = false;
        state.paused = false;
        await broadcastProgress({ status: 'stopped' });
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }
  })().catch((error) => {
    console.error('[WA CRM] Background error', error);
    sendResponse({ ok: false, error: error.message });
  });

  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  state.settings = await loadSettings();
  await chrome.storage.local.set({ campaignState: getProgress() });
});

chrome.runtime.onStartup.addListener(async () => {
  state.settings = await loadSettings();
});
