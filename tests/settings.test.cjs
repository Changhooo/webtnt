'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
require('../extension/settings.js');
const {defaults,sanitize}=globalThis.TNTSettings;
test('defaults use the agreed animation timing',()=>{
  assert.deepEqual(sanitize(null),{radius:250,strength:1,craterRatio:.65,fuseMs:800,scatterMs:1000,holdMs:2500,restoreMs:350,sound:false,showHints:true});
});
test('storage values cannot produce unbounded work or invalid timings',()=>{
  const settings=sanitize({radius:100000,strength:-2,craterRatio:0,fuseMs:NaN,scatterMs:Infinity,holdMs:-80,restoreMs:0,sound:'false',unknown:42});
  assert.equal(settings.radius,450);assert.equal(settings.strength,.5);assert.equal(settings.fuseMs,800);
  assert.equal(settings.scatterMs,1000);assert.equal(settings.holdMs,500);assert.equal(settings.restoreMs,200);
  assert.equal(settings.sound,false);assert.equal(settings.unknown,undefined);
  assert.equal(settings.craterRatio,.35);
});
test('valid settings survive serialization and normalization',()=>{
  const input={...defaults,radius:310,strength:1.333,sound:true};
  assert.deepEqual(sanitize(JSON.parse(JSON.stringify(input))),{...input,strength:1.33});
});
test('hint visibility accepts only booleans and keeps existing users enabled by default',()=>{
  assert.equal(sanitize({}).showHints,true);
  assert.equal(sanitize({showHints:false}).showHints,false);
  assert.equal(sanitize({showHints:true}).showHints,true);
  for(const value of ['false','true',0,1,null,[],{}])assert.equal(sanitize({showHints:value}).showHints,true);
  assert.equal(sanitize(JSON.parse(JSON.stringify({...defaults,showHints:false}))).showHints,false);
});
