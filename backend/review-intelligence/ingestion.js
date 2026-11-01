'use strict';
const crypto=require('node:crypto'),{SyntheticGoogleAdapter,normalizePage,hash,fail}=require('./google');
const {GoogleReviewsAdapter}=require('./google-provider');
const uuid=()=>crypto.randomUUID(),dayMs=86400000;
module.exports={
 async assertIngestionAdapter(adapter,c){if(adapter instanceof SyntheticGoogleAdapter){const {location}=await this.eligible(c);if(!location.synthetic)throw fail('review_synthetic_location_required');return;}if(!(adapter instanceof GoogleReviewsAdapter)||adapter.locationId!==this.locationId)throw fail('review_live_collection_disabled');await this.eligible(c);await adapter.assertReady(c);},
 async startScan(actor,adapter){this.access(actor,true);await this.assertIngestionAdapter(adapter);const run=uuid();await this.repository.transaction(async c=>{await c.query("INSERT INTO wahi_v2.review_sync_runs(id,location_id,fixture_hash,status,created_at) VALUES($1,$2,$3,'pending',$4)",[run,this.locationId,adapter.fingerprint,this.now()]);await this.audit(c,actor,'inventory_started',{runId:run});});return run;},
 async ingest(actor,runId,adapter,{maxPages=1000}={}){
  this.access(actor,true);await this.assertIngestionAdapter(adapter);
  return this.repository.locked('inventory:'+this.locationId,async()=>{
   const {location}=await this.eligible();let run=(await this.pool.query('SELECT * FROM wahi_v2.review_sync_runs WHERE id=$1 AND location_id=$2',[runId,this.locationId])).rows[0];if(!run)throw fail('review_run_unavailable');if(run.fixture_hash!==adapter.fingerprint)throw fail('review_fixture_changed');if(run.status==='complete')return {id:runId,status:'complete',distinct:run.distinct_count};
   try{
    await this.pool.query("UPDATE wahi_v2.review_sync_runs SET status='running',error_code=NULL WHERE id=$1",[runId]);
    while(!run.traversal_done){
     if(run.next_page>=maxPages)throw fail('review_page_limit');let raw;
     for(let attempt=0;attempt<3;attempt++){await this.pool.query('UPDATE wahi_v2.review_sync_runs SET attempts=attempts+1 WHERE id=$1',[runId]);try{raw=await adapter.fetchPage(run.next_cursor);break;}catch(e){if(e.code!=='review_transient'||attempt===2)throw e;}}
     const page=normalizePage(raw,location.resource),token=run.next_cursor||'';
     await this.repository.transaction(async c=>{
      await this.assertIngestionAdapter(adapter,c);const {policy}=await this.eligible(c);if(run.expected_count!==null&&page.totalReviewCount!==run.expected_count)throw fail('review_source_count_changed');
      if(page.nextPageToken&&(page.nextPageToken===token||(await c.query('SELECT 1 FROM wahi_v2.review_sync_pages WHERE run_id=$1 AND cursor=$2',[runId,page.nextPageToken])).rowCount))throw fail('review_pagination_loop');
      await c.query('INSERT INTO wahi_v2.review_sync_pages VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[runId,run.next_page,token,page.nextPageToken,JSON.stringify(page.reviews),new Date(Math.min(+this.now()+policy.raw_days*dayMs,policy.valid_until?+new Date(policy.valid_until):Infinity)),page.totalReviewCount,this.now()]);
      await c.query('UPDATE wahi_v2.review_sync_runs SET next_cursor=$2,next_page=next_page+1,traversal_done=$3,expected_count=COALESCE(expected_count,$4),source_average_rating=COALESCE(source_average_rating,$5) WHERE id=$1',[runId,page.nextPageToken,!page.nextPageToken,page.totalReviewCount,page.averageRating]);
     });
     // Simulates process interruption AFTER its durable checkpoint, never before.
     await adapter.afterPage({runId,page:run.next_page});run=(await this.pool.query('SELECT * FROM wahi_v2.review_sync_runs WHERE id=$1',[runId])).rows[0];
    }
    return await this.repository.transaction(async c=>{
     await this.assertIngestionAdapter(adapter,c);const {policy}=await this.eligible(c),config=await this.config(c),pages=(await c.query('SELECT * FROM wahi_v2.review_sync_pages WHERE run_id=$1 ORDER BY ordinal',[runId])).rows,distinct=new Map();
     for(const p of pages){if(!p.payload||new Date(p.expires_at)<=this.now())throw fail('review_staged_page_expired');for(const r of p.payload){if(distinct.has(r.reviewId)&&hash(distinct.get(r.reviewId))!==hash(r))throw fail('review_conflicting_duplicate');distinct.set(r.reviewId,r);}}
     if(distinct.size!==run.expected_count)throw fail('review_count_mismatch');
     for(const r of distinct.values()){
      let record=(await c.query('SELECT r.*,v.source_updated_at FROM wahi_v2.review_records r LEFT JOIN wahi_v2.review_source_versions v ON v.id=r.head_id WHERE r.location_id=$1 AND r.source_id=$2',[this.locationId,r.reviewId])).rows[0];
      if(record?.source_updated_at&&new Date(r.updateTime)<new Date(record.source_updated_at))throw fail('review_stale_source_version');
      if(!record){record={id:uuid(),head_id:null,availability:'present'};await c.query('INSERT INTO wahi_v2.review_records(id,location_id,source_id,first_seen,last_seen) VALUES($1,$2,$3,$4,$4)',[record.id,this.locationId,r.reviewId,this.now()]);}
      const digest=hash(r);let version=(await c.query('SELECT * FROM wahi_v2.review_source_versions WHERE review_id=$1 AND content_hash=$2',[record.id,digest])).rows[0];
      if(!version){version={id:uuid()};await c.query('INSERT INTO wahi_v2.review_source_versions VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL)',[version.id,record.id,digest,hash(r.comment),r,r.rating,r.createTime,r.updateTime,this.now(),new Date(Math.min(+this.now()+policy.raw_days*dayMs,policy.valid_until?+new Date(policy.valid_until):Infinity))]);}
      if(!location.synthetic){const rawExpiry=new Date(Math.min(+this.now()+policy.raw_days*dayMs,policy.valid_until?+new Date(policy.valid_until):Infinity)),derivedExpiry=new Date(Math.min(+rawExpiry,+this.now()+policy.derived_days*dayMs));await c.query('UPDATE wahi_v2.review_source_versions SET payload=$2,rating=$3,source_created_at=$4,source_updated_at=$5,expires_at=$6,purged_at=NULL WHERE id=$1',[version.id,r,r.rating,r.createTime,r.updateTime,rawExpiry]);await c.query('UPDATE wahi_v2.review_results SET expires_at=$3 WHERE review_id=$1 AND text_hash=$2 AND output IS NOT NULL',[record.id,hash(r.comment),derivedExpiry]);}
      if(version.id!==record.head_id||record.availability!=='present')await c.query('INSERT INTO wahi_v2.review_changes(review_id,run_id,previous_id,next_id,kind,recorded_at) VALUES($1,$2,$3,$4,$5,$6)',[record.id,runId,record.head_id,version.id,!record.head_id?'first_seen':record.availability!=='present'?'reappeared':'changed',this.now()]);
      await c.query("UPDATE wahi_v2.review_records SET head_id=$2,availability='present',missing_count=0,last_seen=$3 WHERE id=$1",[record.id,version.id,this.now()]);if(version.id!==record.head_id||record.availability!=='present')await this.enqueue(c,version.id,config);
     }
     // An API inventory omission is not evidence of deletion. Real source history only expires under its approved retention policy.
     const missing=location.synthetic?(await c.query("SELECT * FROM wahi_v2.review_records WHERE location_id=$1 AND NOT(source_id=ANY($2::text[])) AND availability<>'expired'",[this.locationId,[...distinct.keys()]])).rows:[];
     for(const r of missing){const availability=r.missing_count>=1?'missing':'missing_pending';await c.query('UPDATE wahi_v2.review_records SET missing_count=missing_count+1,availability=$2 WHERE id=$1',[r.id,availability]);if(availability!==r.availability)await c.query('INSERT INTO wahi_v2.review_changes(review_id,run_id,previous_id,kind,recorded_at) VALUES($1,$2,$3,$4,$5)',[r.id,runId,r.head_id,availability,this.now()]);}
     await c.query("UPDATE wahi_v2.review_sync_runs SET status='complete',distinct_count=$2,error_code=NULL,completed_at=$3 WHERE id=$1",[runId,distinct.size,this.now()]);await this.audit(c,actor,'inventory_reconciled',{runId,distinct:distinct.size,missing:missing.length});return {id:runId,status:'complete',distinct:distinct.size};
    });
   }catch(e){const code=/^review_[a-z_]+$/.test(e.code||'')?e.code:'review_ingestion_failed';await this.pool.query("UPDATE wahi_v2.review_sync_runs SET status=$2,error_code=$3 WHERE id=$1",[runId,['review_count_mismatch','review_source_count_changed','review_conflicting_duplicate'].includes(code)?'incomplete':'failed',code]);throw Object.assign(fail(code),{cause:e});}
  });
 }
};
