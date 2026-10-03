import test from 'node:test';
import assert from 'node:assert/strict';
import { guestFloors, guestMap } from '../src/server/guests/visibility.js';
test('public floor summaries select fields rather than inheriting private additions', () => {
  const client = { guestFloorIds: ['allowed'] } as any;
  const floors = guestFloors(client, [{ id: 'allowed', name: 'Shared room', palette: 2, dir: 'PRIVATE_PATH', branch: 'PRIVATE_BRANCH', futureCredential: 'PRIVATE_SECRET' }, { id: 'hidden', name: 'PRIVATE_FLOOR' }] as any);
  assert.equal(floors.length, 1); assert.equal(floors[0].name, 'Shared room');
  assert.doesNotMatch(JSON.stringify(floors), /PRIVATE/);
});
test('lobby-only visitors receive no project map metadata', () => {
  assert.deepEqual(guestMap({ pick: 'castle', custom: [], by: 'Private host', at: 12 }, false), { pick: 'office', custom: [] });
  assert.deepEqual(guestMap({ pick: 'castle', custom: [], by: 'Private host', at: 12 }, true), { pick: 'castle', custom: [] });
});
