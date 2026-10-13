import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {getProductionRetentionStart,retainProductionRecords} from '../server/retention.mjs';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const context=vm.createContext({console,TextEncoder,TextDecoder,setTimeout,clearTimeout,document:{addEventListener(){},getElementById(){return null;}},window:{addEventListener(){}},sessionStorage:{getItem(){return null;}},navigator:{}});
vm.runInContext(source,context);
const cases=[
  ['2026-11-09T22:59:59Z','2026-10-01'],
  ['2026-11-09T23:00:00Z','2026-11-01'],
  ['2026-11-10T12:00:00Z','2026-11-01'],
  ['2027-01-09T22:59:59Z','2026-12-01'],
  ['2027-01-09T23:00:00Z','2027-01-01'],
  ['2026-04-09T21:59:59Z','2026-03-01'],
  ['2026-04-09T22:00:00Z','2026-04-01'],
  ['2028-03-09T12:00:00Z','2028-02-01'],
  ['2028-03-10T12:00:00Z','2028-03-01']
];
for(const [timestamp,expected] of cases) {
  const now=new Date(timestamp);
  assert.equal(getProductionRetentionStart(now),expected);
  context.timestamp=timestamp;
  assert.equal(vm.runInContext('getProductionRetentionStart(new Date(timestamp))',context),expected);
}
const records={'2026-09-30':{total:1},'2026-10-01':{total:2},'2026-10-31':{total:3},'2026-11-01':{total:4},'2026-11-10':{total:5}};
const before=retainProductionRecords(records,new Date('2026-11-09T12:00:00Z'));
assert.deepEqual(Object.keys(before),['2026-10-01','2026-10-31','2026-11-01','2026-11-10']);
const after=retainProductionRecords(records,new Date('2026-11-10T12:00:00Z'));
assert.deepEqual(Object.keys(after),['2026-11-01','2026-11-10']);
assert.deepEqual(retainProductionRecords(after,new Date('2026-11-10T12:00:00Z')),after);
assert.equal(Object.keys(records).length,5);
context.records=records;
assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(retainProductionRecords(records,new Date("2026-11-10T12:00:00Z")))',context)),after);
assert.deepEqual(retainProductionRecords(records,new Date('2027-01-10T12:00:00Z')),{});
console.log('PASS production retention: day 9/10, Stockholm midnight, summer/winter time, year rollover, leap year, missed months, and client/server parity');
