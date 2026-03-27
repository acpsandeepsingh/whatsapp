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

  return rows.map((row, index) => {
    const normalized = {
      srNo: row['Sr No'] || row['SrNo'] || row['sr no'] || row['SR NO'] || index + 1,
      mobileNumber: String(row['Mobile Number'] || row['mobile number'] || row['Mobile'] || '').trim(),
      messageTemplate: String(row['Message Template'] || row['message template'] || row['Message'] || '').trim(),
      attachmentUrl: String(row['Attachment URL'] || row['attachment url'] || row['Attachment'] || '').trim()
    };

    if (!normalized.mobileNumber) {
      throw new Error(`Row ${index + 2}: Mobile Number is required.`);
    }

    return normalized;
  });
}
