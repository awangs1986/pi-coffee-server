import {isIP} from 'node:net';

/** Socket peer only. Proxy headers are untrusted and a peer IP is not device identity. */
export function clientAddress(remoteAddress?:string) {
  const value=remoteAddress?.replace(/^::ffff:/i,'') ?? '';
  const version=isIP(value),address=version ? value : null;
  const privateV4=version===4 && (/^10\./.test(value)||/^192\.168\./.test(value)||/^172\.(1[6-9]|2\d|3[01])\./.test(value));
  const privateV6=version===6 && /^f[cd]/i.test(value);
  return {address,suggestedHost:privateV4||privateV6 ? address : null};
}
