// Inert upload references only; fresh scoped URLs are resolved by the caller.
export function splitUploadedFilesText(rawText, downloadUrl = () => undefined) {
  const text = String(rawText || '');
  const marker = '\n\n[已上传到工作目录的文件]\n';
  const cut = text.indexOf(marker);
  if (cut < 0) return { text, files: [] };
  const body = text.slice(0, cut);
  const tail = text.slice(cut + marker.length);
  const files = [];
  for (const line of tail.split('\n')) {
    const match = /^- (.+?)(?: \(([^()]+)\))?$/.exec(line.trim());
    if (!match) continue;
    const path = match[1].trim();
    const name = path.split('/').pop() || path;
    const sizeText = match[2] || '';
    files.push({ name, path, uploadPath: path, sizeText, href: downloadUrl(path) });
  }
  return { text: body, files };
}

