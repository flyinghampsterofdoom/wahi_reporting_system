'use strict';
const {localPool}=require('./repository/postgres');
const {checkSchema}=require('./migrate');
const pool=localPool();
checkSchema(pool).then(()=>console.log('Backend schema is ready; no changes made.')).catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>pool.end());
