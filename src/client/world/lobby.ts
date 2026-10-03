import * as THREE from 'three';
import { NavGrid } from '../../shared/nav';
import type { MapPlan } from '../../shared/maps';
import { mesh, roundedBox, textPlane, toon } from './toon';
import { chair } from './office/seats';
import type { Collider, Interactable } from './types';
import type { World } from './world';

/** A social world with human chairs and no project boards, hiring targets or worker seats. */
export function buildLobby(plan: MapPlan): World {
  const group = new THREE.Group();
  group.name = 'coworking-lobby';
  const interactables: Interactable[] = [];
  const colliders: Collider[] = [];
  group.add(mesh(new THREE.BoxGeometry(24, 0.2, 18), toon('#e8dfd0'), 0, -0.1, 0));
  const quiet = mesh(new THREE.BoxGeometry(13.8, 0.015, 17.5), toon('#c9ded8'), -4.9, 0.012, 0);
  const talk = mesh(new THREE.BoxGeometry(9.8, 0.015, 17.5), toon('#ead5b5'), 7, 0.012, 0);
  group.add(quiet, talk);
  for (const [x, z, w, d] of [[-12, 0, 0.2, 18], [12, 0, 0.2, 18], [0, -9, 24, 0.2], [0, 9, 24, 0.2]]) {
    group.add(mesh(new THREE.BoxGeometry(w, 2.7, d), toon('#f4efe7'), x, 1.35, z));
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: 2.7 });
  }
  for (const seat of plan.seating) {
    const deskZ = seat.z - 0.9;
    group.add(mesh(roundedBox(2, 0.12, 1.2), toon('#b89470'), seat.x, 0.78, deskZ));
    for (const dx of [-0.8, 0.8]) group.add(mesh(new THREE.BoxGeometry(0.08, 0.72, 0.7), toon('#667b79'), seat.x + dx, 0.36, deskZ));
    colliders.push({ minX: seat.x - 1, maxX: seat.x + 1, minZ: deskZ - 0.6, maxZ: deskZ + 0.6, top: 0.84 });
    const ch = chair(seat.x < 2 ? '#5e9c8b' : '#c69257');
    ch.position.set(seat.x, 0, seat.z);
    const it: Interactable = { kind: 'seat', seatId: seat.id, x: seat.x, y: 0, z: seat.z, radius: 0.7 };
    ch.userData.interact = it;
    interactables.push(it); group.add(ch);
    const label = textPlane(seat.label, { size: 32 }); label.position.set(seat.x, 1.12, deskZ); group.add(label);
  }
  for (const [label, x] of [['Quiet desks', -6], ['Talk cafe', 6]] as const) {
    const sign = textPlane(label, { size: 72 }); sign.position.set(x, 2.1, -8.8); group.add(sign);
  }
  const entry = textPlane('Coworking lobby · choose a floor from the menu', { size: 38 });
  entry.position.set(0, 2.2, 8.8); entry.rotation.y = Math.PI; group.add(entry);
  return {
    plan, group, colliders, interactables, pickables: [group], desks: new Map(), boardMeshes: {},
    nav: new NavGrid(plan.bounds, plan.obstacles!), ways: { home: () => ({ way: [], chute: false }), in: () => [] },
    rain: [], device: 'laptop', room: { wall: 0.2, enclosed: true },
    acoustics: { gong: null, windows: [] }, setBeanbags: () => [], setLook() {}, setProjectName() {}, update() {},
  };
}
