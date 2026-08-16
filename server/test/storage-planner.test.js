import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPool, validatePlan, pickWriteTarget } from '../src/storage/planner.js';

const mixedBay = [
  { id: 'sda', sizeGB: 480 },
  { id: 'sdb', sizeGB: 960 },
  { id: 'sdc', sizeGB: 240 },
  { id: 'sdd', sizeGB: 480 },
];

test('largest drive becomes the parity drive', () => {
  const plan = planPool(mixedBay);
  assert.equal(plan.parity.id, 'sdb');
  assert.equal(plan.viable, true);
  assert.doesNotThrow(() => validatePlan(plan));
});

test('usable capacity = sum of all data drives', () => {
  const plan = planPool(mixedBay);
  assert.equal(plan.usableGB, 480 + 240 + 480);
  assert.equal(plan.rawGB, 2160);
  assert.equal(plan.data.length, 3);
  assert.equal(plan.protected, true);
});

test('parity drive is never also a data branch', () => {
  const plan = planPool(mixedBay);
  assert.ok(!plan.data.some(d => d.id === plan.parity.id));
});

test('single drive is not viable', () => {
  const plan = planPool([{ id: 'a', sizeGB: 480 }]);
  assert.equal(plan.viable, false);
  assert.throws(() => validatePlan(plan));
});

test('two equal drives: one parity, one data, deterministic pick', () => {
  const plan = planPool([{ id: 'b', sizeGB: 480 }, { id: 'a', sizeGB: 480 }]);
  assert.equal(plan.viable, true);
  assert.equal(plan.parity.id, 'a'); // size tie broken by id for stability
  assert.equal(plan.usableGB, 480);
  assert.doesNotThrow(() => validatePlan(plan));
});

test('validate rejects a parity drive smaller than a data drive', () => {
  const bad = {
    viable: true,
    parity: { id: 'small', sizeGB: 240 },
    data: [{ id: 'big', sizeGB: 960 }],
  };
  assert.throws(() => validatePlan(bad), /at least as large/);
});

test('MFS policy picks the branch with the most free space', () => {
  const target = pickWriteTarget([
    { id: 'd1', freeGB: 100 },
    { id: 'd2', freeGB: 350 },
    { id: 'd3', freeGB: 20 },
  ]);
  assert.equal(target.id, 'd2');
});

test('MFS tie goes to the first branch (stable)', () => {
  const target = pickWriteTarget([
    { id: 'd1', freeGB: 200 },
    { id: 'd2', freeGB: 200 },
  ]);
  assert.equal(target.id, 'd1');
});

test('MFS with no branches throws', () => {
  assert.throws(() => pickWriteTarget([]));
});
