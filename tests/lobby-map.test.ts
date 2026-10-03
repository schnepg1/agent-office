import test from 'node:test';
import assert from 'node:assert/strict';
import { LOBBY_PLAN, planForSpace } from '../src/shared/lobby-map.js';
import { OFFICE_PLAN, planOf, seatHereOn } from '../src/shared/maps/index.js';
test('lobby layout is independent of the project map and has only human seats', () => {
  const castle = planOf('castle');
  assert.equal(planForSpace('@lobby', castle), LOBBY_PLAN);
  assert.equal(planForSpace('project', castle), castle);
  assert.equal(planForSpace('project', OFFICE_PLAN), OFFICE_PLAN);
  assert.equal(LOBBY_PLAN.desks.length, 0); assert.equal(LOBBY_PLAN.stations.length, 0);
  assert.equal(Object.keys(LOBBY_PLAN.boards).length, 0);
  for (const seat of LOBBY_PLAN.seating) assert.ok(seatHereOn(LOBBY_PLAN, seat.id + ':0', false));
});
