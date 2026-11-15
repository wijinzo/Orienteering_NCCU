import {cp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {dirname,extname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function buildPages({apiBaseUrl='https://orienteering-nccu.onrender.com',basePath='/Orienteering_NCCU/',outputDir=join(root,'.pages-build')}={}){
 const api=new URL(apiBaseUrl);if(!['https:','http:'].includes(api.protocol)||api.username||api.password||api.pathname!=='/'||api.search||api.hash)throw Error('API_BASE_URL must be the Render origin without a path, query or credentials.');
 basePath=basePath||'/';if(!basePath.startsWith('/'))basePath='/'+basePath;if(!basePath.endsWith('/'))basePath+='/';
 if(!/^\/(?:[A-Za-z0-9_.-]+\/)*$/.test(basePath)||basePath.split('/').some(p=>p==='.'||p==='..'))throw Error('Invalid Pages base path.');
 outputDir=resolve(outputDir);if(outputDir!==resolve(root,'.pages-build'))throw Error('Only the generated .pages-build directory may be replaced.');
 await rm(outputDir,{recursive:true,force:true});await mkdir(outputDir,{recursive:true});
 const extensions=new Set(['.html','.js','.css','.svg','.png','.jpg','.jpeg','.webp','.gif','.mp3','.m4a','.ico','.woff','.woff2']);
 async function copyDirectory(directory,relative=''){
  for(const entry of await readdir(directory,{withFileTypes:true})){
   if(entry.name.startsWith('.'))continue;const source=join(directory,entry.name),name=join(relative,entry.name);
   if(entry.isDirectory()){await copyDirectory(source,name);continue;}
   if(!entry.isFile()||!extensions.has(extname(entry.name)))continue;
   // Development-only unused images are not part of the deployed game.
   if(['assets/sightings/campus-collage-v1.png','assets/checkpoint3/nailong_ball.png'].includes(name.replaceAll('\\','/')))continue;
   const target=join(outputDir,name);await mkdir(dirname(target),{recursive:true});
   if(['.html','.css','.js'].includes(extname(entry.name))){
    let text=await readFile(source,'utf8');
    if(extname(entry.name)==='.html')text=text.replace(/\b(href|src)="\/(?!\/)([^"]*)"/g,(_,attribute,path)=>`${attribute}="${basePath}${path}"`);
    else text=text.replaceAll('/assets/',()=>basePath+'assets/');
    await writeFile(target,text);
   }else await cp(source,target);
  }
 }
 await copyDirectory(join(root,'public'));
 await mkdir(join(outputDir,'vendor'),{recursive:true});await cp(join(root,'node_modules/jsqr/dist/jsQR.js'),join(outputDir,'vendor/jsqr.js'));
 await writeFile(join(outputDir,'config.js'),'// Public API endpoint only; generated for GitHub Pages.\nwindow.APP_CONFIG='+JSON.stringify({API_BASE_URL:api.origin})+';\n');
 await writeFile(join(outputDir,'.nojekyll'),'');
 return {outputDir,apiBaseUrl:api.origin,basePath};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=await buildPages({apiBaseUrl:process.env.API_BASE_URL||undefined,basePath:process.env.PAGES_BASE_PATH??'/Orienteering_NCCU/'});console.log('Pages build ready: '+result.outputDir);
}
