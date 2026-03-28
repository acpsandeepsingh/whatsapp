import { randomBetween, wait } from '../utils/delay.js';
import { applyTemplate, normalizePhone } from '../services/message-template.js';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, sanitizeSettings } from '../services/settings.js';
import { ACTIONS, createMessage, getAction } from '../shared/actions.js';

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

function isWhatsAppWebUrl(url) {
  return /^https:\/\/web\.whatsapp\.com(\/|$)/.test(String(url || ''));
}

async function getWhatsAppTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id && isWhatsAppWebUrl(activeTab.url)) {
    state.activeTabId = activeTab.id;
    return activeTab;
  }

  if (state.activeTabId) {
    try {
      const tab = await chrome.tabs.get(state.activeTabId);
      if (tab?.id && isWhatsAppWebUrl(tab.url)) return tab;
    } catch (_error) {
      state.activeTabId = null;
    }
  }

  throw new Error('Open WhatsApp Web in the active tab first.');
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    console.log('[WA CRM][Background] -> Content', { tabId, action: getAction(message), message });
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error('No response from content script.'));
        return;
      }
      console.log('[WA CRM][Background] <- Content', { tabId, action: getAction(message), response });
      resolve(response);
    });
  });
}

async function ensureContentReady(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab?.id || !isWhatsAppWebUrl(tab.url)) {
    throw new Error('Selected tab is not WhatsApp Web. Open https://web.whatsapp.com first.');
  }

  console.log('[WA CRM][Background] Injecting content script into tab:', tabId);
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['src/content/whatsapp-content.js']
  });
  await wait(600);

  const pingResponse = await sendTabMessage(tabId, createMessage(ACTIONS.PING));
  if (!pingResponse?.success) {
    throw new Error(pingResponse?.error || 'Content script ping failed after injection.');
  }
}

async function sendToContent(message) {
  const tab = await getWhatsAppTab();
  await ensureContentReady(tab.id);
  return sendTabMessage(tab.id, message);
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
  const payload = createMessage(ACTIONS.UPDATE_PROGRESS, { progress: getProgress(), latest });
  try {
    await chrome.runtime.sendMessage(payload);
  } catch (_err) {
    // popup/options can be closed.
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
  state.settings = await saveSettings(state.settings);

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
    const payload = createMessage(ACTIONS.SEND_MESSAGE, {
      data: {
        srNo: item.srNo,
        rowId: item.rowId,
        phone: item.mobileNumber,
        message: item.renderedMessage,
        attachmentUrl: state.settings.attachmentSendingEnabled ? item.attachmentUrl : '',
        attachmentSendingEnabled: state.settings.attachmentSendingEnabled,
        rawRow: item.raw || {}
      }
    });

    try {
      console.log('[WA CRM][Background] ACTION:', ACTIONS.SEND_MESSAGE, payload.data);
      const result = await sendToContent(payload);
      if (!result?.success) throw new Error(result?.error || 'Unknown send error');

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

async function loadDashboardRows() {
  const stored = await chrome.storage.local.get('dashboardRows');
  return Array.isArray(stored.dashboardRows) ? stored.dashboardRows : [];
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    const action = getAction(message);
    console.log('[WA CRM][Background] ACTION:', action, message);

    switch (action) {
      case ACTIONS.LOAD_SETTINGS: {
        sendResponse({ success: true, settings: state.settings });
        break;
      }
      case ACTIONS.SAVE_SETTINGS: {
        state.settings = await saveSettings(message.settings || message.payload || {});
        sendResponse({ success: true, settings: state.settings });
        break;
      }
      case ACTIONS.GET_PROGRESS: {
        sendResponse({ success: true, progress: getProgress() });
        break;
      }
      case ACTIONS.GET_CHAT_SNAPSHOT: {
        const result = await sendToContent(createMessage(ACTIONS.GET_CHAT_SNAPSHOT));
        sendResponse(result);
        break;
      }
      case ACTIONS.GET_GROUPS: {
        const result = await sendToContent(createMessage(ACTIONS.GET_GROUPS));
        sendResponse(result);
        break;
      }
      case ACTIONS.FETCH_CONTACTS: {
        const result = await sendToContent(
          createMessage(ACTIONS.FETCH_CONTACTS, {
            filter: message.filter || null,
            chats: message.chats || []
          })
        );
        sendResponse(result);
        break;
      }
      case ACTIONS.SCRAPE_GROUP: {
        const result = await sendToContent(createMessage(ACTIONS.SCRAPE_GROUP, { groupName: message.groupName || '' }));
        sendResponse(result);
        break;
      }
      case ACTIONS.OPEN_CHAT: {
        const result = await sendToContent(
          createMessage(ACTIONS.OPEN_CHAT, { query: message.query || message.phone || '' })
        );
        sendResponse(result);
        break;
      }
      case ACTIONS.START_AUTOMATION: {
        const progress = await startCampaign(message.rows || message.payload?.rows || [], message.settings || message.payload?.settings || {});
        sendResponse({ success: true, progress });
        break;
      }
      case ACTIONS.START_CAMPAIGN_FROM_STORAGE: {
        const storageRows = await loadDashboardRows();
        if (!storageRows.length) {
          throw new Error('No saved rows found. Open dashboard and add/import rows first.');
        }
        const progress = await startCampaign(storageRows, {});
        sendResponse({ success: true, progress });
        break;
      }
      case ACTIONS.PAUSE_AUTOMATION: {
        state.paused = true;
        await broadcastProgress({ status: 'paused' });
        sendResponse({ success: true });
        break;
      }
      case ACTIONS.RESUME_AUTOMATION: {
        if (state.running) {
          state.paused = false;
          await broadcastProgress({ status: 'resumed' });
          processQueue();
        }
        sendResponse({ success: true });
        break;
      }
      case ACTIONS.STOP_AUTOMATION: {
        state.running = false;
        state.paused = false;
        await broadcastProgress({ status: 'stopped' });
        sendResponse({ success: true });
        break;
      }
      default: {
        sendResponse({ success: false, error: `Unknown message type: ${action || 'undefined'}` });
      }
    }
  })().catch((error) => {
    console.error('[WA CRM][Background] Handler error', error);
    sendResponse({
      success: false,
      error: error.message,
      action: getAction(message),
      timestamp: new Date().toISOString()
    });
  });

  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  state.settings = await loadSettings();
  await chrome.storage.local.set({ settings: state.settings, campaignState: getProgress() });
});

chrome.runtime.onStartup.addListener(async () => {
  state.settings = await loadSettings();
});
