'use strict';
const crypto=require('node:crypto'),{z}=require('zod');
const fail=code=>Object.assign(new Error(code),{code});
const hash=value=>crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const instant=z.string().max(50).refine(s=>/^\d{4}-\d\d-\d\dT/.test(s)&&Number.isFinite(Date.parse(s)));
const raw=z.object({reviewId:z.string().min(1).max(512),name:z.string().max(1500).optional(),starRating:z.enum(['ONE','TWO','THREE','FOUR','FIVE']),comment:z.string().max(30000).optional().default(''),createTime:instant,updateTime:instant,reviewReply:z.object({comment:z.string().max(8192),updateTime:instant}).optional()});
const page=z.object({reviews:z.array(z.unknown()).max(50).optional().default([]),totalReviewCount:z.number().int().nonnegative(),averageRating:z.number().min(0).max(5).optional(),nextPageToken:z.string().min(1).max(4096).optional()});
function normalize(value,resource){
 let x;try{x=raw.parse(value);}catch{throw fail('review_invalid_record');}
 if(x.name&&x.name!==resource+'/reviews/'+x.reviewId)throw fail('review_identity_mismatch');
 if(Date.parse(x.updateTime)<Date.parse(x.createTime))throw fail('review_invalid_timestamp');
 // Allowlist projection intentionally drops reviewer identity, media and links.
 return {reviewId:x.reviewId,starRating:x.starRating,rating:['ONE','TWO','THREE','FOUR','FIVE'].indexOf(x.starRating)+1,comment:x.comment,createTime:x.createTime,updateTime:x.updateTime,reviewReply:x.reviewReply||null};
}
function normalizePage(value,resource){let x;try{x=page.parse(value);}catch{throw fail('review_invalid_page');}return {reviews:x.reviews.map(r=>normalize(r,resource)),totalReviewCount:x.totalReviewCount,averageRating:x.averageRating??null,nextPageToken:x.nextPageToken||null};}
class SyntheticGoogleAdapter {
 constructor(pages,{failures={},afterPage=async()=>{}}={}){this.pages=structuredClone(pages);this.fingerprint=hash(pages);this.failures={...failures};this.afterPage=afterPage;this.calls=0;}
 async fetchPage(cursor){this.calls++;const key=cursor||'';if(this.failures[key]>0){this.failures[key]--;throw fail('review_transient');}if(!Object.hasOwn(this.pages,key))throw fail('review_invalid_cursor');return structuredClone(this.pages[key]);}
}
function liveCollection(){throw fail('review_live_collection_disabled');}
module.exports={normalize,normalizePage,SyntheticGoogleAdapter,liveCollection,hash,fail};
