export const APP_ROOT=new URL('./',import.meta.url);
export const APP_BASE_PATH=APP_ROOT.pathname;
export function checkpointFromLocation(current=location,basePath=APP_BASE_PATH){
 const url=new URL(current.href),query=url.searchParams.getAll('checkpoint');
 if(query.length)return query.length===1&&/^(?:[1-9]|1[0-3])$/.test(query[0])?Number(query[0]):null;
 const relative=url.pathname.startsWith(basePath)?url.pathname.slice(basePath.length):'';
 const legacy=/^checkpoint\/([1-9]|1[0-3])\/?$/.exec(relative);
 return legacy?Number(legacy[1]):null;
}
export function checkpointUrl(checkpoint){const url=new URL(APP_ROOT);url.searchParams.set('checkpoint',String(checkpoint));return url.href;}
export function homeUrl(){return APP_ROOT.href;}
