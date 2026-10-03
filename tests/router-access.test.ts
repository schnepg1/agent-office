import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { requestHandler, type Route } from '../src/server/http/router.js';
import type { Ctx } from '../src/server/office/context.js';

async function request(t: { after(fn: () => void): void }, ctx: Partial<Ctx>, routes: readonly Route[], path: string) {
  const server = http.createServer(requestHandler(ctx as Ctx, routes));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  t.after(() => server.close());
  return fetch(`http://127.0.0.1:${address.port}${path}`);
}

test('a matched signed-in API gives guests an explicit forbidden response', async (t) => {
  let called = false;
  const response = await request(t, {
    cfg: { port: 4600, trustProxy: false } as Ctx['cfg'],
    auth: { fromRequest: () => ({ guestId: 'guest' }) } as unknown as Ctx['auth'],
    guests: { session: () => ({ id: 'guest', info: { name: 'Ada', lobby: true, floorIds: [] } }) } as unknown as Ctx['guests'],
    services: { lookup: () => undefined } as unknown as Ctx['services'],
  }, [{ path: '/api/private', auth: 'session', handle: () => { called = true; } }], '/api/private');
  assert.equal(response.status, 403);
  assert.equal(called, false);
});

test('lobby-only mode denies project APIs and permits explicitly marked lobby APIs', async (t) => {
  const ctx = {
    cfg: { port: 4600, trustProxy: false, lobbyOnly: true } as Ctx['cfg'],
    auth: { fromRequest: () => ({}) } as unknown as Ctx['auth'],
    guests: { session: () => undefined } as unknown as Ctx['guests'],
    services: { lookup: () => undefined } as unknown as Ctx['services'],
  };
  const routes: Route[] = [
    { path: '/api/project', auth: 'session', handle: (_ctx, { res }) => { res.writeHead(200).end('project'); } },
    { path: '/api/lobby', auth: 'session', lobbyOnly: true, handle: (_ctx, { res }) => { res.writeHead(200).end('lobby'); } },
  ];
  const project = await request(t, ctx, routes, '/api/project');
  const lobby = await request(t, ctx, routes, '/api/lobby');
  assert.equal(project.status, 403);
  assert.equal(lobby.status, 200);
});
