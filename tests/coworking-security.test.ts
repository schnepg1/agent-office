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

type Frame = { t: string; [key: string]: any };
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

test('public invitations cannot expose private projects or authorize host operations', { timeout: 60000 }, async (t) => {
  const temp = mkdtempSync(path.join(tmpdir(), 'office-guest-boundary-'));
  const home = path.join(temp, 'home');
  const project = path.join(temp, 'PRIVATE_PROJECT_NEVER_PUBLIC');
  const pub = path.join(temp, 'public');
  for (const dir of [home, project, pub]) mkdirSync(dir, { recursive: true });
  for (const page of ['index', 'guest', 'login', 'lite', 'join', 'claim']) {
    writeFileSync(path.join(pub, `${page}.html`), `<!doctype html><title>${page}</title>`);
  }
  writeFileSync(path.join(project, 'private-notes.md'), 'PRIVATE_FILE_NEVER_PUBLIC');
  const port = await new Promise<number>((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
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
    assert.equal(response.status, 200);
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

  await t.test('forged arrival and private welcome data are filtered', async () => {
    assert.equal(welcome.floor, '@lobby');
    assert.equal(welcome.me.admin, false);
    assert.ok(welcome.me.guest);
    assert.equal(welcome.floors.some((floor: any) => floor.id === privateFloor), false);
    assert.equal(welcome.peers.some((peer: any) => peer.id === hostWelcome.you), false);
    assert.doesNotMatch(JSON.stringify(welcome), /PRIVATE_PROJECT_NEVER_PUBLIC|PRIVATE_FILE_NEVER_PUBLIC/);
  });
  await t.test('HTTP routes and invitation management reject guest privilege escalation', async () => {
    for (const route of ['/api/search?q=private', `/api/docs?floor=${privateFloor}`, '/api/image?url=http://127.0.0.1', '/api/guest/invitations', '/api/models/opencode', '/lite']) {
      assert.equal((await request(route, guestCookie)).status, 403, route);
    }
    assert.equal((await request('/api/guest/invitations', guestCookie, 'POST', { floorIds: [privateFloor] })).status, 403);
    assert.equal((await request('/api/guest/invitations', hostCookie, 'POST', {}, 'https://other.example')).status, 403);
  });
  await t.test('forged WebSocket operations and floor changes are rejected', async () => {
    for (const frame of [
      { t: 'floor.go', floor: privateFloor },
      { t: 'floor.repos' }, { t: 'worker.spawn', deskId: 'desk-1' },
      { t: 'notify.webhook', url: 'https://example.com/attacker' },
      { t: 'accounts.invite', role: 'admin' },
      { t: 'signins.start', which: 'github' },
      { t: 'future.privileged.command' },
    ]) {
      guest.frames = [];
      guest.send(frame);
      await guest.take('toast');
      await guest.barrier();
      assert.equal(guest.frames.some((f) => f.t === 'floor.enter'), false);
    }
  });
  await t.test('private-floor chat stays private and social participation works', async () => {
    guest.frames = [];
    host.send({ t: 'chat', text: 'PRIVATE_CHAT_NEVER_PUBLIC' });
    await host.barrier();
    await guest.barrier();
    assert.doesNotMatch(JSON.stringify(guest.frames), /PRIVATE_CHAT_NEVER_PUBLIC/);
    guest.send({ t: 'chat', text: 'Hello coworking lobby' });
    const line = await guest.take('chat');
    assert.equal(line.text, 'Hello coworking lobby');
    const again = await connect(guestCookie);
    assert.doesNotMatch(JSON.stringify(await again.take('welcome')), /PRIVATE_CHAT_NEVER_PUBLIC/);
  });
  await t.test('explicit floor visits do not grant mutation or terminal access', async () => {
    const scopedInvite = await invite([privateFloor]);
    const scopedCookie = await enter(scopedInvite.token, 'Workspace visitor');
    const scoped = await connect(scopedCookie);
    await scoped.take('welcome');
    scoped.send({ t: 'floor.go', floor: privateFloor });
    const view = await scoped.take('floor.enter');
    assert.equal(view.floor, privateFloor);
    assert.equal(view.services?.items?.length ?? 0, 0);
    scoped.send({ t: 'worker.spawn', deskId: 'desk-1' });
    await scoped.take('toast');
    assert.equal((await request(`/api/docs?floor=${privateFloor}`, scopedCookie)).status, 403);
  });
  await t.test('single-use invitations cannot be replayed', async () => {
    const one = await invite([], 1);
    await enter(one.token, 'First visitor');
    assert.equal((await request('/api/guest/enter', '', 'POST', { token: one.token, name: 'Replay visitor' })).status, 410);
  });
  await t.test('revocation invalidates existing cookies and closes live guests', async () => {
    const closed = new Promise<void>((resolve) => guest.ws.once('close', () => resolve()));
    assert.equal((await request(`/api/guest/invitations/${invitation.invitation.id}`, hostCookie, 'DELETE')).status, 200);
    await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('guest remained connected after revoke')), 3000))]);
    assert.equal((await request('/api/whoami', guestCookie)).status, 401);
    assert.equal((await request('/api/guest/enter', '', 'POST', { token: invitation.token, name: 'Another visitor' })).status, 410);
  });
});
