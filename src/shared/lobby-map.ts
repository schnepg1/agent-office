import type { SeatDef } from './layout.js';
import type { MapPlan } from './maps/index.js';
import { LOBBY } from './coworking-space.js';

export const LOBBY_MAP = 'coworking-lobby';
/** Human seating belongs to this space; project worker seats keep their existing layout. */
const seating: SeatDef[] = [-8, -4, 4, 8].flatMap((x, column) => [-4, 1].map((z, row) => ({
  id: `desk-seat-${column * 2 + row + 1}`, label: `${x < 0 ? 'Quiet' : 'Cafe'} desk ${column * 2 + row + 1}`,
  x, y: 0, z: z + 0.9, rotY: Math.PI, places: [0], hips: 0.4, depth: 0, out: 0.85,
})));

export const LOBBY_PLAN: MapPlan = {
  id: LOBBY_MAP, name: 'Coworking lobby', icon: '☕', description: 'Quiet desks and a conversation cafe.', style: 'lobby',
  bounds: { minX: -12, maxX: 12, minZ: -9, maxZ: 9 }, height: 4,
  spawn: { x: 0, y: 0, z: 6, rotY: Math.PI }, door: { x: 0, z: 8 },
  desks: [], overflow: [], stations: [], meeting: [], byId: new Map(),
  seating, seatingById: new Map(seating.map(s => [s.id, s])),
  lineup: [], tables: [], boards: {}, agents: { outfit: 'none', ageMinutes: 0 },
  obstacles: { rects: seating.map(s => [s.x - 1, s.x + 1, s.z - 1.5, s.z - 0.3]), circles: [] },
};

/** The server and browser resolve the same layout without changing the building's map setting. */
export const planForSpace = (space: string | null | undefined, projectMap: MapPlan): MapPlan => space === LOBBY ? LOBBY_PLAN : projectMap;

export const LOBBY_ZONES = [
  { id: 'quiet' as const, name: 'Quiet desks', bounds: { minX: -12, maxX: 2, minZ: -9, maxZ: 9 } },
  { id: 'talk' as const, name: 'Talk cafe', bounds: { minX: 2, maxX: 12, minZ: -9, maxZ: 9 } },
];
