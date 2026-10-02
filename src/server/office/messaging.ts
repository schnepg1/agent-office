import { WebSocket } from 'ws';
import type { Ctx, Messaging, ToastLevel } from './context.js';
import type { Client } from './client.js';
import type { Floor } from '../floor.js';
import type { ServerMsg } from '../../shared/protocol.js';
import { LOBBY } from '../../shared/coworking-space.js';
import { canGuestViewFloor, isGuestClient, isGuestMuted } from '../access.js';
import { floorView } from './views.js';

/** Sending to the browsers in `ctx.clients`: one, everyone, a floor, or someone's neighbors. */
export function messaging(ctx: Ctx): Messaging {
  const peerFor = (id: string) => ctx.clients.get(id)?.peer;
  const visiblePeer = (c: Client, peer: Client['peer']) => peer.floor === c.peer.floor && canGuestViewFloor(c, peer.floor ?? LOBBY);
  const scrubPeer = (peer: Client['peer']): Client['peer'] => {
    const { id, name, color, look, x, y, z, rotY, moving, voice, muted, sharing, seat, floor, lite } = peer;
    return { id, name, color, look, x, y, z, rotY, moving, voice, muted, sharing: false, ...(seat ? { seat } : {}), ...(floor ? { floor } : {}), ...(lite ? { lite: true } : {}) };
  };
  const scrubFloors = (c: Client, floors: any[]) => floors.filter((f) => c.guestFloorIds?.includes(f.id)).map((f) => ({ ...f, dir: '', repo: undefined, addedBy: '', people: 0, workers: 0, busy: 0, waiting: 0 }));
  const scrubFloor = (msg: ServerMsg): ServerMsg => {
    const fields = (msg as ServerMsg & Record<string, any>);
    return { ...fields, ...floorView(ctx, undefined), floor: fields.floor } as ServerMsg;
  };
  const forGuest = (c: Client, input: ServerMsg, direct: boolean): ServerMsg | undefined => {
    if (!isGuestClient(c)) return input;
    const msg = input as ServerMsg & Record<string, any>;
    if (msg.t === 'welcome') {
      const peers = (msg.peers as Client['peer'][]).filter((p) => visiblePeer(c, p)).map(scrubPeer);
      c.visiblePeers = new Set(peers.map((p) => p.id));
      return scrubFloor({ ...msg, peers, chat: [], floors: scrubFloors(c, msg.floors as any[]) } as unknown as ServerMsg);
    }
    if (msg.t === 'floor.enter') {
      const target = String(msg.floor ?? LOBBY);
      if (!canGuestViewFloor(c, target)) return undefined;
      const peers = (msg.peers as Client['peer'][]).filter((p) => p.floor === target && canGuestViewFloor(c, target)).map(scrubPeer);
      c.visiblePeers = new Set(peers.map((p) => p.id));
      return scrubFloor({ ...msg, peers } as ServerMsg);
    }
    if (msg.t === 'floors') return { t: 'floors', floors: scrubFloors(c, msg.floors) } as ServerMsg;
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
    if (msg.t === 'rtc') {
      const sender = peerFor(msg.from);
      return sender && visiblePeer(c, sender) && !isGuestMuted(c) && !isGuestMuted(ctx.clients.get(msg.from)!) ? input : undefined;
    }
    if (msg.t.startsWith('cowork.')) return canGuestViewFloor(c, c.peer.floor ?? LOBBY) ? input : undefined;
    if (msg.t === 'pong' || msg.t === 'sit.refused') return direct ? input : undefined;
    if (msg.t === 'toast') return direct ? { ...msg, text: 'That request could not be completed.' } as ServerMsg : undefined;
    return undefined;
  };
  const sendTo = (c: Client, msg: ServerMsg) => {
    const safe = forGuest(c, msg, true);
    if (safe && c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(safe));
  };
  const broadcast = (msg: ServerMsg, except?: string, droppable = false) => {
    for (const c of ctx.clients.values()) {
      if (c.id === except || c.ws.readyState !== WebSocket.OPEN) continue;
      if (droppable && c.ws.bufferedAmount > 4 * 1024 * 1024) continue;
      const safe = forGuest(c, msg, false);
      if (safe) c.ws.send(JSON.stringify(safe));
    }
  };
  const toastAll = (text: string, level: ToastLevel = 'info') => broadcast({ t: 'toast', text, level });
  /** To everyone on one floor. */
  const toFloor = (floor: Floor, msg: ServerMsg, droppable = false) => {
    for (const c of ctx.clients.values()) {
      if (c.peer.floor !== floor.id || c.ws.readyState !== WebSocket.OPEN) continue;
      if (droppable && c.ws.bufferedAmount > 4 * 1024 * 1024) continue;
      const safe = forGuest(c, msg, false);
      if (safe) c.ws.send(JSON.stringify(safe));
    }
  };
  const toastFloor = (floor: Floor | undefined, text: string, level: ToastLevel = 'info') => {
    if (floor) toFloor(floor, { t: 'toast', text, level });
  };
  /** To everyone else on the same floor as `c`: nobody on another floor can see them. */
  const toNeighbors = (c: Client, msg: ServerMsg, droppable = false) => {
    if (!c.peer.floor) return;
    for (const o of ctx.clients.values()) {
      if (o.id === c.id || o.peer.floor !== c.peer.floor || o.ws.readyState !== WebSocket.OPEN) continue;
      if (droppable && o.ws.bufferedAmount > 4 * 1024 * 1024) continue;
      const safe = forGuest(o, msg, false);
      if (safe) o.ws.send(JSON.stringify(safe));
    }
  };
  /** Tells just this person why their request didn't happen; nothing when there's no error. */
  const warn = (c: Client, error: string | undefined) => {
    if (error) sendTo(c, { t: 'toast', text: error, level: 'warn' });
  };
  return { sendTo, broadcast, toastAll, toFloor, toastFloor, toNeighbors, warn };
}
