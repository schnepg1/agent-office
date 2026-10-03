import type { MapState } from '../../../shared/protocol';
import { OFFICE_MAP, planOf, type MapPlan } from '../../../shared/maps';
import { planForSpace } from '../../../shared/lobby-map';
import { LOBBY } from '../../../shared/coworking-space';
import type { Slice, Store } from '../store';

// Arrival loads its map before the floor's state, preserving the store's existing topic order.
const arrivingSpaces = new WeakMap<Store, string | null>();

declare module '../store' {
  interface Store {
    /** What the building looks like inside (see shared/maps): the same on every floor. */
    map: MapState;
    /** Where everything is on the building's map. */
    plan(): MapPlan;
  }
  interface Topics {
    map: true;
  }
}

export const map: Slice = {
  init(s) {
    s.map = { pick: OFFICE_MAP, custom: [] };
  },
  methods: {
    plan() {
      const space = arrivingSpaces.has(this) ? arrivingSpaces.get(this) : this.floor;
      return planForSpace(space, planOf(this.map.pick, this.map.custom));
    },
  },
  // The map first, so the floor's workers sit down in its seats and not the last one's.
  beforeFloor: true,
  on: {
    welcome(s, m) {
      arrivingSpaces.set(s, m.floor);
      s.map = m.map ?? { pick: OFFICE_MAP, custom: [] };
      return ['map'];
    },
    'floor.enter'(s, m) {
      arrivingSpaces.set(s, m.floor);
      return ['map'];
    },
    map(s, m) {
      // Onto another map: nobody's on a seat of the last one any more (the office forgot them too).
      const moved = s.floor !== LOBBY && m.state.pick !== s.map.pick;
      s.map = m.state;
      if (moved) for (const p of s.peers.values()) delete p.seat;
      return moved ? ['map', 'peers'] : ['map'];
    },
  },
  enter(s) { arrivingSpaces.delete(s); },
};
