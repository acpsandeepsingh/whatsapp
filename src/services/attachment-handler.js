export async function downloadAttachmentAsFile(url) {
  const sourceUrl = String(url || '').trim();
  if (!sourceUrl) {
    throw new Error('Attachment URL is empty');
  }

  const response = await fetch(sourceUrl, {
    method: 'GET',
    credentials: 'omit'
  });

  if (!response.ok) {
    throw new Error(`Attachment download failed (${response.status})`);
  }

  const blob = await response.blob();
  if (!blob || !blob.size) {
    throw new Error('Attachment download returned an empty file');
  }

  let pathname = `attachment-${Date.now()}`;
  try {
    const parsed = new URL(sourceUrl, window.location.href);
    pathname = parsed.pathname.split('/').pop() || pathname;
  } catch (_error) {
    pathname = `attachment-${Date.now()}`;
  }
  const hasExt = pathname.includes('.');

  const fileName = hasExt ? pathname : `${pathname}.${blob.type.split('/')[1] || 'bin'}`;

  return new File([blob], fileName, {
    type: blob.type || 'application/octet-stream',
    lastModified: Date.now()
  });
}
