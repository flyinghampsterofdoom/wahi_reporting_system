'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {Pool}=require('pg');
const {execFileSync,spawn}=require('node:child_process');
const crypto=require('node:crypto');
const {DomainService}=require('../service');
const {PostgresRepository}=require('../repository/postgres');
const {migrate,checkSchema}=require('../migrate');
const {createUser}=require('./auth');
const {seed}=require('./seed');
const root=path.join(__dirname,'.runtime'),data=path.join(root,'postgres');
const bin='/opt/homebrew/opt/postgresql@16/bin';
function pg(command,args){return execFileSync(path.join(bin,command),args,{stdio:'pipe'});}
function running(){try{pg('pg_ctl',['-D',data,'status']);return true;}catch{return false;}}
function startDb(){if(!running())pg('pg_ctl',['-D',data,'-l',path.join(root,'postgres.log'),'-o',`-k ${root} -h '' -p 55441`,'-w','start']);}
function pool(){return new Pool({host:root,port:55441,user:'wahi_review',database:'postgres',max:5});}
async function openReview(){
  const marker=JSON.parse(await fs.readFile(path.join(root,'ready.json'),'utf8'));
  if(marker.kind!=='wahi-isolated-owner-review')throw new Error('Invalid review database marker');
  const db=pool();try{await checkSchema(db);return {service:new DomainService(new PostgresRepository(db)),pool:db,users:JSON.parse(await fs.readFile(path.join(root,'users.json'),'utf8'))};}catch(e){await db.end();throw e;}
}
async function setup(){
  try{await fs.access(path.join(root,'ready.json'));console.log('Review already provisioned. Existing data retained.');return;}catch{}
  await fs.mkdir(root,{recursive:true,mode:0o700});await fs.chmod(root,0o700);
  try{await fs.access(path.join(data,'PG_VERSION'));}catch{pg('initdb',['-D',data,'--auth=trust','--username=wahi_review','--no-locale','-E','UTF8']);}
  startDb();const db=pool();
  try{await migrate(db);await seed(new DomainService(new PostgresRepository(db)));}finally{await db.end();}
  const accounts=[],users=[];
  for(const [username,role]of [['owner','ADMIN'],['manager','MANAGER'],['lead','LEAD'],['staff','STAFF']]){
    const password=crypto.randomBytes(15).toString('base64url');accounts.push({username,role,password});users.push(await createUser(username,role,password));
  }
  await fs.writeFile(path.join(root,'users.json'),JSON.stringify(users,null,2),{mode:0o600});
  await fs.writeFile(path.join(root,'access.json'),JSON.stringify(accounts,null,2),{mode:0o600});
  await fs.writeFile(path.join(root,'ACCESS.md'),'# Local Wahi owner review\n\nOpen http://127.0.0.1:4317\n\nSynthetic data only. These logins do not access production.\n\n'+accounts.map(a=>`- ${a.role}: username \`${a.username}\`, password \`${a.password}\``).join('\n')+'\n',{mode:0o600});
  await fs.writeFile(path.join(root,'ready.json'),JSON.stringify({kind:'wahi-isolated-owner-review',createdAt:new Date().toISOString()}),{mode:0o600});
  console.log('Provisioned isolated PostgreSQL and synthetic review data. Credentials: backend/review/.runtime/ACCESS.md');
}
async function start(){
  await fs.access(path.join(root,'ready.json'));startDb();
  let response;try{response=await fetch('http://127.0.0.1:4317/api/me');}catch{}
  if(response){if(response.headers.get('x-wahi-review')==='local-synthetic'){console.log('Review is already running at http://127.0.0.1:4317');return;}throw new Error('Port 4317 is occupied. No process was replaced.');}
  const log=await fs.open(path.join(root,'http.log'),'a',0o600);
  const child=spawn(process.execPath,[path.join(__dirname,'server.js')],{detached:true,stdio:['ignore',log.fd,log.fd]});child.unref();await log.close();await fs.writeFile(path.join(root,'http.pid'),String(child.pid),{mode:0o600});
  console.log('Starting owner review at http://127.0.0.1:4317');
}
async function stop(){
  try{const pid=Number(await fs.readFile(path.join(root,'http.pid'),'utf8'));const command=execFileSync('ps',['-p',String(pid),'-o','args='],{encoding:'utf8'});if(command.includes(path.join(__dirname,'server.js')))process.kill(pid,'SIGTERM');}catch{}
  if(running())pg('pg_ctl',['-D',data,'-m','fast','-w','stop']);console.log('Review stopped. Review data and legacy application retained.');
}
async function migrateReview(){const marker=JSON.parse(await fs.readFile(path.join(root,'ready.json'),'utf8'));if(marker.kind!=='wahi-isolated-owner-review')throw new Error('Invalid review marker');startDb();const db=pool();try{console.log({applied:await migrate(db)});}finally{await db.end();}}
module.exports={openReview,setup,start,stop,root};
if(require.main===module){const action={setup,start,stop,migrate:migrateReview}[process.argv[2]];if(!action){console.error('Use: node backend/review/runtime.js setup|start|stop|migrate');process.exitCode=1;}else action().catch(e=>{console.error(e.message);process.exitCode=1;});}
