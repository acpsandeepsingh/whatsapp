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

    // Expected format:
    // [0] Sr No | [1] Mobile Number | [2] Message
    // Skip header row even when values are styled/capitalized differently.
    if (index === 0) {
      const headerSr = normalizeCell(row[0]).toLowerCase();
      const headerMobile = normalizeCell(row[1]).toLowerCase();
      const headerMessage = normalizeCell(row[2]).toLowerCase();
      const hasExpectedHeaders =
        headerSr.includes('sr') &&
        headerMobile.includes('mobile') &&
        (headerMessage.includes('message') || headerMessage.includes('msg'));
      if (hasExpectedHeaders) {
        console.log('[WA CRM][XLS] Header row detected and skipped:', row);
        continue;
      }
    }

    const srNo = normalizeCell(row[0]) || String(output.length + 1);
    const mobileRaw = normalizeCell(row[1]);
    const mobileNumber = toDigits(String(mobileRaw));
    const messageTemplate = normalizeCell(row[2]);

    if (!mobileNumber || !isValidPhone(mobileNumber)) {
      console.warn('[WA CRM][XLS] Ignoring invalid row:', {
        rowNumber: index + 1,
        srNo,
        mobileRaw,
        mobileNumber,
        messageTemplate
      });
      continue;
    }

    const parsedRow = {
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
    };

    console.log('[WA CRM][XLS] Parsed row:', parsedRow);
    output.push(parsedRow);
  }

  console.log('[WA CRM][XLS] Import summary:', {
    totalRows: rows.length,
    importedRows: output.length
  });

  return output;
}
