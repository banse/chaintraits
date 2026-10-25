import test from 'node:test';
import assert from 'node:assert/strict';
import {communityDisplay} from '../src/card-facts.mjs';
const families=[6,1,2,3,4,5,7,8,9,10,11,12,13];
test('community ring placement follows acceptance order, not fact kind or numeric sorting',()=>{
 const result=communityDisplay([10005,10001,10005],families);
 assert.equal(result.count,2);
 assert.deepEqual(result.positions,[{id:10005,family:6,ring:1},{id:10001,family:1,ring:1}]);
});
test('metadata truncation does not hide credentials and later facts advance the frame',()=>{
 const result=communityDisplay(Array.from({length:41},(_,i)=>10001+i),families);
 assert.equal(result.count,41);assert.equal(result.metadataCount,32);assert.equal(result.ringCount,39);
 assert.deepEqual(result.positions[13],{id:10014,family:6,ring:2});
 assert.deepEqual(result.positions[38],{id:10039,family:13,ring:3});
 assert.deepEqual(result.positions[39],{id:10040,family:null,ring:null});
 assert.equal(result.frameCount,2);assert.equal(result.positions.length,41);
});
test('registration alone contributes no ring; builtin IDs are not community credentials',()=>{
 assert.equal(communityDisplay([],families).count,0);
 assert.equal(communityDisplay([101,601,10001],families).count,1);
});
