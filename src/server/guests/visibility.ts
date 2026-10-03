import type { Ctx } from '../office/context.js';
import type { Client } from '../office/client.js';
import type { FloorInfo, MapState, ServerMsg } from '../../shared/protocol.js';
import { LOBBY } from '../../shared/coworking-space.js';
import { canGuestViewFloor, isGuestClient, isGuestMuted } from '../access.js';
import { floorView } from '../office/views.js';

export function guestMap(state: MapState, scoped: boolean): MapState {
  if (!scoped) return { pick: 'office', custom: [] };
  return { pick: state.pick, custom: state.custom.filter(m => m.config?.id === state.pick).map(m => ({ file: state.pick + '.json', config: m.config })) };
}

/** An explicit public DTO: future private FloorInfo fields are never copied by default. */
export function guestFloors(c: Client, floors: readonly FloorInfo[]): FloorInfo[] {
  return floors.filter(f => c.guestFloorIds?.includes(f.id)).map(f => ({ id: f.id, name: f.name, palette: f.palette, dir: '', addedBy: '', addedAt: 0, workers: 0, busy: 0, waiting: 0, people: 0, wing: 0 }));
}

/** Public response policy is a guest module; the shared messaging transport stays generic. */
export function createGuestVisibility(ctx: Ctx) {
  const peerFor = (id: string) => ctx.clients.get(id)?.peer;
  const visiblePeer = (c: Client, peer: Client['peer']) => peer.floor === c.peer.floor && canGuestViewFloor(c, peer.floor ?? LOBBY);
  const scrubPeer = (peer: Client['peer']): Client['peer'] => {
    const { id, name, color, look, x, y, z, rotY, moving, voice, muted, sharing, seat, floor, lite } = peer;
    return { id, name, color, look, x, y, z, rotY, moving, voice, muted, sharing: false, ...(seat ? { seat } : {}), ...(floor ? { floor } : {}), ...(lite ? { lite: true } : {}) };
  };
  const emptyFloor = (floor: string | null) => ({ ...floorView(ctx, undefined), floor });
  const forGuest = (c: Client, input: ServerMsg, direct: boolean): ServerMsg | undefined => {
    if (!isGuestClient(c)) return input;
    const msg = input;
    if (msg.t === 'welcome') {
      const peers = (msg.peers as Client['peer'][]).filter((p) => visiblePeer(c, p)).map(scrubPeer);
      c.visiblePeers = new Set(peers.map((p) => p.id));
      const zero = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, calls: 0 };
      return { t: 'welcome', you: msg.you, peers, chat: [], floors: guestFloors(c, msg.floors), projectsDir: { dir: '', custom: false }, ice: msg.ice, invites: false,
        version: msg.version, upgrade: { available: false, phase: 'idle' }, usage: { total: zero, today: zero, day: '', pauseHiring: false }, limits: { windows: [], at: 0 },
        me: { admin: false, role: 'guest', guest: { name: c.guestName ?? c.peer.name, lobby: true, floorIds: c.guestFloorIds ?? [], muted: isGuestMuted(c) }, lobby: true, lobbyOnly: ctx.cfg.lobbyOnly },
        notify: {}, machine: { cpu: 0, cores: 0, memUsed: 0, memTotal: 0, history: [], workers: 0 }, sky: msg.sky, theme: msg.theme, map: guestMap(msg.map, !!c.guestFloorIds?.length), prompts: { custom: {} }, leaveOnMerge: { on: false }, ...emptyFloor(msg.floor) };
    }
    if (msg.t === 'floor.enter') {
      const target = String(msg.floor ?? LOBBY);
      if (!canGuestViewFloor(c, target)) return undefined;
      const peers = (msg.peers as Client['peer'][]).filter((p) => p.floor === target && canGuestViewFloor(c, target)).map(scrubPeer);
      c.visiblePeers = new Set(peers.map((p) => p.id));
      return { t: 'floor.enter', peers, ...emptyFloor(msg.floor) };
    }
    if (msg.t === 'floors') return { t: 'floors', floors: guestFloors(c, msg.floors) } as ServerMsg;
    if (msg.t === 'peer.join' || msg.t === 'peer.update') {
      if (!visiblePeer(c, msg.peer)) {
        return c.visiblePeers.delete(msg.peer.id) ? { t: 'peer.leave', id: msg.peer.id } : undefined;
      }
      c.visiblePeers.add(msg.peer.id);
      return { t: msg.t, peer: scrubPeer(msg.peer) } as ServerMsg;
    }
    if (msg.t === 'peer.leave') {
      if (!c.visiblePeers.delete(msg.id)) return undefined;
      return input;
    }
    if (msg.t === 'peer.move' || msg.t === 'peer.emote') {
      const peer = peerFor(msg.id);
      return peer && visiblePeer(c, peer) ? input : undefined;
    }
    if (msg.t === 'chat') return typeof msg.floor === 'string' && msg.floor === c.peer.floor && canGuestViewFloor(c, msg.floor) ? input : undefined;
    if (msg.t === 'me') return msg.me?.role === 'guest' ? input : undefined;
    if (msg.t === 'map') return c.guestFloorIds?.length ? { t: 'map', state: guestMap(msg.state, true) } : undefined;
    if (msg.t === 'rtc') {
      const sender = peerFor(msg.from);
      return sender && visiblePeer(c, sender) && !isGuestMuted(c) && !isGuestMuted(ctx.clients.get(msg.from)!) ? input : undefined;
    }
    if (PUBLIC_COWORK.has(msg.t)) return canGuestViewFloor(c, c.peer.floor ?? LOBBY) ? input : undefined;
    if (msg.t === 'pong' || msg.t === 'sit.refused') return direct ? input : undefined;
    if (msg.t === 'toast') return direct ? { ...msg, text: 'That request could not be completed.' } as ServerMsg : undefined;
    return undefined;
  };
  return forGuest;
}

const PUBLIC_COWORK = new Set<string>(['cowork.state', 'cowork.update', 'cowork.remove', 'cowork.refused', 'cowork.forceMute', 'cowork.saved']);
