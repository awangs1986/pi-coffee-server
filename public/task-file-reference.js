// URL escaping belongs to authored Markdown, never to a platform file reference.
export function markdownFilePath(destination) {
  if (typeof destination !== 'string' || destination.length > 8192) return null;
  const authored = destination.split(/[?#]/, 1)[0];
  let path;
  try { path = decodeURIComponent(authored.replace(/%(?![0-9a-f]{2})/gi, '%25')); }
  catch { return null; }
  if (!path || /^[a-z][a-z\d+.-]*:|^\/\/|[\\\u0000-\u001f\u007f]/i.test(path)) return null;
  return path;
}

// Compare task references for display. The Host authorizes the resolved file.
export function canonicalTaskPath(path, cwd = '') {
  const absolute = path.startsWith('/');
  const parts = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..' && parts.length && parts.at(-1) !== '..') parts.pop();
    else if (part !== '..' || !absolute) parts.push(part);
  }
  const clean = (absolute ? '/' : '') + parts.join('/');
  if (!absolute || !cwd) return clean;
  if (clean.startsWith(cwd + '/')) return clean.slice(cwd.length + 1);
  const parent = cwd.slice(0, cwd.lastIndexOf('/') + 1);
  const sibling = clean.startsWith(parent) && clean.slice(parent.length);
  return sibling && /^(artifacts|attachments|images|research)\//.test(sibling) ? '../' + sibling : clean;
}
