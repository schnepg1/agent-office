import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { Session } from '../auth.js';
import type { ClientMsg } from '../../shared/protocol.js';
import { elevatorSpot } from '../../shared/layout.js';
import { lookFromSeed, sanitizeLook } from '../../shared/avatar.js';
import { ROOF } from '../../shared/rooftop.js';
import { LOBBY } from '../../shared/coworking-space.js';
import type { Ctx } from '../office/context.js';
import { newClient } from '../office/client.js';
import { COLOR_RE, spotFrom, str } from '../office/input.js';
import { floorView, roofView, screensOf } from '../office/views.js';
import { dispatch } from './dispatch.js';
import { features } from './handlers/index.js';
import { mapNews } from './handlers/settings.js';

/**
 * Someone came in: where they arrive and who they are, the welcome with everything they see, and
 * then whatever they send, until they leave.
 */
export function onConnection(ctx: Ctx, ws: WebSocket, url: URL, session: Session) {
  const { cfg, accounts, clients, chat, building, floors, maps, team, upgrader, ledger, webhook, machine, sky, themes, prompts, leaveOnMerge, signins } = ctx;
  const { sendTo, broadcast, floorInfos, floorsChanged, arrivalFloor, meOf, accountsChanged, limitsOf } = ctx;
  const id = randomBytes(5).toString('hex');
  // Back on the floor they were on before a reload, a restart or closing the tab, else the first floor.
  const wanted = url.searchParams.get('floor');
  const guest = session.guestId ? ctx.guests.session(session.guestId) : undefined;
  if (session.guestId && !guest) { ws.close(4003, 'Guest access revoked'); return; }
  // Their floor's gone since (taken off the building, or its checkout deleted): up to the roof instead.
  const gone = !!wanted && wanted !== ROOF && wanted !== LOBBY && !floors.has(wanted);
  // Up on the roof, as long as there's a building under it.
  const onRoof = !guest && (wanted === ROOF || gone) && floors.size > 0;
  const floor = guest || onRoof || wanted === LOBBY ? undefined : arrivalFloor(wanted);
  // Back where they were standing on it too; anywhere else, they arrive by elevator.
  const back = !gone && wanted !== null && (onRoof || floor?.id === wanted);
  const spot = (back && spotFrom(url.searchParams)) || { ...elevatorSpot(), y: 0, rotY: 0 };
  const account = session.account;
  // An account's name is its own; on the shared password people pick one.
  const name = account?.name ?? guest?.info.name ?? (str(url.searchParams.get('name'), 24).trim() || `Guest ${id.slice(0, 3)}`);
  const colorParam = url.searchParams.get('color') ?? '';
  const intParam = (k: string) => (url.searchParams.get(k) ? Number(url.searchParams.get(k)) : undefined);
  const me = meOf(account?.id, guest ? { ...guest.info, muted: !!guest.muted } : undefined);
  const client = newClient(id, ws, { accountId: account?.id, admin: me.admin, ...(guest ? { guestId: guest.id, guestName: guest.info.name, guestFloorIds: guest.info.floorIds } : {}) }, {
    id,
    name,
    color: COLOR_RE.test(colorParam) ? colorParam : '#4f86f7',
    look: sanitizeLook({ skin: intParam('skin'), hair: intParam('hair'), style: intParam('style') }, lookFromSeed(id)),
    x: spot.x,
    y: spot.y,
    z: spot.z,
    // The way they were facing, or out through the elevator's doors.
    rotY: spot.rotY,
    moving: false,
    voice: false,
    muted: true,
    sharing: false,
    ...(account ? { account: true } : {}),
    ...(url.searchParams.get('lite') === '1' ? { lite: true } : {}),
    ...(guest || wanted === LOBBY || (!onRoof && !floor) ? { floor: LOBBY } : onRoof ? { floor: ROOF } : floor ? { floor: floor.id } : {}),
  });
  if (guest) {
    client.guestMuted = guest.muted;
    client.setGuestMuted = (muted) => {
      ctx.guests.setMuted(guest.id, muted);
      for (const target of clients.values()) if (target.guestId === guest.id) {
        target.guestMuted = muted;
        if (muted) { target.peer.voice = false; target.peer.muted = true; target.peer.sharing = false; }
        ctx.sendTo(target, { t: 'me', me: meOf(undefined, { ...guest.info, muted }) });
      }
    };
    client.revokeGuestSession = () => {
      ctx.guests.revokeSession(guest.id);
      for (const target of clients.values()) if (target.guestId === guest.id) { target.out = true; target.ws.close(4003, 'Guest access revoked'); }
    };
  }
  // Maps of your own may have been added or edited since: everyone already in hears first.
  if (!guest) {
    const mapWas = maps.pick();
    if (maps.reload()) mapNews(ctx, mapWas);
  }
  clients.set(id, client);
  if (account) accounts.seen(account.id);
  ws.on('pong', () => (client.isAlive = true));

  sendTo(client, {
    t: 'welcome',
    you: id,
    peers: [...clients.values()].filter((c) => !guest || c.peer.floor === LOBBY || !!c.peer.floor && guest.info.floorIds.includes(c.peer.floor)).map((c) => c.peer),
    floors: guest ? floorInfos().filter((f) => guest.info.floorIds.includes(f.id)).map((f) => ({ ...f, dir: '', repo: undefined, addedBy: '', people: 0, workers: 0, busy: 0, waiting: 0 })) : floorInfos(),
    projectsDir: guest ? { dir: '', custom: false } : building.projectsDirState(),
    ice: cfg.iceServers,
    chat: guest ? chat.recent(50).filter((line) => line.floor === (client.peer.floor ?? LOBBY)) : chat.recent(50),
    invites: guest ? false : team.available || !!cfg.tailnet,
    version: upgrader.version,
    upgrade: guest ? { available: false, phase: 'idle' } : upgrader.state,
    usage: guest ? { total: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, calls: 0 }, today: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, calls: 0 }, day: '', pauseHiring: false } : ledger.state(),
    limits: guest ? { windows: [], at: 0 } : limitsOf(client).state,
    me,
    notify: guest ? {} : webhook.state(),
    machine: guest ? { cpu: 0, cores: 0, memUsed: 0, memTotal: 0, history: [], workers: 0 } : machine.state(),
    sky: sky.state,
    theme: themes.state(),
    map: guest ? { pick: 'office', custom: [] } : maps.state(),
    prompts: guest ? { custom: {} } : prompts.state(),
    leaveOnMerge: guest ? { on: false } : leaveOnMerge.state(),
    ...(onRoof ? roofView(ctx) : { ...floorView(ctx, floor), ...(guest || (!onRoof && !floor) ? { floor: LOBBY } : {}) }),
  });
  if (!guest) screensOf(ctx, client, floor);
  broadcast({ t: 'peer.join', peer: client.peer }, id);
  if (account) accountsChanged(); // now online
  floorsChanged();
  if (floor) {
    floor.arrived();
    // Anyone whose process ended since (exited, or failed to resume) gets up as you walk in.
    floor.workers.wakeAll();
  }
  if (!guest) limitsOf(client).refresh();
  if (account) {
    sendTo(client, { t: 'signins', state: signins.state(account.id) });
    void signins.look(account.id);
  }

  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || client.out) return;
    dispatch(ctx, client, msg);
  });
  ws.on('close', () => {
    clients.delete(id);
    // Each feature lets go of what they had (see FeatureHooks), then of what they had on each floor.
    for (const f of features) f.closed?.(ctx, client);
    for (const floor of floors.values()) for (const f of features) f.closedOn?.(ctx, client, floor);
    broadcast({ t: 'peer.leave', id });
    if (account) accountsChanged();
    floorsChanged();
  });
  ws.on('error', () => ws.terminate());
}
