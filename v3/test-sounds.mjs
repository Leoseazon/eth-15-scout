import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./sounds.js',import.meta.url),'utf8');
function setup(){
 const freqs=[];
 class TestContext{
  constructor(){this.state='running';this.currentTime=0;this.destination={}}
  resume(){this.state='running';return Promise.resolve()}
  createOscillator(){return {type:'',frequency:{setValueAtTime(f){freqs.push(f)}},
   connect(){},start(){},stop(){}}}
  createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},
   connect(){}}}
 }
 const sandbox={window:{AudioContext:TestContext},document:{hidden:false}};
 vm.runInNewContext(source,sandbox);
 return {sound:sandbox.window.ScoutSounds,freqs,sandbox};
}
const event=(type,ms,id)=>({id,time:ms,type,ticker:'KXETH15M-TEST',msg:type});
test('no sound on initial history or repeated polls',async()=>{
 const {sound,freqs}=setup(),now=Date.now();
 const prior=event('PAPER BUY',now-20000,'buy-1');
 sound.observe([prior],now);
 assert.equal(freqs.length,0);
 assert.equal(await sound.setEnabled(true),true);
 sound.observe([prior],now+1000);
 assert.equal(freqs.length,0);
 sound.observe([event('PAPER BUY',now+2000,'buy-2')],now+2100);
 assert.equal(freqs.length,3);
 sound.observe([event('PAPER BUY',now+2000,'buy-2')],now+2200);
 assert.equal(freqs.length,3);
});
test('original ascending buy and descending sell cues are distinct',async()=>{
 const {sound,freqs}=setup(),now=Date.now();
 sound.observe([],now);await sound.setEnabled(true);
 sound.observe([event('PAPER BUY',now+100,'buy')],now+150);
 sound.observe([event('PAPER SELL',now+200,'sell')],now+260);
 assert.equal(freqs.length,6);
 assert.ok(freqs[0]<freqs[1]&&freqs[1]<freqs[2]);
 assert.ok(freqs[3]>freqs[4]&&freqs[4]>freqs[5]);
});
test('mute, hidden tabs and stale journal records never trigger alarms',async()=>{
 const {sound,freqs,sandbox}=setup(),now=Date.now();
 sound.observe([],now);await sound.setEnabled(true);
 await sound.setEnabled(false);
 sound.observe([event('PAPER BUY',now+100,'muted')],now+150);
 assert.equal(freqs.length,0);
 await sound.setEnabled(true);
 sandbox.document.hidden=true;
 sound.observe([event('PAPER SELL',now+200,'hidden')],now+250);
 assert.equal(freqs.length,0);
 sandbox.document.hidden=false;
 sound.observe([event('PAPER SELL',now-300000,'stale')],now);
 assert.equal(freqs.length,0);
});
test('preview works only after a click unlocks the browser audio context',async()=>{
 const {sound,freqs}=setup();
 assert.equal(sound.supported,true);
 assert.equal(await sound.preview('PAPER SELL'),true);
 assert.equal(freqs.length,3);
 assert.equal(sound.enabled,false,'Preview should not silently enable ongoing alerts');
});
