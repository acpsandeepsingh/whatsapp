const ui = {
  openDashboardBtn: document.getElementById('openDashboardBtn'),
  startAutomationBtn: document.getElementById('startAutomationBtn'),
  checkStatusBtn: document.getElementById('checkStatusBtn'),
  statusText: document.getElementById('statusText'),
  latestLog: document.getElementById('latestLog')
};

function renderProgress(progress, latest = null) {
  const total = progress?.total || 0;
  const sent = progress?.stats?.sent || 0;
  const failed = progress?.stats?.failed || 0;
  const pending = progress?.stats?.pending ?? Math.max(total - (sent + failed), 0);
  const state = progress?.running ? (progress?.paused ? 'Paused' : 'Running') : 'Idle';

  ui.statusText.textContent = `Status: ${state} | Total: ${total} | Sent: ${sent} | Pending: ${pending} | Failed: ${failed}`;
  if (latest) {
    ui.latestLog.textContent = JSON.stringify(latest, null, 2);
  }
}

async function checkStatus() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_PROGRESS' });
  if (!response?.ok) {
    ui.latestLog.textContent = `Unable to fetch progress: ${response?.error || 'Unknown error'}`;
    return;
  }

  renderProgress(response.progress);
}

ui.openDashboardBtn.addEventListener('click', async () => {
  await chrome.runtime.openOptionsPage();
});

ui.startAutomationBtn.addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({
    type: 'START_CAMPAIGN_FROM_STORAGE'
  });

  if (!response?.ok) {
    ui.latestLog.textContent = `Start failed: ${response?.error || 'Unknown error'}`;
    return;
  }

  renderProgress(response.progress, { status: 'started-from-popup' });
});

ui.checkStatusBtn.addEventListener('click', checkStatus);

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'PROGRESS_UPDATE') {
    renderProgress(message.progress, message.latest);
  }
});

checkStatus();
