import { parseWorkbook, validatePhone } from '../services/xls-parser.js';

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
  statusText: document.getElementById('statusText'),
  progressLine: document.getElementById('progressLine'),
  progressBar: document.getElementById('progressBar'),
  latestLog: document.getElementById('latestLog'),
  rowsTableBody: document.getElementById('rowsTableBody')
};

let rows = [];

function uid() {
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultRow() {
  return {
    id: uid(),
    srNo: rows.length + 1,
    mobileNumber: '',
    messageTemplate: 'Hello {{mobile}}, your serial is {{sr_no}}',
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

  const targetIndex = Number(latest.index) - 1;
  if (Number.isNaN(targetIndex) || !rows[targetIndex]) return;

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

async function startCampaign() {
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
    payload: { rows: validRows }
  });

  if (!response?.ok) {
    setStatus(`Start failed: ${response?.error || 'Unknown error'}`, true);
    return;
  }

  setStatus(`Campaign started with ${validRows.length} valid row(s).`);
  renderProgress(response.progress, { status: 'started' });
}

async function startFromPopupMode() {
  const response = await chrome.runtime.sendMessage({
    type: 'START_CAMPAIGN_FROM_STORAGE'
  });

  if (!response?.ok) {
    setStatus(`Start failed: ${response?.error || 'Unknown error'}`, true);
    return;
  }

  renderProgress(response.progress, { status: 'started-from-storage' });
}

ui.rowsTableBody.addEventListener('blur', async (event) => {
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
}, true);

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
    rows = parsed.map((row, index) => ({ ...row, srNo: row.srNo || index + 1, status: 'Pending' }));
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

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'PROGRESS_UPDATE') {
    renderProgress(message.progress, message.latest);
  }
});

await loadRows();
renderRows();

const initialProgress = await chrome.runtime.sendMessage({ type: 'GET_PROGRESS' });
if (initialProgress?.ok) {
  renderProgress(initialProgress.progress);
}

if (new URLSearchParams(window.location.search).get('autoStart') === '1') {
  await startFromPopupMode();
}
