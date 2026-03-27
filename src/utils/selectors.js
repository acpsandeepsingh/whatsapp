export const SELECTORS = {
  chatSearchInputs: [
    '[contenteditable="true"][data-tab="3"]',
    '[role="textbox"][contenteditable="true"]'
  ],
  messageBox: [
    'footer [contenteditable="true"][data-tab="10"]',
    'footer [contenteditable="true"][data-tab="1"]',
    'footer div[role="textbox"][contenteditable="true"]'
  ],
  sendButton: [
    'button[aria-label="Send"]',
    'span[data-icon="send"]',
    'button span[data-icon="send"]'
  ],
  attachButton: [
    'button[title="Attach"]',
    'div[aria-label="Attach"]',
    'span[data-icon="plus-rounded"]'
  ],
  fileInput: [
    'input[type="file"]',
    'input[accept*="image"], input[accept*="video"], input[accept*="*/*"]'
  ],
  groupInfoPanel: [
    '[data-testid="chat-list-search"]',
    '[aria-label*="Group info"]',
    '[title="Group info"]'
  ],
  participantsContainer: [
    'div[aria-label*="Participants"]',
    '#app div[role="application"] div[tabindex="-1"]'
  ],
  participantRows: [
    '[role="listitem"]',
    'div[data-testid="cell-frame-container"]',
    'div[tabindex="-1"]'
  ]
};

export function queryWithFallback(selectors, root = document) {
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    if (el) return el;
  }
  return null;
}

export function queryAllWithFallback(selectors, root = document) {
  for (const selector of selectors) {
    const els = [...root.querySelectorAll(selector)];
    if (els.length) return els;
  }
  return [];
}
