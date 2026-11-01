'use strict';
const {local,scheduledInstant}=require('../reports/schedule'),{addDays}=require('../labor/model');
const timezone='America/Los_Angeles',time='10:00';
function nextDaily(now){const day=local(now,timezone).date,at=scheduledInstant(day,time,timezone);return new Date(at>+now?at:scheduledInstant(addDays(day,1),time,timezone));}
function dueOccurrence(now){const day=local(now,timezone).date,at=scheduledInstant(day,time,timezone);return at<=+now?day:addDays(day,-1);}
module.exports={timezone,time,nextDaily,dueOccurrence};
