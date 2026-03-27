import { parseWorkbook, validatePhone } from '../services/xls-parser.js';
import { DEFAULT_SETTINGS } from '../services/settings.js';

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
  rowsTableBody: document.getElementById('rowsTableBody'),
  tableWrap: document.getElementById('tableWrap'),
  previewHint: document.getElementById('previewHint'),
  scrapeBtn: document.getElementById('scrapeBtn'),
  downloadContacts: document.getElementById('downloadContacts')
};

let parsedRows = [];
let settings = { ...DEFAULT_SETTINGS };

function setHint(text, isError = false) {
  ui.fileMeta.textContent = text;
  ui.fileMeta.style.color = isError ? '#f87171' : '#94a3b8';
}

function renderRowsTable() {
  ui.rowsTableBody.innerHTML = '';

  parsedRows.forEach((row, index) => {
    const tr = document.createElement('tr');
    const valid = validatePhone(row.mobileNumber);

    tr.innerHTML = `
      <td>${row.srNo}</td>
      <td>${row.mobileNumber}</td>
      <td contenteditable="true" data-index="${index}" data-field="messageTemplate">${row.messageTemplate || ''}</td>
      <td>${row.attachmentUrl || ''}</td>
      <td class="${valid ? 'status-ok' : 'status-bad'}">${valid ? 'Yes' : 'No'}</td>
    `;

    ui.rowsTableBody.appendChild(tr);
  });

  ui.previewHint.classList.add('hidden');
  ui.tableWrap.classList.remove('hidden');
}

function updateProgress(progress, latest = null) {
  const total = progress.total || 0;
  const sent = progress.stats?.sent || 0;
  const failed = progress.stats?.failed || 0;
  const pending = progress.stats?.pending || Math.max(total - (sent + failed), 0);
  const done = sent + failed;
  const percent = total ? Math.round((done / total) * 100) : 0;

  ui.progressBar.value = percent;
  ui.progressText.textContent = `Status: ${progress.running ? (progress.paused ? 'Paused' : 'Running') : 'Idle'} | Sent ${sent} | Pending ${pending} | Failed ${failed}`;

  if (latest) {
    ui.latestLog.textContent = JSON.stringify(latest, null, 2);
  }
}

async function loadSettings() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  if (response?.ok) {
    settings = { ...DEFAULT_SETTINGS, ...response.settings };
  }
}

async function syncProgress() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_PROGRESS' });
  if (response?.ok) updateProgress(response.progress);
}

ui.rowsTableBody.addEventListener('blur', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.dataset.field !== 'messageTemplate') return;

  const index = Number(target.dataset.index);
  if (Number.isNaN(index) || !parsedRows[index]) return;
  parsedRows[index].messageTemplate = target.textContent.trim();
}, true);

ui.xlsInput.addEventListener('change', async (event) => {
  try {
    const file = event.target.files?.[0];
    if (!file) return;

    parsedRows = await parseWorkbook(file);
    renderRowsTable();

    const invalidCount = parsedRows.filter((r) => !validatePhone(r.mobileNumber)).length;
    setHint(`${file.name} loaded (${parsedRows.length} rows, invalid phones: ${invalidCount})`);
  } catch (error) {
    parsedRows = [];
    ui.tableWrap.classList.add('hidden');
    ui.previewHint.classList.remove('hidden');
    setHint(`File error: ${error.message}`, true);
  }
});

ui.startBtn.addEventListener('click', async () => {
  if (!parsedRows.length) {
    setHint('Please upload a valid XLS/XLSX first.', true);
    return;
  }

  const validRows = parsedRows.filter((row) => validatePhone(row.mobileNumber));
  if (!validRows.length) {
    setHint('No valid phone numbers found in file.', true);
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: 'START_CAMPAIGN',
    payload: {
      rows: validRows,
      settings
    }
  });

  if (!response?.ok) {
    setHint(`Start failed: ${response?.error || 'Unknown error'}`, true);
    return;
  }

  setHint(`Campaign started with ${validRows.length} rows.`);
  updateProgress(response.progress);
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
    updateProgress(message.progress, message.latest);
  }
});

await loadSettings();
await syncProgress();
