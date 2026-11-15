// QR URLs never navigate to an arbitrary scanned website.
export function checkpointFromQr(raw, origin) {
  let url;
  try { url = new URL(raw, origin); } catch { return null; }
  if (url.origin !== origin || url.username || url.password || url.hash || [...url.searchParams.keys()].some(key=>key!=='code') || url.searchParams.getAll('code').length>1) return null;
  const match = /^\/checkpoint\/([1-9]|1[0-3])\/?$/.exec(url.pathname);
  const code = url.searchParams.has('code') ? checkpointFromCode(url.searchParams.get('code')) : null;
  if (url.searchParams.has('code')&&!code) return null;
  return match ? { checkpoint: Number(match[1]), code } : null;
}
export function remainingSeconds(deadline, now) { return Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000)); }
export function checkpointFromCode(raw) {
  const code = String(raw).replace(/[\s-]/g,'').toUpperCase();
  return /^[A-HJ-NP-Z2-9]{8}$/.test(code) ? code : null;
}
