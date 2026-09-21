'use strict';
const crypto=require('node:crypto');
async function allow(pool,key,limit=5,seconds=3600){
 // Fixed buckets, hashes only; prune expired keys so arbitrary public input cannot grow forever.
 await pool.query('DELETE FROM wahi_v2.email_rate_limits WHERE expires_at<CURRENT_TIMESTAMP');
 const r=(await pool.query(`INSERT INTO wahi_v2.email_rate_limits(key,attempts,expires_at) VALUES($1,1,CURRENT_TIMESTAMP+($2*interval '1 second')) ON CONFLICT(key) DO UPDATE SET attempts=wahi_v2.email_rate_limits.attempts+1 RETURNING attempts`,[crypto.createHash('sha256').update(key).digest('hex'),seconds])).rows[0];return r.attempts<=limit;
}
module.exports={allow};
