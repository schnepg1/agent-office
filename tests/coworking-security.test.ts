// Exercise the public guest boundary with real HTTP and WebSocket clients.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import WebSocket from 'ws';
import { loadConfig } from '../src/server/config.js';
import { startServer } from '../src/server/server.js';
import { OFFICE_PLAN, seatHereOn } from '../src/shared/maps/index.js';
import { LOBBY_PLAN } from '../src/shared/lobby-map.js';

type Frame = { t: string; [key: string]: any };
async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
}
class Visitor {
  frames: Frame[] = [];
  constructor(readonly ws: WebSocket) {
    ws.on('message', (raw) => this.frames.push(JSON.parse(String(raw))));
  }
  send(frame: Frame) { this.ws.send(JSON.stringify(frame)); }
  async take(type: string, matches = (_frame: Frame) => true): Promise<Frame> {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      const i = this.frames.findIndex((frame) => frame.t === type && matches(frame));
      if (i >= 0) return this.frames.splice(i, 1)[0];
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Missing ${type}; received ${this.frames.map((f) => f.t).join(', ')}`);
  }
  async barrier() {
    const at = Math.random();
    this.send({ t: 'ping', at });
    await this.take('pong', (frame) => frame.at === at);
  }
}

test('coworking seats and moderation enforce authenticated session ownership', { timeout: 60000 }, async (t) => {
  const temp = mkdtempSync(path.join(tmpdir(), 'office-guest-boundary-'));
  const home = path.join(temp, 'home');
  const project = path.join(temp, 'PRIVATE_PROJECT_NEVER_PUBLIC');
  const pub = path.join(temp, 'public');
  for (const dir of [home, project, pub]) mkdirSync(dir, { recursive: true });
  for (const page of ['index', 'guest', 'login', 'lite', 'join', 'claim']) {
    writeFileSync(path.join(pub, `${page}.html`), `<!doctype html><title>${page}</title>`);
  }
  writeFileSync(path.join(project, 'private-notes.md'), 'PRIVATE_FILE_NEVER_PUBLIC');
  const port = await freePort();
  const cfg = loadConfig([project, '--home', home, '--port', String(port), '--password', 'guest-boundary-test', '--no-open', '--weather', 'clear']);
  const office = await startServer(cfg, { publicDir: pub });
  const base = `http://127.0.0.1:${port}`;
  const visitors: Visitor[] = [];
  t.after(async () => {
    for (const v of visitors) v.ws.terminate();
    office.shutdown();
    await new Promise((resolve) => setTimeout(resolve, 100));
    rmSync(temp, { recursive: true, force: true });
  });
  const request = (route: string, cookie = '', method = 'GET', body?: unknown, origin = base) =>
    fetch(base + route, { method, headers: { cookie, origin, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual' });
  const cookieOf = (response: Response) => {
    const value = response.headers.get('set-cookie');
    assert.ok(value, 'successful entry establishes a session');
    return value.split(';')[0];
  };
  const connect = async (cookie: string, query = '') => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws${query}`, { headers: { cookie, origin: base } });
    const visitor = new Visitor(ws);
    visitors.push(visitor);
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    return visitor;
  };
  const login = await request('/api/login', '', 'POST', { password: 'guest-boundary-test' });
  assert.equal(login.status, 200);
  const hostCookie = cookieOf(login);
  const host = await connect(hostCookie);
  const hostWelcome = await host.take('welcome');
  const privateFloor = hostWelcome.floors.find((floor: any) => floor.id !== '@lobby').id;
  const invite = async (floorIds: string[] = [], uses: number | null = null) => {
    const response = await request('/api/guest/invitations', hostCookie, 'POST', { name: 'Public coworking', floorIds, uses, expiresAt: Date.now() + 3600000 });
    assert.equal(response.status, 201);
    return response.json() as Promise<{ token: string; invitation: { id: string } }>;
  };
  const enter = async (token: string, name: string) => {
    const response = await request('/api/guest/enter', '', 'POST', { token, name });
    assert.equal(response.status, 200);
    return cookieOf(response);
  };
  const invitation = await invite();
  const guestCookie = await enter(invitation.token, 'A new visitor');
  const guest = await connect(guestCookie, `?floor=${encodeURIComponent(privateFloor)}`);
  const welcome = await guest.take('welcome');

  await t.test('desk claims and work profiles belong to the authenticated peer', async () => {
    const secondCookie = await enter(invitation.token, 'A new visitor');
    const second = await connect(secondCookie);
    const secondWelcome = await second.take('welcome');
    const seat = 'desk-seat-1:0';
    const place = seatHereOn(LOBBY_PLAN, seat, false)!;
    for (const visitor of [guest, second]) {
      visitor.send({ t: 'cowork.sync' });
      await visitor.take('cowork.state');
      visitor.send({ t: 'move', ...place, moving: false });
      await visitor.barrier();
      visitor.frames = [];
    }
    guest.send({ t: 'cowork.claim', seat });
    await guest.take('cowork.state', (f) => f.state.claims.some((c: any) => c.peerId === welcome.you && c.seat === seat));
    second.send({ t: 'cowork.claim', seat });
    await second.take('cowork.refused');
    second.send({ t: 'cowork.profile', peerId: welcome.you, intention: 'My own work', status: 'Focusing', zone: 'talk' });
    await second.take('cowork.saved');
    const profile = await second.take('cowork.update', (f) => f.participant.intention === 'My own work');
    assert.equal(profile.participant.peerId, secondWelcome.you);
    guest.send({ t: 'cowork.moderate', peerId: secondWelcome.you, action: 'kick' });
    await guest.take('toast');
    await second.barrier();
    assert.equal(second.ws.readyState, WebSocket.OPEN);
    guest.send({ t: 'cowork.release' });
    await guest.take('cowork.state', (f) => !f.state.claims.some((c: any) => c.seat === seat));
    await new Promise((resolve) => setTimeout(resolve, 310));
    second.send({ t: 'cowork.claim', seat });
    await second.take('cowork.state', (f) => f.state.claims.some((c: any) => c.peerId === secondWelcome.you));
    second.ws.close();
    await guest.take('cowork.state', (f) => !f.state.claims.some((c: any) => c.seat === seat));
  });
  await t.test('lobby seating survives project map changes and all clients use its own plan', async () => {
    const seat = 'desk-seat-2:0';
    const place = seatHereOn(LOBBY_PLAN, seat, false)!;
    guest.send({ t: 'move', ...place, moving: false });
    guest.send({ t: 'cowork.claim', seat });
    await guest.take('cowork.state', f => f.state.claims.some((c: any) => c.seat === seat));
    host.send({ t: 'map.set', map: 'castle' });
    await host.take('map', f => f.state.pick === 'castle');
    guest.send({ t: 'cowork.sync' });
    const state = await guest.take('cowork.state', f => f.state.claims.some((c: any) => c.seat === seat));
    assert.equal(state.state.participants.find((p: any) => p.peerId === welcome.you).seat, seat);
    guest.send({ t: 'cowork.release' });
    await guest.take('cowork.state', f => !f.state.claims.some((c: any) => c.seat === seat));
  });
  await t.test('host moderation survives reconnects and applies to all tabs of a guest session', async () => {
    host.send({ t: 'floor.go', floor: '@lobby' });
    await host.take('floor.enter');
    const modCookie = await enter(invitation.token, 'Moderated visitor');
    const first = await connect(modCookie);
    const firstWelcome = await first.take('welcome');
    const second = await connect(modCookie);
    await second.take('welcome');
    host.send({ t: 'cowork.moderate', peerId: firstWelcome.you, action: 'mute' });
    await first.take('cowork.forceMute', (f) => f.muted);
    await second.take('cowork.forceMute', (f) => f.muted);
    first.send({ t: 'voice', voice: true, muted: false, sharing: true });
    await first.take('peer.update', (f) => f.peer.id === firstWelcome.you && f.peer.muted && !f.peer.voice && !f.peer.sharing);
    const again = await connect(modCookie);
    const reconnected = await again.take('welcome');
    assert.equal(reconnected.peers.find((p: any) => p.id === reconnected.you).muted, true);
    assert.equal(reconnected.me.guest.muted, true);
    await new Promise((resolve) => setTimeout(resolve, 310));
    host.send({ t: 'cowork.moderate', peerId: firstWelcome.you, action: 'unmute' });
    await first.take('cowork.forceMute', (f) => !f.muted);
    const released = await first.take('cowork.update', (f) => f.participant.peerId === firstWelcome.you && f.participant.hostMuted === false);
    assert.equal(released.participant.muted, true, 'lifting a host restriction does not turn on a guest microphone');
    // Host throttle is intentionally bounded; a ping provides ordering, not elapsed time.
    await new Promise((resolve) => setTimeout(resolve, 310));
    const closed = [first, second, again].map((v) => new Promise<void>((resolve) => v.ws.once('close', () => resolve())));
    host.send({ t: 'cowork.moderate', peerId: firstWelcome.you, action: 'kick' });
    await Promise.race([Promise.all(closed), new Promise((_, reject) => setTimeout(() => reject(new Error('guest tabs remained connected after kick')), 3000))]);
    assert.equal((await request('/api/whoami', modCookie)).status, 401);
  });
});
