'use strict';
// No network capability is inferred from stored flags. Trusted composition opts in separately.
function startReviewWorker(reviews,{http,allowSync=false,allowAnalysis=false,adapter,provider,intervalMs=60000}={}){
 let running,stopped=false;const tick=()=>{if(stopped||running)return running;running=(async()=>{if(allowSync||allowAnalysis){await reviews.processWork({http,allowSync,allowAnalysis,adapter,provider});if(!adapter)await reviews.automationTick(http,{allowSync,allowAnalysis});}})().catch(()=>{}).finally(()=>{running=null;});return running;};
 const timer=setInterval(tick,intervalMs);timer.unref();return {tick,async stop(){stopped=true;clearInterval(timer);await running;}};
}
module.exports={startReviewWorker};
