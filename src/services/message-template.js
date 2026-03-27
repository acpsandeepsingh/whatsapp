export function normalizePhone(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

function toTemplateContext(row = {}) {
  const mobileValue = row.mobileNumber ?? row.mobile ?? row.number ?? row.phone ?? '';
  const base = {
    sr_no: row.srNo ?? row.sr_no ?? '',
    srno: row.srNo ?? row.sr_no ?? '',
    number: mobileValue,
    mobile_number: mobileValue,
    mobile: mobileValue,
    phone: mobileValue,
    name: row.name ?? row.contactName ?? row.raw?.name ?? '',
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
