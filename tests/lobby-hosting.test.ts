import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import WebSocket from 'ws';
import { startServer } from '../src/server/server.js';
import { loadConfig } from '../src/server/config.js';
import { LOBBY_PLAN } from '../src/shared/lobby-map.js';

test('authenticated lobby travel and standalone startup preserve saved projects', { timeout: 30000 }, async () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'office-lobby-host-'));
  const project = path.join(temp, 'project'), home = path.join(temp, 'home'), pub = path.join(temp, 'public');
  for (const dir of [project, home, pub]) mkdirSync(dir);
  writeFileSync(path.join(pub, 'index.html'), '<title>Lobby</title>');
  const servers: Awaited<ReturnType<typeof startServer>>[] = [], sockets: WebSocket[] = [];
  async function start(standalone: boolean) {
    const port = await new Promise<number>(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); });
    const office = await startServer(loadConfig([project, '--home', home, '--port', String(port), '--password', 'lobby-test', '--no-open', '--weather', 'clear', ...(standalone ? ['--lobby-only'] : [])]), { publicDir: pub }); servers.push(office);
    const base = `http://127.0.0.1:${port}`;
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ password: 'lobby-test' }) });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { headers: { cookie, origin: base } }); sockets.push(ws);
    const frames: any[] = []; ws.on('message', raw => frames.push(JSON.parse(String(raw))));
    const take = async (type: string) => { const end = Date.now() + 4000; while (Date.now() < end) { const i = frames.findIndex(f => f.t === type); if (i >= 0) return frames.splice(i, 1)[0]; await new Promise(r => setTimeout(r, 10)); } throw Error('Missing ' + type); };
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    return { office, base, cookie, ws, take, welcome: await take('welcome') };
  }
  try {
    const normal = await start(false), projectId = normal.welcome.floor;
    assert.notEqual(projectId, '@lobby');
    normal.ws.send(JSON.stringify({ t: 'floor.go', floor: '@lobby' }));
    const lobby = await normal.take('floor.enter'); assert.equal(lobby.floor, '@lobby'); assert.equal(lobby.project, null);
    normal.ws.send(JSON.stringify({ t: 'floor.go', floor: projectId })); assert.equal((await normal.take('floor.enter')).floor, projectId);
    const standalone = await start(true);
    assert.equal(standalone.office.floors().length, 0); assert.equal(normal.office.floors().length, 1);
    assert.equal(standalone.welcome.floor, '@lobby'); assert.equal(standalone.welcome.project, null);
    assert.equal(standalone.welcome.peers.find((p: any) => p.id === standalone.welcome.you).x, LOBBY_PLAN.spawn.x);
    assert.equal((await fetch(standalone.base + '/', { headers: { cookie: standalone.cookie } })).status, 200);
    assert.equal((await fetch(standalone.base + '/api/search?q=test', { headers: { cookie: standalone.cookie } })).status, 403);
  } finally {
    sockets.forEach(ws => ws.terminate()); servers.forEach(s => s.shutdown()); await new Promise(r => setTimeout(r, 150));
    assert.ok(path.resolve(temp).startsWith(path.resolve(tmpdir()) + path.sep)); rmSync(temp, { recursive: true, force: true });
  }
});
