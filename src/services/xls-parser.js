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

function parseDelimitedLine(line, delimiter) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      const nextChar = line[index + 1];
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function chooseDelimiter(lines = []) {
  const nonEmptyLine = lines.map((line) => String(line || '')).find((line) => line.trim() !== '') || '';
  const delimiters = [',', '\t', ';', '|'];
  const scored = delimiters.map((delimiter) => ({
    delimiter,
    score: (nonEmptyLine.match(new RegExp(`\\${delimiter === '\t' ? 't' : delimiter}`, 'g')) || []).length
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].delimiter : ',';
}

function parsePlainTextRows(text) {
  if (!text) return [];

  const normalizedText = text.includes('\n')
    ? text
    : (text.includes('\\n') ? text.replace(/\\n/g, '\n') : text);

  const rawLines = normalizedText
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (!rawLines.length) return [];

  const delimiter = chooseDelimiter(rawLines);
  return rawLines.map((line) => parseDelimitedLine(line, delimiter));
}

export function readRowsFromWorkbook(file, arrayBuffer) {
  if (!window.XLSX) {
    throw new Error('SheetJS (XLSX) is not loaded.');
  }

  const workbook = window.XLSX.read(arrayBuffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const workbookRows = window.XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: true
  });

  if (workbookRows.length) return workbookRows;

  const lowerName = String(file?.name || '').toLowerCase();
  const isTextLike = /\.(csv|txt|tsv)$/.test(lowerName) || (file?.type || '').includes('text');
  if (!isTextLike) return workbookRows;

  const decodedText = new TextDecoder('utf-8').decode(arrayBuffer);
  return parsePlainTextRows(decodedText);
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

function findLikelyHeaderRowIndex(rows = []) {
  for (let index = 0; index < rows.length; index += 1) {
    if (isHeaderRow(rows[index])) return index;
  }
  return -1;
}

function parseRows(rows = [], indexes = {}, { headerDetected = false, logInvalidRows = false } = {}) {
  const output = [];
  let invalidRowCount = 0;

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
      invalidRowCount += 1;
      if (logInvalidRows) {
        console.warn('[WA CRM][XLS] Ignoring invalid row:', {
          rowNumber: index + 1,
          srNo,
          mobileRaw,
          mobileNumber,
          messageTemplate
        });
      }
      continue;
    }

    const parsedRow = {
      id: `row-${index + 1}-${mobileNumber.slice(-6)}`,
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
    output.push(parsedRow);
  }

  return { rows: output, invalidRowCount };
}

export async function parseWorkbook(file, { hasHeader = null } = {}) {
  if (!window.XLSX) {
    throw new Error('SheetJS (XLSX) is not loaded.');
  }

  const arrayBuffer = await file.arrayBuffer();
  const rows = readRowsFromWorkbook(file, arrayBuffer);

  if (!rows.length) {
    return [];
  }

  const firstRow = normalizeRowArray(rows[0]);
  const explicitHeaderChoice = hasHeader === true || hasHeader === false ? hasHeader : null;
  let headerDetected = explicitHeaderChoice ?? isHeaderRow(firstRow);
  let indexes = detectColumnIndexes(firstRow);
  let parseStartIndex = 0;

  if (!headerDetected) {
    indexes = inferColumnIndexesFromData(rows, indexes);
  } else {
    parseStartIndex = 1;
  }

  if (headerDetected) {
    console.log('[WA CRM][XLS] Header row detected and skipped:', rows[0], indexes);
  }

  let { rows: output, invalidRowCount } = parseRows(rows.slice(parseStartIndex), indexes, { headerDetected: false });

  if (!output.length && rows.length > 1) {
    const fallbackIndexes = inferColumnIndexesFromData(rows.slice(1), indexes);
    const fallbackParsed = parseRows(rows.slice(parseStartIndex), fallbackIndexes, { headerDetected: false });
    const fallbackOutput = fallbackParsed.rows;

    if (fallbackOutput.length) {
      console.warn('[WA CRM][XLS] Recovered import with fallback column inference:', {
        previousIndexes: indexes,
        fallbackIndexes
      });
      indexes = fallbackIndexes;
      output = fallbackOutput;
      invalidRowCount = fallbackParsed.invalidRowCount;
    }
  }

  if (!output.length && rows.length > 2) {
    const headerRowIndex = findLikelyHeaderRowIndex(rows.slice(1));
    if (headerRowIndex >= 0) {
      const actualHeaderIndex = headerRowIndex + 1;
      const actualHeader = normalizeRowArray(rows[actualHeaderIndex]);
      const headerIndexes = detectColumnIndexes(actualHeader);
      const bodyRows = rows.slice(actualHeaderIndex + 1);
      const headerParsed = parseRows(bodyRows, headerIndexes, { headerDetected: false });
      const headerOutput = headerParsed.rows;

      if (headerOutput.length) {
        console.warn('[WA CRM][XLS] Recovered import by detecting header row later in sheet:', {
          actualHeaderIndex,
          headerIndexes
        });
        output = headerOutput;
        indexes = headerIndexes;
        headerDetected = true;
        invalidRowCount = headerParsed.invalidRowCount;
      }
    }
  }

  console.log('[WA CRM][XLS] Import summary:', {
    totalRows: rows.length,
    importedRows: output.length,
    invalidRows: invalidRowCount,
    headerDetected,
    indexes
  });

  return output;
}
