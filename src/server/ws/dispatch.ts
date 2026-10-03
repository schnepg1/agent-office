import type { ClientMsg } from '../../shared/protocol.js';
import type { Ctx } from '../office/context.js';
import type { Client } from '../office/client.js';
import { handlers } from './handlers/index.js';
import { isGuestClient } from '../access.js';

type AnyHandler = (ctx: Ctx, c: Client, msg: ClientMsg) => void;

/**
 * Hands a message to the handler for its type. Only a string that is one of the map's own keys is
 * a type, so a message that says it's a `constructor` or a `__proto__` goes nowhere, like one of a
 * type nobody handles, and so does one whose type only turns into a key (`['ping']`).
 */
export function dispatch(ctx: Ctx, c: Client, msg: ClientMsg): void {
  if (c.out || !ctx.stillIn(c)) { ctx.signOut(c); return; }
  if (c.guestId) {
    const session = ctx.guests.session(c.guestId);
    c.guestMuted = session?.muted;
    if (c.guestMuted) { c.peer.voice = false; c.peer.muted = true; c.peer.sharing = false; }
  }
  if (typeof msg.t !== 'string' || !Object.hasOwn(handlers, msg.t)) {
    if (isGuestClient(c)) ctx.warn(c, 'That action is not available to guests');
    return;
  }
  if (isGuestClient(c)) {

    if (!GUEST_COMMANDS.has(msg.t)) { ctx.warn(c, 'That action is not available to guests'); return; }
  }
  if (ctx.cfg.lobbyOnly && !isLobbyOnlyMessage(msg.t)) return;
  (handlers[msg.t] as AnyHandler)(ctx, c, msg);
}

function isLobbyOnlyMessage(t: string): boolean {
  return t === 'move' || t === 'sit' || t === 'profile' || t === 'emote' || t === 'voice' || t === 'rtc' || t === 'ping' || t === 'chat' || t === 'doing' ||
    t === 'floor.go' || t.startsWith('cowork.');
}

const GUEST_COMMANDS = new Set(['move', 'sit', 'profile', 'emote', 'voice', 'rtc', 'ping', 'chat', 'doing', 'floor.go', 'cowork.claim', 'cowork.release', 'cowork.profile', 'cowork.sync']);
