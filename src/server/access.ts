import { LOBBY } from '../shared/coworking-space.js';
import type { Client } from './office/client.js';

export const isGuestClient = (c: Client): boolean => !!c.guestId;

/** Lobby is always visible; project view requires a matching invitation scope. */
export function canGuestViewFloor(c: Client, floorId: string): boolean {
  return isGuestClient(c) && (floorId === LOBBY || !!c.guestFloorIds?.includes(floorId));
}

/** Public invitations never grant floor actions. Safe social actions use their own explicit allowlist. */
export function canGuestActOnFloor(_c: Client, _floorId: string, _action: string): boolean {
  return false;
}

/** Only a host can leave a guest muted; a guest's packet cannot clear this server-side flag. */
export function setGuestMuted(c: Client, muted: boolean): void {
  if (!isGuestClient(c)) return;
  c.guestMuted = muted;
  c.setGuestMuted?.(muted);
  if (muted) {
    c.peer.voice = false;
    c.peer.muted = true;
    c.peer.sharing = false;
  }
}

export const isGuestMuted = (c: Client): boolean => !!c.guestMuted;

/** Revokes the guest registry session before closing its current socket. */
export function revokeGuestSession(c: Client): void {
  if (!isGuestClient(c)) return;
  c.revokeGuestSession?.();
  c.out = true;
  c.ws.close(4003, 'Guest access revoked');
}
