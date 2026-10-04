/** Only canonical shell destinations may survive an OAuth round trip. */
export function conversationReturnTo(value:unknown):string {
  return typeof value==='string' && /^\/conversations\/[A-Za-z0-9_-]{1,256}$/.test(value) ? value : '/';
}
export function isShellPath(path:string):boolean {
  return path==='/' || path==='/index.html' || conversationReturnTo(path)!=='/';
}
export function loginDestination(login:string,path:string):string {
  const target=conversationReturnTo(path);
  return target==='/'?login:login+'?returnTo='+encodeURIComponent(target);
}
