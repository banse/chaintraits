import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedMembership} from '../src/shared-safety.mjs';
import {pageReads} from '../src/page-reads.mjs';
const wallet='0x2000000000000000000000000000000000000001';
const fact=['0x'+'1'.repeat(64),'0x'+'2'.repeat(64),1];
test('a stored result with missing list evidence is unknown, never exclusion',()=>{
 assert.equal(sharedMembership({fact,list:[],result:null},wallet),'unavailable');
 assert.equal(sharedMembership({fact,list:[],result:{attestation:{}}},wallet),'unavailable');
});
test('only a complete recovered list can include or exclude a wallet',()=>{
 const value={fact,list:[wallet],result:{attestation:{}}};
 assert.equal(sharedMembership(value,wallet.toUpperCase()),'included');
 assert.equal(sharedMembership(value,'0x2000000000000000000000000000000000000002'),'excluded');
 assert.equal(sharedMembership(null,wallet),'not-stored');
});
test('explicit retry invalidates a missing completion without clearing unrelated evidence',async()=>{
 const cache=pageReads();let available=false,calls=0;
 const load=async()=>{calls++;return available?{answer:'found'}:null;};
 await cache.once('other',async()=>42);assert.equal(await cache.once('completion',load),null);
 available=true;cache.invalidate('completion');assert.deepEqual(await cache.once('completion',load),{answer:'found'});
 assert.equal(calls,2);assert.equal(await cache.once('other',async()=>0),42);cache.stop();
});
