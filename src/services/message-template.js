export function normalizePhone(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

export function buildPersonalizedMessage(template, row) {
  const safeTemplate = String(template || '');
  return safeTemplate
    .replace(/\{\{\s*sr\s*no\s*\}\}/gi, row.srNo ?? '')
    .replace(/\{\{\s*mobile\s*number\s*\}\}/gi, row.phone ?? '')
    .trim();
}
