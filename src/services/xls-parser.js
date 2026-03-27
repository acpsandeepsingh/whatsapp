function normalizeHeaders(row) {
  const normalized = {};
  Object.entries(row).forEach(([key, value]) => {
    normalized[String(key || '').trim().toLowerCase()] = value;
  });
  return normalized;
}

function toDigits(value) {
  return String(value ?? '').replace(/[^\d]/g, '');
}

function isValidPhone(value) {
  const digits = toDigits(value);
  return digits.length >= 8 && digits.length <= 15;
}

export function validatePhone(value) {
  return isValidPhone(value);
}

function pickField(row, aliases = []) {
  for (const key of aliases) {
    const value = row[key.toLowerCase()];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

export async function parseWorkbook(file) {
  if (!window.XLSX) {
    throw new Error('SheetJS (XLSX) is not loaded.');
  }

  const arrayBuffer = await file.arrayBuffer();
  const workbook = window.XLSX.read(arrayBuffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const rows = window.XLSX.utils.sheet_to_json(sheet, {
    defval: '',
    raw: false
  });

  return rows.map((inputRow, index) => {
    const row = normalizeHeaders(inputRow);
    const srNo = pickField(row, ['sr no', 'srno', 'serial no', 'serial']) || String(index + 1);
    const mobileNumber = pickField(row, ['mobile number', 'mobile', 'phone', 'number', 'whatsapp number']);
    const messageTemplate = pickField(row, ['message template', 'message', 'template']);
    const attachmentUrl = pickField(row, ['attachment url', 'attachment', 'file url', 'media url']);

    if (!mobileNumber) {
      throw new Error(`Row ${index + 2}: Mobile Number is required.`);
    }

    return {
      id: `row-${index}-${Date.now()}`,
      srNo,
      mobileNumber,
      messageTemplate,
      attachmentUrl,
      isValidPhone: isValidPhone(mobileNumber),
      raw: inputRow
    };
  });
}
