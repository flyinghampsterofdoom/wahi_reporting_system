'use strict';
const {ReviewRepository}=require('./repository'),{ReviewIntelligence}=require('./service'),{ReviewIntegrations}=require('./integrations'),{ProviderHTTP}=require('./http');
const productionLocationId='b609ff94-e240-4b5c-a6de-ec96390f37d6';
async function openHostedReviews(pool,config){
 const repository=ReviewRepository.hosted(pool,config),reviews=new ReviewIntelligence(repository,{locationId:productionLocationId});
 if(!(await pool.query('SELECT 1 FROM wahi_v2.review_locations WHERE id=$1',[productionLocationId])).rowCount){await reviews.initialize({id:'google-production-foundation',role:'ADMIN'},{name:'Google Business Profile — awaiting owner selection'});await repository.transaction(async c=>{await c.query("UPDATE wahi_v2.review_locations SET synthetic=FALSE,resource='accounts/pending/locations/unmapped' WHERE id=$1",[productionLocationId]);});}
 reviews.providers=new ReviewIntegrations(reviews,{environment:config.environment,key:config.key,callbackOrigin:config.origin,connectionOnly:true});
 return {reviews,reviewAdminHTTP:new ProviderHTTP({allowNetwork:true,scope:'openai-diagnostics'}),reviewHTTP:new ProviderHTTP({allowNetwork:true,scope:'google-connection'})};
}
module.exports={openHostedReviews,productionLocationId};
