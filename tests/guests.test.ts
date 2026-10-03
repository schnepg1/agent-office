import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('reusable invitation labels do not override visitor names and mute applies only to one session', () => {
  withGuests((guests, dir) => {
    const made = guests.create('host', { name: 'Open coworking', floorIds: [], uses: null });
    assert.equal(typeof made, 'object');
    if (typeof made === 'string') return;
    const first = guests.enter(made.token, 'Mina');
    const sameName = guests.enter(made.token, 'Mina');
    assert.equal(typeof first, 'object');
    assert.equal(typeof sameName, 'object');
    if (typeof first === 'string' || typeof sameName === 'string') return;
    assert.equal(first.info.name, 'Mina');
    assert.equal(guests.setMuted(first.id, true), true);
    assert.equal(guests.session(first.id)?.muted, true);
    assert.equal(guests.session(sameName.id)?.muted, undefined);
    assert.equal(guests.revokeSession(first.id), true);
    assert.equal(guests.session(first.id), undefined);
    const rejoined = guests.enter(made.token, 'Mina');
    assert.equal(typeof rejoined, 'object');
    if (typeof rejoined !== 'string') {
      assert.notEqual(rejoined.id, first.id);
      assert.equal(rejoined.muted, undefined);
    }

    writeFileSync(path.join(dir, 'guest-invitations.json'), '{broken json');
    assert.equal(guests.session(sameName.id), undefined);
    assert.deepEqual(guests.list(), []);
    assert.equal(guests.enter(made.token, 'Mina'), 'That guest invitation is invalid or expired');
    assert.throws(() => guests.create('host', { floorIds: [] }), /invitations are unavailable/);
  });
});

test('invitation creation throws when its data directory disappears instead of returning a token', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-guests-write-'));
  try {
    const guests = new Guests(dir);
    rmSync(dir, { recursive: true, force: true });
    assert.throws(() => guests.create('host', { floorIds: [] }), /ENOENT/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
