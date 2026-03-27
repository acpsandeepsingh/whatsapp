export function normalizePhone(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

function toTemplateContext(row = {}) {
  const base = {
    sr_no: row.srNo ?? row.sr_no ?? '',
    srno: row.srNo ?? row.sr_no ?? '',
    number: row.mobileNumber ?? row.number ?? row.phone ?? '',
    mobile_number: row.mobileNumber ?? row.number ?? row.phone ?? '',
    phone: row.mobileNumber ?? row.number ?? row.phone ?? '',
    attachment_url: row.attachmentUrl ?? ''
  };

  if (row.raw && typeof row.raw === 'object') {
    Object.entries(row.raw).forEach(([key, value]) => {
      base[String(key).trim().toLowerCase().replace(/\s+/g, '_')] = value;
    });
  }

  return base;
}

export function applyTemplate(template, row = {}) {
  const context = toTemplateContext(row);
  const safeTemplate = String(template || '');

  return safeTemplate.replace(/\{\{\s*([a-zA-Z0-9_\- ]+)\s*\}\}/g, (_match, variable) => {
    const key = String(variable).trim().toLowerCase().replace(/[\s-]+/g, '_');
    return context[key] ?? '';
  });
}
