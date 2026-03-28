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

function normalizeHeader(value) {
  return normalizeCell(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function detectColumnIndexes(headerRow = []) {
  const normalized = headerRow.map(normalizeHeader);

  const findColumn = (patterns = [], fallbackIndex = -1) => {
    const index = normalized.findIndex((value) => patterns.some((pattern) => pattern.test(value)));
    return index >= 0 ? index : fallbackIndex;
  };

  const srNoIndex = findColumn([/^sr(_?no)?$/, /^serial(_?no)?$/, /^s_?no$/], 0);
  const mobileIndex = findColumn([/mobile/, /phone/, /whatsapp/, /^contact(_?number)?$/, /^number$/], 1);
  const nameIndex = findColumn([/^name$/, /contact_name/, /^customer$/], -1);
  const messageIndex = findColumn([/message/, /^msg$/, /template/, /text/], 2);
  const attachmentIndex = findColumn([/attachment/, /media/, /file/, /document/, /url/], 3);

  return { srNoIndex, mobileIndex, nameIndex, messageIndex, attachmentIndex, normalized };
}

function isHeaderRow(row = []) {
  const joined = row.map(normalizeHeader).filter(Boolean).join('|');
  return /mobile|phone|whatsapp|message|template|sr/.test(joined);
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

  if (!rows.length) {
    return [];
  }

  const headerDetected = isHeaderRow(rows[0]);
  const indexes = detectColumnIndexes(rows[0]);

  if (headerDetected) {
    console.log('[WA CRM][XLS] Header row detected and skipped:', rows[0], indexes);
  }

  const output = [];
  for (let index = 0; index < rows.length; index += 1) {
    if (headerDetected && index === 0) continue;

    const row = Array.isArray(rows[index]) ? rows[index] : [];
    const isCompletelyEmpty = row.every((cell) => normalizeCell(cell) === '');
    if (isCompletelyEmpty) continue;

    const srNo = normalizeCell(row[indexes.srNoIndex]) || String(output.length + 1);
    const mobileRaw = normalizeCell(row[indexes.mobileIndex]);
    const mobileNumber = toDigits(mobileRaw);
    const name = indexes.nameIndex >= 0 ? normalizeCell(row[indexes.nameIndex]) : '';
    const messageTemplate = normalizeCell(row[indexes.messageIndex]);
    const attachmentUrl = normalizeCell(row[indexes.attachmentIndex]);

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
      name,
      messageTemplate,
      attachmentUrl,
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
    importedRows: output.length,
    headerDetected,
    indexes
  });

  return output;
}
