import type { CoworkParticipant, CoworkState } from '../../../shared/protocol';
import { LOBBY } from '../../../shared/coworking-space';
import type { Slice } from '../store';

declare module '../store' {
  interface Store { coworking: CoworkState }
  interface Topics { coworking: true }
}

const empty: CoworkState = { lobbyId: LOBBY, participants: [], claims: [] };

export const coworking: Slice = {
  init(s) { s.coworking = empty; },
  on: {
    'cowork.state'(s, m) { s.coworking = m.state; return ['coworking']; },
    'cowork.update'(s, m) {
      const participants = s.coworking.participants.filter((p) => p.peerId !== m.participant.peerId);
      participants.push(m.participant);
      const claims = s.coworking.claims.filter((c) => c.peerId !== m.participant.peerId && c.seat !== m.participant.seat);
      if (m.participant.seat) claims.push({ seat: m.participant.seat, peerId: m.participant.peerId, name: m.participant.name });
      s.coworking = { ...s.coworking, participants, claims };
      return ['coworking'];
    },
    'cowork.remove'(s, m) {
      s.coworking = { ...s.coworking, participants: s.coworking.participants.filter((p) => p.peerId !== m.peerId), claims: s.coworking.claims.filter((c) => c.peerId !== m.peerId) };
      return ['coworking'];
    },
  },
};
