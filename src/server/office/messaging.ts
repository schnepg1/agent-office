import { WebSocket } from 'ws';
import type { Ctx, Messaging, ToastLevel } from './context.js';
import type { Client } from './client.js';
import type { Floor } from '../floor.js';
import type { ServerMsg } from '../../shared/protocol.js';
import { createGuestVisibility } from '../guests/visibility.js';

/** Sending to the browsers in `ctx.clients`: one, everyone, a floor, or someone's neighbors. */
export function messaging(ctx: Ctx): Messaging {
  const forGuest = createGuestVisibility(ctx);
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
