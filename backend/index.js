'use strict';
const {DomainService}=require('./service');
const {PostgresRepository,localPool}=require('./repository/postgres');
const {checkSchema}=require('./migrate');

// Initialization reads migration metadata only. No DDL, seeds or user resets.
async function openBackend() {
  const pool=localPool();
  try {await checkSchema(pool);return {service:new DomainService(new PostgresRepository(pool)),close:()=>pool.end()};}
  catch(error) {await pool.end();throw error;}
}
module.exports={openBackend,DomainService};
