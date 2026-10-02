import type { CoworkClientMsg, CoworkParticipant, ServerMsg } from '../../../shared/protocol.js';
import { canModerateCoworking, coworkZoneAt } from '../../../shared/coworking.js';
import { seatHereOn } from '../../../shared/maps/index.js';
import { LOBBY } from '../../../shared/coworking-space.js';
import { isGuestClient, revokeGuestSession, setGuestMuted } from '../../access.js';
import { coworkLobbyFor } from '../../coworking.js';
import { throttle, type Client } from '../../office/client.js';
import { str } from '../../office/input.js';
import type { HandlerMap, FeatureHooks } from './types.js';

const inLobby = (c: Client) => c.peer.floor === LOBBY;
const lobbyPeers = (ctx: Parameters<HandlerMap<CoworkClientMsg>['cowork.sync']>[0]) => [...ctx.clients.values()].filter(inLobby);

function broadcast(ctx: Parameters<HandlerMap<CoworkClientMsg>['cowork.sync']>[0], msg: ServerMsg) {
  for (const peer of lobbyPeers(ctx)) ctx.sendTo(peer, msg);
}

function getParticipant(ctx: Parameters<HandlerMap<CoworkClientMsg>['cowork.sync']>[0], c: Client): CoworkParticipant {
  const p = coworkLobbyFor(ctx).upsert(c.id, c.peer.name);
  p.muted = c.peer.muted;
  p.account = c.accountId ? true : undefined;
  p.guest = isGuestClient(c);
  p.seat = c.peer.seat;
  p.zone = coworkZoneAt(c.peer.x);
  return p;
}

export const coworkHooks: FeatureHooks = {
  leaving(ctx, c) {
    if (!inLobby(c)) return;
    const lobby = coworkLobbyFor(ctx);
    lobby.remove(c.id);
    c.peer.seat = undefined;
    for (const peer of lobbyPeers(ctx)) ctx.sendTo(peer, { t: 'cowork.remove', peerId: c.id });
    broadcast(ctx, { t: 'cowork.state', state: lobby.snapshot(LOBBY, new Set(lobbyPeers(ctx).map((p) => p.id))) });
  },
  closed(ctx, c) {
    const lobby = coworkLobbyFor(ctx);
    if (!lobby.participants.has(c.id)) return;
    lobby.remove(c.id);
    for (const peer of lobbyPeers(ctx)) ctx.sendTo(peer, { t: 'cowork.remove', peerId: c.id });
    broadcast(ctx, { t: 'cowork.state', state: lobby.snapshot(LOBBY, new Set(lobbyPeers(ctx).map((p) => p.id))) });
  },
};

export const coworkHandlers = {
  'cowork.sync'(ctx, c) {
    if (!inLobby(c)) return;
    const lobby = coworkLobbyFor(ctx);
    for (const peer of lobbyPeers(ctx)) getParticipant(ctx, peer);
    ctx.sendTo(c, { t: 'cowork.state', state: lobby.snapshot(LOBBY, new Set(lobbyPeers(ctx).map((p) => p.id))) });
  },
  'cowork.claim'(ctx, c, msg) {
    const lobby = coworkLobbyFor(ctx);
    if (!inLobby(c)) return;
    if (!throttle(c, 'cowork', 300)) return;
    const seat = str(msg.seat, 40);
    const plan = ctx.maps.plan();
    const place = seat && plan.seatingById.has(seat.split(':')[0]) && seatHereOn(plan, seat, false);
    if (!seat || !place || Math.hypot(place.x - c.peer.x, place.z - c.peer.z) > 4) {
      ctx.sendTo(c, { t: 'cowork.refused', text: 'That desk is not available here.' });
      return;
    }
    const owner = lobby.claims.get(seat);
    if (owner && owner !== c.id) {
      ctx.sendTo(c, { t: 'cowork.refused', text: 'Someone has already claimed that seat.' });
      return;
    }
    if (!lobby.claim(c.id, c.peer.name, seat)) return;
    c.peer.seat = seat;
    c.peer.x = place!.x;
    c.peer.y = place!.y;
    c.peer.z = place!.z;
    c.peer.rotY = place!.rotY;
    c.peer.moving = false;
    ctx.toNeighbors(c, { t: 'peer.update', peer: c.peer });
    broadcast(ctx, { t: 'cowork.update', participant: getParticipant(ctx, c) });
    broadcast(ctx, { t: 'cowork.state', state: lobby.snapshot(LOBBY, new Set(lobbyPeers(ctx).map((p) => p.id))) });
  },
  'cowork.release'(ctx, c) {
    const lobby = coworkLobbyFor(ctx);
    if (!inLobby(c)) return;
    lobby.release(c.id);
    delete c.peer.seat;
    ctx.toNeighbors(c, { t: 'peer.update', peer: c.peer });
    broadcast(ctx, { t: 'cowork.update', participant: getParticipant(ctx, c) });
    broadcast(ctx, { t: 'cowork.state', state: lobby.snapshot(LOBBY, new Set(lobbyPeers(ctx).map((p) => p.id))) });
  },
  'cowork.profile'(ctx, c, msg) {
    if (!inLobby(c) || !throttle(c, 'cowork-profile', 500)) return;
    const lobby = coworkLobbyFor(ctx);
    const intention = str(msg.intention, 120).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
    const status = str(msg.status, 60).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
    const participant = lobby.profile(c.id, {
      name: c.peer.name,
      intention,
      status,
      zone: coworkZoneAt(c.peer.x),
    });
    broadcast(ctx, { t: 'cowork.update', participant });
    ctx.sendTo(c, { t: 'cowork.saved' });
  },
  'cowork.moderate'(ctx, c, msg) {
    const lobby = coworkLobbyFor(ctx);
    if (!inLobby(c) || !c.admin) {
      ctx.sendTo(c, { t: 'cowork.refused', text: 'Only a host can manage lobby guests.' });
      return;
    }
    const target = ctx.clients.get(str(msg.peerId, 40));
    if (!target || !inLobby(target) || !canModerateCoworking(c.admin, isGuestClient(target), target.id, c.id)) {
      ctx.sendTo(c, { t: 'cowork.refused', text: 'That guest is no longer in the lobby.' });
      return;
    }
    if (!throttle(c, 'cowork-moderate', 300)) return;
    const guestPeers = [...ctx.clients.values()].filter((peer) => peer.guestId === target.guestId);
    if (msg.action === 'kick') {
      for (const peer of guestPeers) {
        ctx.sendTo(peer, { t: 'toast', text: 'The host removed you from the lobby.', level: 'warn' });
        revokeGuestSession(peer);
      }
      return;
    }
    if (msg.action !== 'mute' && msg.action !== 'unmute') return;
    const muted = msg.action === 'mute';
    for (const peer of guestPeers) {
      setGuestMuted(peer, muted);
      peer.peer.muted = muted;
      ctx.toNeighbors(peer, { t: 'peer.update', peer: peer.peer });
      ctx.sendTo(peer, { t: 'peer.update', peer: peer.peer });
      ctx.sendTo(peer, { t: 'cowork.forceMute', muted });
      if (inLobby(peer)) broadcast(ctx, { t: 'cowork.update', participant: getParticipant(ctx, peer) });
    }
  },
} satisfies HandlerMap<CoworkClientMsg>;
