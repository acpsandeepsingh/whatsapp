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


function normalizeRowArray(row) {
  if (Array.isArray(row)) return row;
  if (!row || typeof row !== 'object') return [];

  const entries = Object.entries(row)
    .filter(([key]) => /^\d+$/.test(String(key)))
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, value]) => value);

  return entries;
}

function normalizeHeader(value) {
  return normalizeCell(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function detectColumnIndexes(headerRow = []) {
  const row = normalizeRowArray(headerRow);
  const normalized = row.map(normalizeHeader);

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

function inferColumnIndexesFromData(rows = [], baseIndexes = {}) {
  const sampleRows = rows
    .map(normalizeRowArray)
    .filter((row) => row.some((cell) => normalizeCell(cell) !== ''))
    .slice(0, 50);

  if (!sampleRows.length) {
    return baseIndexes;
  }

  const stats = new Map();
  const ensureStats = (columnIndex) => {
    if (!stats.has(columnIndex)) {
      stats.set(columnIndex, { validPhones: 0, numericValues: 0, nonEmptyValues: 0 });
    }
    return stats.get(columnIndex);
  };

  sampleRows.forEach((row) => {
    row.forEach((cell, columnIndex) => {
      const normalized = normalizeCell(cell);
      if (!normalized) return;

      const columnStats = ensureStats(columnIndex);
      columnStats.nonEmptyValues += 1;

      const digitLength = toDigits(normalized).length;
      if (/^\d+$/.test(normalized) || digitLength >= 8) {
        columnStats.numericValues += 1;
      }

      if (isValidPhone(normalized)) {
        columnStats.validPhones += 1;
      }
    });
  });

  const candidates = [...stats.entries()]
    .map(([columnIndex, columnStats]) => ({ columnIndex, ...columnStats }))
    .filter((column) => column.validPhones > 0)
    .sort((a, b) => {
      if (b.validPhones !== a.validPhones) return b.validPhones - a.validPhones;
      if (b.numericValues !== a.numericValues) return b.numericValues - a.numericValues;
      return a.columnIndex - b.columnIndex;
    });

  if (!candidates.length) {
    return baseIndexes;
  }

  const mobileIndex = candidates[0].columnIndex;
  const srNoIndex = mobileIndex > 0 ? mobileIndex - 1 : baseIndexes.srNoIndex ?? 0;
  const messageIndex = mobileIndex + 1;
  const attachmentIndex = mobileIndex + 2;

  return {
    ...baseIndexes,
    srNoIndex,
    mobileIndex,
    messageIndex,
    attachmentIndex
  };
}

function isHeaderRow(row = []) {
  const joined = normalizeRowArray(row).map(normalizeHeader).filter(Boolean).join('|');
  return /mobile|phone|whatsapp|message|template|sr/.test(joined);
}

function parseRows(rows = [], indexes = {}, { headerDetected = false } = {}) {
  const output = [];

  for (let index = 0; index < rows.length; index += 1) {
    if (headerDetected && index === 0) continue;

    const row = normalizeRowArray(rows[index]);
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

  return output;
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

  const firstRow = normalizeRowArray(rows[0]);
  const headerDetected = isHeaderRow(firstRow);
  let indexes = detectColumnIndexes(firstRow);

  if (!headerDetected) {
    indexes = inferColumnIndexesFromData(rows, indexes);
  }

  if (headerDetected) {
    console.log('[WA CRM][XLS] Header row detected and skipped:', rows[0], indexes);
  }

  let output = parseRows(rows, indexes, { headerDetected });

  // Some sheets include a title row with words like "phone" which can be misdetected
  // as a real header. If that happens and import result is empty, retry with inferred indexes.
  if (!output.length && rows.length > 1) {
    const fallbackIndexes = inferColumnIndexesFromData(rows.slice(1), indexes);
    const fallbackOutput = parseRows(rows, fallbackIndexes, { headerDetected });

    if (fallbackOutput.length) {
      console.warn('[WA CRM][XLS] Recovered import with fallback column inference:', {
        previousIndexes: indexes,
        fallbackIndexes
      });
      indexes = fallbackIndexes;
      output = fallbackOutput;
    }
  }

  console.log('[WA CRM][XLS] Import summary:', {
    totalRows: rows.length,
    importedRows: output.length,
    headerDetected,
    indexes
  });

  return output;
}
