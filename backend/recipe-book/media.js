'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
// Disposable fixture adapter only. A future private object-store adapter implements display(meta).
class LocalRecipeMedia {
 constructor(root){this.root=path.resolve(root);this.fixtureOnly=true;}
 async display(meta){const manifest=JSON.parse(await fs.readFile(path.join(this.root,'manifest.json'),'utf8')),item=manifest[meta.object_key];
  if(!item||item.originalSha256!==meta.sha256||!['image/jpeg','image/png','image/webp'].includes(item.mimeType))throw new Error('Media unavailable');
  const root=await fs.realpath(this.root),file=await fs.realpath(path.resolve(root,item.displayFile));if(!file.startsWith(root+path.sep))throw new Error('Invalid media path');
  const stat=await fs.stat(file);if(stat.size>8*1024*1024)throw new Error('Media too large');const bytes=await fs.readFile(file);
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==item.displaySha256)throw new Error('Media integrity failure');
  return {bytes,mimeType:item.mimeType};
 }
}
module.exports={LocalRecipeMedia};

// Explicit local-only adapter; private originals and display derivatives are never static assets.
class PrivateLocalRecipeMedia extends LocalRecipeMedia {
 constructor(root){super(root);this.fixtureOnly=true;}
 async store(bytes,mimeType){
  const sharp=require('sharp'),format={'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'}[mimeType];
  if(!format||!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>8*1024*1024)throw Error('Invalid image');
  const decoder=sharp(bytes,{limitInputPixels:24000000,failOn:'warning'}),meta=await decoder.metadata();
  if(meta.format!==format||!meta.width||!meta.height||meta.width*meta.height>24000000||(meta.pages||1)>1)throw Error('Invalid image');
  // Decode fully, normalize orientation, strip metadata and resize without cropping.
  const display=await decoder.rotate().resize({width:1400,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:82}).toBuffer();
  if(this.beforeStore)await this.beforeStore(bytes.length,display.length);
  const id=crypto.randomUUID(),hash=b=>crypto.createHash('sha256').update(b).digest('hex'),dir=path.join(this.root,id);
  await fs.mkdir(this.root,{recursive:true,mode:0o700});await fs.chmod(this.root,0o700);await fs.mkdir(dir,{mode:0o700});
  const write=async(name,data)=>{const file=await fs.open(path.join(dir,name),'wx',0o600);try{await file.writeFile(data);await file.sync();}finally{await file.close();}};
  await write('original',bytes);await write('display.webp',display);
  const record={originalSha256:hash(bytes),displaySha256:hash(display)};await write('record.json',JSON.stringify(record));for(const name of [dir,this.root]){const directory=await fs.open(name,'r');try{await directory.sync();}finally{await directory.close();}};
  return {id,object_key:id,mime_type:mimeType,sha256:record.originalSha256,width:meta.width,height:meta.height};
 }
 async display(meta){if(!/^[0-9a-f-]{36}$/.test(meta.object_key))return super.display(meta);const dir=path.join(this.root,meta.object_key),record=JSON.parse(await fs.readFile(path.join(dir,'record.json'),'utf8'));if(record.originalSha256!==meta.sha256)throw Error('Media integrity failure');const bytes=await fs.readFile(path.join(dir,'display.webp'));if(bytes.length>8*1024*1024||crypto.createHash('sha256').update(bytes).digest('hex')!==record.displaySha256)throw Error('Media integrity failure');return {bytes,mimeType:'image/webp'};}
}
module.exports.PrivateLocalRecipeMedia=PrivateLocalRecipeMedia;
