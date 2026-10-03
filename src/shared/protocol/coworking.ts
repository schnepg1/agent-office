import type { PeerInfo } from './presence.js';

export type CoworkZone = 'quiet' | 'talk';
export interface CoworkParticipant {
  peerId: string;
  name: string;
  intention?: string;
  status?: string;
  zone: CoworkZone;
  seat?: string;
  muted: boolean;
  /** A host restriction, separate from the participant muting their own microphone. */
  hostMuted?: boolean;
  account?: boolean;
  guest?: boolean;
}
export interface CoworkClaim { seat: string; peerId: string; name: string }
export interface CoworkState { lobbyId: string; participants: CoworkParticipant[]; claims: CoworkClaim[] }

export type CoworkClientMsg =
  | { t: 'cowork.sync' }
  | { t: 'cowork.claim'; seat: string }
  | { t: 'cowork.release' }
  | { t: 'cowork.profile'; intention?: string; status?: string }
  | { t: 'cowork.moderate'; peerId: string; action: 'mute' | 'unmute' | 'kick' };
export type CoworkServerMsg =
  | { t: 'cowork.state'; state: CoworkState }
  | { t: 'cowork.update'; participant: CoworkParticipant }
  | { t: 'cowork.remove'; peerId: string }
  | { t: 'cowork.refused'; text: string }
  | { t: 'cowork.forceMute'; muted: boolean }
  | { t: 'cowork.saved' };

export function coworkParticipant(peer: PeerInfo, zone: CoworkZone, intention?: string, status?: string): CoworkParticipant {
  return { peerId: peer.id, name: peer.name, intention, status, zone, seat: peer.seat, muted: peer.muted, account: peer.account };
}
