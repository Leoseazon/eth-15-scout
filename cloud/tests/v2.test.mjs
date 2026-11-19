import test from 'node:test';
import assert from 'node:assert/strict';
import {freshPaperState,makeV2Engine} from '../src/v2.js';

test('new cloud paper bot starts disarmed',()=>{
  const s=freshPaperState(); assert.equal(s.armed,false);
  assert.equal(s.cash,100); assert.equal(s.risk,2);
  assert.equal(s.trades.length,0); assert.equal(s.open,null);
});
test('no trade without fresh market data',()=>{
  const s=freshPaperState(); s.armed=true;
  const response=makeV2Engine(s).step(null,null,null,false);
  assert.match(response.notice,/fresh/);
  assert.equal(s.open,null); assert.equal(s.trades.length,0);
});
