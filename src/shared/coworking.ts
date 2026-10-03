import type { CoworkZone } from './protocol/coworking.js';
import { LOBBY_ZONES } from './lobby-map.js';

/** Quiet rooms are heard only by people in the quiet zone; the talk room is heard by talk-room peers. */
export function zoneVolume(listener: CoworkZone, speaker: CoworkZone, proximity: number): number {
  if (listener !== speaker) return 0;
  return Math.max(0, Math.min(1, proximity));
}

export function coworkVolumeFor(listener: CoworkZone, speaker: CoworkZone, speaking: boolean, muted: boolean, proximity: number): number {
  return speaking && !muted ? zoneVolume(listener, speaker, proximity) : 0;
}

/** The left workstation pods are quiet; the lounge and cafe on the east side are talk spaces. */
export function coworkZoneAt(x: number): CoworkZone {
  return LOBBY_ZONES.find(zone => x >= zone.bounds.minX && x < zone.bounds.maxX)?.id ?? 'talk';
}

export function isCoworkZone(value: unknown): value is CoworkZone {
  return value === 'quiet' || value === 'talk';
}

export function canModerateCoworking(admin: boolean, targetIsGuest: boolean, targetId: string, actorId: string): boolean {
  return admin && targetIsGuest && !!targetId && targetId !== actorId;
}
