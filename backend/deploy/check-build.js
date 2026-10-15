'use strict';
// Runs during npm ci, before Render's pre-deploy migration command. No DB, account or disk access.
const assert=require('node:assert/strict'),sharp=require('sharp');
(async()=>{assert.ok(Number(process.versions.node.split('.')[0])>=22,'Node 22+ required');const image=await sharp({create:{width:8,height:8,channels:3,background:'#234d40'}}).webp().toBuffer();assert.equal((await sharp(image).metadata()).format,'webp');console.log(`Native media build check passed: Node ${process.versions.node}, ${process.platform}/${process.arch}, Sharp ${sharp.versions.sharp}`);})().catch(()=>{console.error('Native media build check failed; do not migrate or deploy this build.');process.exitCode=1;});
