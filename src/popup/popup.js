import { parseWorkbook } from '../services/xls-parser.js';

const ui = {
  xlsInput: document.getElementById('xlsInput'),
  fileMeta: document.getElementById('fileMeta'),
  startBtn: document.getElementById('startBtn'),
  pauseBtn: document.getElementById('pauseBtn'),
  resumeBtn: document.getElementById('resumeBtn'),
  stopBtn: document.getElementById('stopBtn'),
  progressText: document.getElementById('progressText'),
  progressBar: document.getElementById('progressBar'),
  latestLog: document.getElementById('latestLog'),
  minDelay: document.getElementById('minDelay'),
  maxDelay: document.getElementById('maxDelay'),
  maxRetries: document.getElementById('maxRetries'),
  scrapeBtn: document.getElementById('scrapeBtn'),
  downloadContacts: document.getElementById('downloadContacts')
};

let parsedRows = [];

function renderProgress(progress, latest = null) {
  const total = progress.total || 0;
  const done = (progress.stats?.sent || 0) + (progress.stats?.failed || 0);
  const percent = total ? Math.round((done / total) * 100) : 0;

  ui.progressBar.max = 100;
  ui.progressBar.value = percent;
  ui.progressText.textContent = `Status: ${progress.running ? (progress.paused ? 'Paused' : 'Running') : 'Idle'} | ${done}/${total} | Sent: ${progress.stats?.sent || 0} | Failed: ${progress.stats?.failed || 0} | Retries: ${progress.stats?.retries || 0}`;

  if (latest) {
    ui.latestLog.textContent = JSON.stringify(latest, null, 2);
  }
}

async function getProgress() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_PROGRESS' });
  if (response?.ok) {
    renderProgress(response.progress);
  }
}

ui.xlsInput.addEventListener('change', async (event) => {
  try {
    const file = event.target.files?.[0];
    if (!file) return;

    parsedRows = await parseWorkbook(file);
    ui.fileMeta.textContent = `${file.name} loaded with ${parsedRows.length} rows.`;
  } catch (error) {
    ui.fileMeta.textContent = `Error: ${error.message}`;
    parsedRows = [];
  }
});

ui.startBtn.addEventListener('click', async () => {
  if (!parsedRows.length) {
    ui.fileMeta.textContent = 'Please upload a valid XLS/XLSX first.';
    return;
  }

  const minDelayMs = Number(ui.minDelay.value || 3000);
  const maxDelayMs = Number(ui.maxDelay.value || 10000);

  if (minDelayMs > maxDelayMs) {
    ui.fileMeta.textContent = 'Min delay cannot be greater than max delay.';
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: 'START_CAMPAIGN',
    payload: {
      rows: parsedRows,
      minDelayMs,
      maxDelayMs,
      maxRetries: Number(ui.maxRetries.value || 2)
    }
  });

  if (!response?.ok) {
    ui.fileMeta.textContent = `Failed to start: ${response?.error || 'unknown error'}`;
    return;
  }

  renderProgress(response.progress);
});

ui.pauseBtn.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'PAUSE_CAMPAIGN' }));
ui.resumeBtn.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'RESUME_CAMPAIGN' }));
ui.stopBtn.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'STOP_CAMPAIGN' }));

ui.scrapeBtn.addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ type: 'SCRAPE_CONTACTS' });
  if (!response?.ok) {
    ui.latestLog.textContent = `Scrape failed: ${response?.error || 'Unknown error'}`;
    return;
  }

  const contacts = response.contacts || [];
  ui.latestLog.textContent = JSON.stringify({ contactsFound: contacts.length, contacts }, null, 2);

  const blob = new Blob([JSON.stringify(contacts, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  ui.downloadContacts.href = url;
  ui.downloadContacts.textContent = `Download ${contacts.length} contacts`;
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'PROGRESS_UPDATE') {
    renderProgress(message.progress, message.latest);
  }
  if (message.type === 'CAMPAIGN_COMPLETED') {
    ui.latestLog.textContent = 'Campaign completed successfully.';
  }
});

getProgress();
