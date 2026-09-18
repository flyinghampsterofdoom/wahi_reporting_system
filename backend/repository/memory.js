'use strict';
const {emptyState}=require('../domain/state');
class MemoryRepository {
  constructor(state=emptyState()) {this.state=structuredClone(state);this.queue=Promise.resolve();}
  async read() {return structuredClone(this.state);}
  async transaction(fn) {
    const run=this.queue.then(async()=>{const draft=structuredClone(this.state);const result=await fn(draft);this.state=draft;return result;});
    this.queue=run.catch(()=>{});return run;
  }
}
module.exports={MemoryRepository};
