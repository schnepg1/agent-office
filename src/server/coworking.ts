import type { CoworkClaim, CoworkParticipant, CoworkState, CoworkZone } from '../shared/protocol.js';
import type { Ctx } from './office/context.js';

/** In-memory social state: bounded to online participants and reset on restart. */
export class CoworkLobby {
  readonly participants = new Map<string, CoworkParticipant>();
  readonly claims = new Map<string, string>();

  claim(peerId: string, name: string, seat: string): boolean {
    const owner = this.claims.get(seat);
    if (owner && owner !== peerId) return false;
    for (const [key, id] of this.claims) if (id === peerId && key !== seat) this.claims.delete(key);
    this.claims.set(seat, peerId);
    const p = this.participants.get(peerId) ?? this.upsert(peerId, name);
    p.seat = seat;
    return true;
  }

  release(peerId: string): void {
    for (const [seat, id] of this.claims) if (id === peerId) this.claims.delete(seat);
    const p = this.participants.get(peerId);
    if (p) delete p.seat;
  }

  upsert(peerId: string, name: string): CoworkParticipant {
    let p = this.participants.get(peerId);
    if (!p) {
      p = { peerId, name, zone: 'talk', muted: false };
      this.participants.set(peerId, p);
    } else p.name = name;
    return p;
  }

  profile(peerId: string, values: { name: string; intention?: string; status?: string; zone?: CoworkZone }): CoworkParticipant {
    const p = this.upsert(peerId, values.name);
    if (values.intention !== undefined) p.intention = values.intention || undefined;
    if (values.status !== undefined) p.status = values.status || undefined;
    if (values.zone !== undefined) p.zone = values.zone;
    return p;
  }

  remove(peerId: string): void {
    this.release(peerId);
    this.participants.delete(peerId);
  }

  snapshot(lobbyId: string, online?: ReadonlySet<string>): CoworkState {
    const participants = [...this.participants.values()].filter((p) => !online || online.has(p.peerId));
    const names = new Map(participants.map((p) => [p.peerId, p.name]));
    const claims: CoworkClaim[] = [...this.claims].filter(([, peerId]) => names.has(peerId)).map(([seat, peerId]) => ({ seat, peerId, name: names.get(peerId) ?? '' }));
    return { lobbyId, participants, claims };
  }
}

const lobbies = new WeakMap<Ctx, CoworkLobby>();
export function coworkLobbyFor(ctx: Ctx): CoworkLobby {
  let lobby = lobbies.get(ctx);
  if (!lobby) lobbies.set(ctx, (lobby = new CoworkLobby()));
  return lobby;
}
