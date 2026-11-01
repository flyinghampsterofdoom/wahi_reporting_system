'use strict';
function startReviewWorker(reviews,{http,allowSync=false,allowAnalysis=false,adapter,provider,intervalMs=1000}={}){
 let running,stopped=false,lastSchedule=0;
 const tick=()=>{if(stopped||running)return running;running=(async()=>{if(!allowSync&&!allowAnalysis)return;if(Date.now()-lastSchedule>=60000){lastSchedule=Date.now();await reviews.purge({id:'review-retention-worker',role:'ADMIN'});await reviews.automationTick(http,{allowSync,allowAnalysis,adapter});}await reviews.processWork({http,allowSync,allowAnalysis,adapter,provider});})().catch(()=>{}).finally(()=>{running=null;});return running;};
 const timer=setInterval(tick,intervalMs);timer.unref();return {tick,async stop(){stopped=true;clearInterval(timer);await running;}};
}
module.exports={startReviewWorker};
