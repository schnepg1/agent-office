import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Guests } from '../src/server/guests.js';
import { LOBBY } from '../src/shared/coworking-space.js';

function withGuests(run: (guests: Guests, dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-guests-'));
  try { run(new Guests(dir), dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('guest invitations are scoped, tokens are stored only as hashes, and revocation ends sessions', () => {
  withGuests((guests, dir) => {
    const made = guests.create('host', { name: 'Visitors', floorIds: ['floor-one'], uses: 1 });
    assert.equal(typeof made, 'object');
    if (typeof made === 'string') return;
    assert.equal(made.invitation.usesLeft, 1);
    const persisted = readFileSync(path.join(dir, 'guest-invitations.json'), 'utf8');
    assert.equal(persisted.includes(made.token), false);

    const joined = guests.enter(made.token, ' Ada ');
    assert.equal(typeof joined, 'object');
    if (typeof joined === 'string') return;
    assert.deepEqual(joined.info, { name: 'Ada', lobby: true, floorIds: ['floor-one'] });
    assert.deepEqual([LOBBY, ...joined.info.floorIds], ['@lobby', 'floor-one']);
    assert.equal(guests.enter(made.token, 'Grace'), 'That guest invitation is invalid or expired');
    assert.deepEqual(guests.revoke(made.invitation.id), [joined.id]);
    assert.equal(guests.session(joined.id), undefined);
  });
});

test('reusable guest invitation labels do not override visitor names and moderation survives reconnects', () => {
  withGuests((guests) => {
    const made = guests.create('host', { name: 'Open coworking', floorIds: [], uses: null });
    assert.equal(typeof made, 'object');
    if (typeof made === 'string') return;
    const first = guests.enter(made.token, 'Mina');
    const second = guests.enter(made.token, 'Kai');
    assert.equal(typeof first, 'object');
    assert.equal(typeof second, 'object');
    if (typeof first === 'string' || typeof second === 'string') return;
    assert.equal(first.info.name, 'Mina');
    assert.equal(second.info.name, 'Kai');
    assert.equal(guests.setMuted(first.id, true), true);
    assert.equal(guests.session(first.id)?.muted, true);
    assert.equal(guests.revokeSession(first.id), true);
    assert.equal(guests.session(first.id), undefined);
    const rejoined = guests.enter(made.token, 'Mina');
    assert.equal(typeof rejoined, 'object');
    if (typeof rejoined !== 'string') assert.equal(rejoined.muted, true);
  });
});
