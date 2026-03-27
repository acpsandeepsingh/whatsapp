export async function downloadAttachmentAsFile(url) {
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'omit'
  });

  if (!response.ok) {
    throw new Error(`Attachment download failed (${response.status})`);
  }

  const blob = await response.blob();
  const parsed = new URL(url, window.location.href);
  const pathname = parsed.pathname.split('/').pop() || `attachment-${Date.now()}`;
  const hasExt = pathname.includes('.');

  const fileName = hasExt ? pathname : `${pathname}.${blob.type.split('/')[1] || 'bin'}`;

  return new File([blob], fileName, {
    type: blob.type || 'application/octet-stream',
    lastModified: Date.now()
  });
}
