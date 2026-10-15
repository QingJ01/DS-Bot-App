import test from 'node:test';
import assert from 'node:assert/strict';
import { readingPosition, restoredOffset, hasNewTail } from '../src/logic/reading-position.ts';

test('expanding the screen restores the same message despite reflow above it', () => {
  const before = new Map([['a',{y:100,height:300}],['b',{y:400,height:600}],['c',{y:1000,height:200}]]);
  const position = readingPosition(450, 1800, 600, before);
  assert.equal(position.bottom, false);
  const after = new Map([['a',{y:100,height:150}],['b',{y:250,height:300}],['c',{y:550,height:100}]]);
  assert.equal(restoredOffset(position,after),300);
});

test('loading earlier messages restores the existing reading anchor', () => {
  const position = readingPosition(450,1800,600,new Map([['b',{y:400,height:600}]]));
  assert.equal(restoredOffset(position,new Map([['old',{y:100,height:300}],['b',{y:700,height:600}]])),750);
  assert.equal(restoredOffset(position,new Map()),450);
});

test('only appended messages show the new-message indicator', () => {
  assert.equal(hasNewTail('b',['old','a','b']),false);
  assert.equal(hasNewTail('b',['a','b']),false);
  assert.equal(hasNewTail(undefined,['a','b']),false);
  assert.equal(hasNewTail('b',['a','b','c']),true);
  assert.equal(readingPosition(1150,1800,600,new Map()).bottom,true);
});

test('inverted chat follows only the latest edge and restores a reader after a new reply', () => {
  const rows = new Map([['latest',{y:90,height:300}],['reading',{y:390,height:400}]]);
  assert.equal(readingPosition(0,2000,600,rows,true).bottom,true);
  const position = readingPosition(450,2000,600,rows,true);
  assert.equal(position.bottom,false);
  assert.equal(restoredOffset(position,new Map([['reading',{y:510,height:400}]])),570);
});
