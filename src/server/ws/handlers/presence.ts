// People in the office: walking about, reaching for things, sitting, carrying issue cards, emotes,
// their name and look, what they have open, voice and screen sharing, and chat.
import type { ChatLine, PresenceClientMsg } from '../../../shared/protocol.js';
import { seatHereOn } from '../../../shared/maps/index.js';
import { sanitizeLook } from '../../../shared/avatar.js';
import { isEmote } from '../../../shared/emotes.js';
import { ROOF, isDrink } from '../../../shared/rooftop.js';
import { isBarGame } from '../../../shared/bargames.js';
import { throttle } from '../../office/client.js';
import { coworkLobbyFor } from '../../coworking.js';
import { coworkZoneAt } from '../../../shared/coworking.js';
import { LOBBY } from '../../../shared/coworking-space.js';
import { COLOR_RE, issueNumber, num, str } from '../../office/input.js';
import type { HandlerMap } from './types.js';
import { isGuestClient, isGuestMuted } from '../../access.js';

export const presenceHandlers = {
  move(ctx, c, msg) {
    const cowork = coworkLobbyFor(ctx);
    const p = c.peer;
    p.x = num(msg.x);
    p.y = num(msg.y);
    p.z = num(msg.z);
    p.rotY = num(msg.rotY);
    p.moving = !!msg.moving;
    ctx.toNeighbors(c, { t: 'peer.move', id: c.id, x: p.x, y: p.y, z: p.z, rotY: p.rotY, moving: p.moving }, true);
    if (p.floor === LOBBY) {
      const participant = cowork.participants.get(c.id);
      const zone = coworkZoneAt(p.x);
      if (participant && participant.zone !== zone) {
        participant.zone = zone;
        ctx.toNeighbors(c, { t: 'cowork.update', participant });
        ctx.sendTo(c, { t: 'cowork.update', participant });
      }
    }
  },
  act(ctx, c, msg) {
    if (msg.drink !== undefined) {
      // A drink from the rooftop bar, which stays up there.
      const drink = isDrink(msg.drink) && c.peer.floor === ROOF ? msg.drink : undefined;
      if (drink === c.peer.drink) return;
      if (drink) c.peer.drink = drink;
      else delete c.peer.drink;
      ctx.broadcast({ t: 'peer.act', id: c.id, drink: drink ?? null }, c.id, true);
      return;
    }
    if (typeof msg.smoke === 'boolean') {
      if (msg.smoke === !!c.peer.smoking) return;
      c.peer.smoking = msg.smoke;
      ctx.broadcast({ t: 'peer.act', id: c.id, smoke: msg.smoke }, c.id, true);
      return;
    }
    if (typeof msg.golf === 'boolean') {
      // The tee's on an office floor's balcony; there's none up on the roof.
      const golf = msg.golf && c.peer.floor !== ROOF;
      if (golf === !!c.peer.golfing) return;
      if (golf) c.peer.golfing = true;
      else delete c.peer.golfing;
      ctx.broadcast({ t: 'peer.act', id: c.id, golf }, c.id, true);
      return;
    }
    if (msg.throwing !== undefined) {
      // The dart board and the axe lane are up on the roof.
      const game = isBarGame(msg.throwing) && c.peer.floor === ROOF ? msg.throwing : undefined;
      if (game === c.peer.throwing) return;
      if (game) c.peer.throwing = game;
      else delete c.peer.throwing;
      ctx.broadcast({ t: 'peer.act', id: c.id, throwing: game ?? null }, c.id, true);
      return;
    }
    if (!throttle(c, 'act', 100)) return;
    ctx.toNeighbors(c, { t: 'peer.act', id: c.id }, true);
  },
  emote(ctx, c, msg) {
    if (isEmote(msg.emote) && c.emotes.take(Date.now())) ctx.toNeighbors(c, { t: 'peer.emote', id: c.id, emote: msg.emote }, true);
  },
  sit(ctx, c, msg) {
    const cowork = coworkLobbyFor(ctx);
    // Everyone sees them sit down (or get up), and anyone who comes in later finds them sitting.
    // Only on a seat where they are: the roof's up on the roof, the office's on a floor.
    const key = str(msg.seat, 40);
    const plan = ctx.maps.plan();
    const deskSeatAllowed = !key.startsWith('desk-seat-') || plan.seatingById.has(key.split(':')[0]);
    const place = deskSeatAllowed ? seatHereOn(plan, key, c.peer.floor === ROOF) : undefined;
    const coworkDesk = /^desk-seat-\d+:0$/.test(key);
    const closeEnough = place && Math.hypot(place.x - c.peer.x, place.z - c.peer.z) <= 4;
    const seat = place && (!coworkDesk || (c.peer.floor === LOBBY && closeEnough)) ? key : undefined;
    if (seat === c.peer.seat) return;
    // Somebody on the floor got there first (two people arriving at an empty throne at once).
    // (Not yourself, on a connection that hasn't timed out yet after a reconnect.)
    const same = (o: typeof c) => o.peer.name === c.peer.name || (!!o.accountId && o.accountId === c.accountId);
    const there = seat && [...ctx.clients.values()].find((o) => o !== c && !same(o) && o.peer.seat === seat && o.peer.floor === c.peer.floor);
    const claimedBy = c.peer.floor === LOBBY && seat ? cowork.claims.get(seat) : undefined;
    if (there || (claimedBy && claimedBy !== c.id)) {
      const owner = claimedBy ? cowork.participants.get(claimedBy)?.name : undefined;
      const personThere = there ? there.peer.name : undefined;
      ctx.sendTo(c, { t: 'sit.refused', seat: key, by: personThere ?? owner ?? 'someone' });
      return;
    }
    if (seat) {
      c.peer.seat = seat;
      c.peer.x = place!.x;
      c.peer.y = place!.y;
      c.peer.z = place!.z;
      c.peer.rotY = place!.rotY;
      c.peer.moving = false;
    }
    else delete c.peer.seat;
    if (c.peer.floor === LOBBY) {
      if (seat) cowork.claim(c.id, c.peer.name, seat);
      else cowork.release(c.id);
      const participant = cowork.upsert(c.id, c.peer.name);
      participant.seat = seat;
      participant.zone = coworkZoneAt(c.peer.x);
      participant.guest = isGuestClient(c);
      const update = { t: 'cowork.update' as const, participant };
      const state = { t: 'cowork.state' as const, state: cowork.snapshot('@lobby') };
      ctx.toNeighbors(c, update);
      ctx.sendTo(c, update);
      ctx.toNeighbors(c, state);
      ctx.sendTo(c, state);
    }
    ctx.broadcast({ t: 'peer.update', peer: c.peer }, c.id);
  },
  carry(ctx, c, msg) {
    // Everyone on the floor sees the issue card in their hands, and whoever comes in later too.
    const issue = issueNumber(msg.issue);
    if (issue === c.peer.carrying?.issue) return;
    if (issue !== undefined) c.peer.carrying = { issue, title: str(msg.title, 200) };
    else delete c.peer.carrying;
    ctx.broadcast({ t: 'peer.update', peer: c.peer }, c.id);
  },
  profile(ctx, c, msg) {
    const name = str(msg.name, 24).trim();
    if (name && !c.accountId) c.peer.name = name;
    if (COLOR_RE.test(msg.color)) c.peer.color = msg.color;
    c.peer.look = sanitizeLook(msg.look, c.peer.look);
    ctx.broadcast({ t: 'peer.update', peer: c.peer });
  },
  voice(ctx, c, msg) {
    c.peer.voice = isGuestMuted(c) ? false : !!msg.voice;
    c.peer.muted = isGuestMuted(c) || !!msg.muted;
    c.peer.sharing = isGuestClient(c) ? false : !!msg.sharing;
    ctx.broadcast({ t: 'peer.update', peer: c.peer });
    if (c.peer.floor === LOBBY) {
      const lobby = coworkLobbyFor(ctx);
      const participant = lobby.upsert(c.id, c.peer.name);
      participant.muted = c.peer.muted;
      participant.guest = isGuestClient(c);
      participant.zone = coworkZoneAt(c.peer.x);
      participant.seat = c.peer.seat;
      const update = { t: 'cowork.update' as const, participant };
      ctx.toNeighbors(c, update);
      ctx.sendTo(c, update);
    }
  },
  rtc(ctx, c, msg) {
    const target = ctx.clients.get(str(msg.to, 32));
    if (target && target.peer.floor === c.peer.floor && !(isGuestClient(c) && isGuestMuted(c))) ctx.sendTo(target, { t: 'rtc', from: c.id, data: msg.data });
  },
  chat(ctx, c, msg) {
    const who = c.peer.name;
    const text = str(msg.text, 500).trim();
    if (!text) return;
    const line: ChatLine = { from: c.id, name: who, color: c.peer.color, text, at: Date.now(), ...(c.accountId ? { account: true } : {}), ...(c.peer.floor ? { floor: c.peer.floor } : {}) };
    ctx.chat.add(line);
    ctx.broadcast({ t: 'chat', ...line });
  },
  doing(ctx, c, msg) {
    const what = str(msg.what, 60).trim() || undefined;
    const reading = msg.reading === true || undefined;
    if (what === c.peer.doing && reading === c.peer.reading) return;
    if (what) c.peer.doing = what;
    else delete c.peer.doing;
    if (reading) c.peer.reading = true;
    else delete c.peer.reading;
    ctx.broadcast({ t: 'peer.update', peer: c.peer });
  },
  ping(ctx, c, msg) {
    ctx.sendTo(c, { t: 'pong', at: num(msg.at), now: Date.now() });
  },
} satisfies HandlerMap<PresenceClientMsg>;
