import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CoworkLobby } from '../src/server/coworking.js';
import { canModerateCoworking, coworkZoneAt, coworkVolumeFor, zoneVolume } from '../src/shared/coworking.js';

test('cowork seats have one owner and release on stand, travel or disconnect', () => {
  const lobby = new CoworkLobby();
  assert.equal(lobby.claim('a', 'A', 'desk-seat-1:0'), true);
  assert.equal(lobby.claim('b', 'B', 'desk-seat-1:0'), false);
  assert.equal(lobby.claim('a', 'A', 'desk-seat-2:0'), true);
  assert.deepEqual([...lobby.claims], [['desk-seat-2:0', 'a']]);
  lobby.release('a');
  assert.equal(lobby.claims.size, 0);
  lobby.claim('b', 'B', 'desk-seat-1:0');
  lobby.remove('b');
  assert.deepEqual([...lobby.participants.keys()], ['a']);
  assert.equal(lobby.participants.has('b'), false);
  assert.equal(lobby.claims.size, 0);
});

test('cowork profiles stay attached to the sender and snapshots ignore departed clients', () => {
  const lobby = new CoworkLobby();
  lobby.profile('a', { name: 'A', intention: 'Review' });
  lobby.profile('b', { name: 'B', intention: 'Ship' });
  lobby.claim('a', 'A', 'desk-seat-1:0');
  const snapshot = lobby.snapshot('@lobby', new Set(['b']));
  assert.deepEqual(snapshot.participants.map((p) => p.peerId), ['b']);
  assert.equal(snapshot.claims.length, 0);
  assert.equal(lobby.participants.get('a')?.intention, 'Review');
  assert.equal(lobby.participants.get('b')?.intention, 'Ship');
});

test('quiet and talk zones switch at the desk/cafe boundary and host authority is checked', () => {
  assert.equal(coworkZoneAt(1.99), 'quiet');
  assert.equal(coworkZoneAt(2), 'talk');
  assert.equal(zoneVolume('quiet', 'talk', 1), 0);
  assert.equal(zoneVolume('talk', 'quiet', 1), 0);
  assert.equal(zoneVolume('quiet', 'quiet', 0.7), 0.7);
  assert.equal(coworkVolumeFor('quiet', 'quiet', true, true, 1), 0);
  assert.equal(coworkVolumeFor('talk', 'talk', true, false, 0.6), 0.6);
  assert.equal(canModerateCoworking(true, true, 'guest', 'host'), true);
  assert.equal(canModerateCoworking(false, true, 'guest', 'member'), false);
  assert.equal(canModerateCoworking(true, false, 'member', 'host'), false);
  assert.equal(canModerateCoworking(true, true, 'host', 'host'), false);
});
