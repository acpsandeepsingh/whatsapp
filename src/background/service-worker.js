import { randomBetween, wait } from '../utils/delay.js';

const state = {
  queue: [],
  currentIndex: 0,
  running: false,
  paused: false,
  stats: {
    total: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    retries: 0
  },
  activeTabId: null,
  maxRetries: 2,
  minDelayMs: 3000,
  maxDelayMs: 10000
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

async function persistState() {
  await chrome.storage.local.set({ campaignState: state });
}

function getProgress() {
  return {
    running: state.running,
    paused: state.paused,
    currentIndex: state.currentIndex,
    stats: { ...state.stats },
    total: state.queue.length,
    activeTabId: state.activeTabId
  };
}

async function broadcastProgress(extra = {}) {
  const payload = { type: 'PROGRESS_UPDATE', progress: getProgress(), ...extra };
  try {
    await chrome.runtime.sendMessage(payload);
  } catch (_error) {
    // Popup may be closed; ignore.
  }
  await persistState();
}

async function processQueue() {
  if (!state.running) return;

  while (state.currentIndex < state.queue.length && state.running) {
    if (state.paused) {
      await wait(350);
      continue;
    }

    const item = state.queue[state.currentIndex];
    const payload = {
      type: 'SEND_MESSAGE',
      data: {
        srNo: item.srNo,
        phone: item.mobileNumber,
        message: item.messageTemplate,
        attachmentUrl: item.attachmentUrl
      }
    };

    try {
      const result = await sendToContent(payload);
      if (result?.ok) {
        state.stats.sent += 1;
      } else {
        throw new Error(result?.error || 'Unknown content script error');
      }
    } catch (error) {
      item._retryCount = item._retryCount || 0;
      if (item._retryCount < state.maxRetries) {
        item._retryCount += 1;
        state.stats.retries += 1;
        await broadcastProgress({
          latest: {
            status: 'retrying',
            phone: item.mobileNumber,
            reason: error.message,
            retry: item._retryCount
          }
        });
        await wait(randomBetween(1500, 3500));
        continue;
      }
      state.stats.failed += 1;
      await broadcastProgress({
        latest: {
          status: 'failed',
          phone: item.mobileNumber,
          reason: error.message
        }
      });
    }

    state.currentIndex += 1;
    await broadcastProgress({
      latest: {
        status: 'processed',
        phone: item.mobileNumber,
        index: state.currentIndex
      }
    });

    const jitter = randomBetween(state.minDelayMs, state.maxDelayMs);
    await wait(jitter);
  }

  if (state.currentIndex >= state.queue.length) {
    state.running = false;
    state.paused = false;
    await broadcastProgress({ type: 'CAMPAIGN_COMPLETED' });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case 'START_CAMPAIGN': {
        state.queue = message.payload.rows.map((row) => ({ ...row }));
        state.currentIndex = 0;
        state.running = true;
        state.paused = false;
        state.stats = {
          total: state.queue.length,
          sent: 0,
          failed: 0,
          skipped: 0,
          retries: 0
        };

        if (message.payload.minDelayMs) state.minDelayMs = message.payload.minDelayMs;
        if (message.payload.maxDelayMs) state.maxDelayMs = message.payload.maxDelayMs;
        if (message.payload.maxRetries !== undefined) state.maxRetries = message.payload.maxRetries;

        await getWhatsAppTab();
        await broadcastProgress();
        processQueue();
        sendResponse({ ok: true, progress: getProgress() });
        break;
      }
      case 'PAUSE_CAMPAIGN':
        state.paused = true;
        await broadcastProgress();
        sendResponse({ ok: true });
        break;
      case 'RESUME_CAMPAIGN':
        if (state.running) {
          state.paused = false;
          await broadcastProgress();
          processQueue();
        }
        sendResponse({ ok: true });
        break;
      case 'STOP_CAMPAIGN':
        state.running = false;
        state.paused = false;
        await broadcastProgress();
        sendResponse({ ok: true });
        break;
      case 'SCRAPE_CONTACTS': {
        const contacts = await sendToContent({ type: 'SCRAPE_CONTACTS' });
        sendResponse({ ok: true, contacts });
        break;
      }
      case 'GET_PROGRESS':
        sendResponse({ ok: true, progress: getProgress() });
        break;
      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }
  })().catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ campaignState: state });
});
