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

function normalizeCell(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
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
    header: 1,
    defval: '',
    raw: true
  });

  const output = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = Array.isArray(rows[index]) ? rows[index] : [];
    const isCompletelyEmpty = row.every((cell) => normalizeCell(cell) === '');
    if (isCompletelyEmpty) continue;

    const srNo = normalizeCell(row[0]) || String(output.length + 1);
    const mobileNumber = toDigits(row[1]);
    const messageTemplate = normalizeCell(row[2]);

    if (!mobileNumber) {
      throw new Error(`Row ${index + 1}: mobile number is required.`);
    }

    output.push({
      id: `row-${index}-${Date.now()}`,
      srNo,
      mobileNumber,
      name: '',
      messageTemplate,
      attachmentUrl: '',
      isValidPhone: isValidPhone(mobileNumber),
      raw: {
        rowNumber: index + 1,
        source: row
      }
    });
  }

  return output;
}
