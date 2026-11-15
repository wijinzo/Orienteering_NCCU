// QR URLs never navigate to an arbitrary scanned website.
export function checkpointFromQr(raw, origin, basePath='/') {
  let url;
  try { url = new URL(raw, origin); } catch { return null; }
  if (url.origin !== origin || url.username || url.password || url.hash || [...url.searchParams.keys()].some(key=>!['code','checkpoint'].includes(key)) || url.searchParams.getAll('code').length>1 || url.searchParams.getAll('checkpoint').length>1) return null;
  if(!basePath.startsWith('/')||!basePath.endsWith('/'))return null;
  let checkpoint=null;
  if(url.searchParams.has('checkpoint')){
    if(![basePath,basePath+'index.html'].includes(url.pathname))return null;
    const value=url.searchParams.get('checkpoint');if(!/^(?:[1-9]|1[0-3])$/.test(value))return null;checkpoint=Number(value);
  }else{
    if(!url.pathname.startsWith(basePath))return null;
    const match=/^checkpoint\/([1-9]|1[0-3])\/?$/.exec(url.pathname.slice(basePath.length));if(!match)return null;checkpoint=Number(match[1]);
  }
  const code = url.searchParams.has('code') ? checkpointFromCode(url.searchParams.get('code')) : null;
  if (url.searchParams.has('code')&&!code) return null;
  return { checkpoint, code };
}
export function remainingSeconds(deadline, now) { return Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000)); }
export function checkpointFromCode(raw) {
  const code = String(raw).replace(/[\s-]/g,'').toUpperCase();
  return /^[A-HJ-NP-Z2-9]{8}$/.test(code) ? code : null;
}
