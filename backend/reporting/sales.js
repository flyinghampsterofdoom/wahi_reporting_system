'use strict';
const {Exact:E}=require('../domain/exact'),{expandDecimal}=require('../labor/toast-client'),{date,fail}=require('../labor/model');
const numeric=new Set(['quantity','price','preDiscountPrice','receiptLinePrice','tax','refundAmount','taxRefundAmount','discountAmount','nonTaxDiscountAmount']);
const guid=s=>typeof s==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(s);
function parseSales(text){return JSON.parse(text,(key,value,context)=>numeric.has(key)&&typeof value==='number'?expandDecimal(context.source):value);}
function decimal(v){try{const n=E.of(v);if(!n.nonnegative())throw Error();return v;}catch{throw fail('sales_payload_unsupported');}}
function instant(v){if(!v||!Number.isFinite(Date.parse(v)))throw fail('sales_payload_unsupported');return new Date(v).toISOString();}
// Strict allowlist: guest, payment, staff, free-text request, seat and device
// information never enters the reporting store.
function modifiers(rows,depth=0){if(depth>12||!Array.isArray(rows))throw fail('sales_payload_unsupported');return rows.map(s=>({id:guid(s.guid)?s.guid:null,itemId:guid(s.item?.guid)?s.item.guid:null,groupId:guid(s.optionGroup?.guid)?s.optionGroup.guid:null,quantity:decimal(s.quantity),price:decimal(s.price),voided:!!s.voided,type:s.selectionType||'NONE',preModifierId:guid(s.preModifier?.guid)?s.preModifier.guid:null,refundAmount:s.refundDetails?decimal(s.refundDetails.refundAmount):null,modifiers:modifiers(s.modifiers||[],depth+1)})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));}
function normalize(orders,requestedDay){
 if(!Array.isArray(orders))throw fail('sales_payload_unsupported');const facts=[];
 for(const o of orders){if(!guid(o.guid)||!Array.isArray(o.checks))throw fail('sales_payload_unsupported');const b=String(o.businessDate),day=date(b.slice(0,4)+'-'+b.slice(4,6)+'-'+b.slice(6));if(day!==requestedDay)throw fail('sales_business_date_mismatch');
  for(const c of o.checks){if(!guid(c.guid)||!Array.isArray(c.selections))throw fail('sales_payload_unsupported');const paymentRefund=(c.payments||[]).some(p=>['FULL','PARTIAL'].includes(p.refundStatus));
   for(const s of c.selections){if(!guid(s.guid))throw fail('sales_payload_unsupported');const quantity=decimal(s.quantity),price=decimal(s.price),refund=s.refundDetails?decimal(s.refundDetails.refundAmount):null;
    const reason=o.createdInTestMode?'test':o.deleted||c.deleted||s.deleted?'deleted':o.voided||c.voided||s.voided?'void':!o.closedDate||!c.closedDate||c.paymentStatus!=='CLOSED'?'open':refund!==null||paymentRefund?'refund_review':!E.of(quantity).positive()?'zero_quantity':null;
    const itemId=guid(s.item?.guid)?s.item.guid:'selection:'+s.guid,type=s.selectionType||'NONE';
    facts.push({id:s.guid,orderId:o.guid,checkId:c.guid,itemId,groupId:guid(s.itemGroup?.guid)?s.itemGroup.guid:null,name:guid(s.item?.guid)&&type==='NONE'?String(s.displayName||'Unnamed Toast item').slice(0,200):type+' (free text omitted)',quantity,businessDate:day,saleAt:instant(o.promisedDate||s.createdDate||c.openedDate||o.openedDate),modifiedAt:instant(o.modifiedDate),price,tax:decimal(s.tax),taxInclusion:s.taxInclusion,netSales:s.taxInclusion==='NOT_INCLUDED'?price:null,refundAmount:refund,paymentRefund,reason,selectionType:type,unit:s.unitOfMeasure||'NONE',splitOrigin:guid(s.splitOrigin?.guid)?s.splitOrigin.guid:null,diningOption:guid(s.diningOption?.guid||o.diningOption?.guid)?s.diningOption?.guid||o.diningOption.guid:null,discountAmounts:(s.appliedDiscounts||[]).map(d=>decimal(d.discountAmount)).sort(),modifiers:modifiers(s.modifiers||[])});
   }
  }
 }
 if(new Set(facts.map(f=>f.id)).size!==facts.length)throw fail('sales_duplicate_selection');return facts;
}
async function fetchDay(client,day,{onCall=()=>{}}={}){date(day);const orders=[];for(let page=1;page<=100;page++){onCall();const response=await client.request('/orders/v2/ordersBulk?businessDate='+day.replaceAll('-','')+'&pageSize=100&page='+page,{paginated:true,parse:parseSales});if(!Array.isArray(response.data))throw fail('sales_payload_unsupported');orders.push(...response.data);if(!response.hasNext)return {facts:normalize(orders,day),orders:orders.length,pages:page};}throw fail('sales_page_limit');}
module.exports={parseSales,normalize,fetchDay};
