/** The shared lobby's desk claims, intentions, host guest controls and quiet/talk zone voice mix. */
import { coworkVolumeFor, coworkZoneAt } from '../../../shared/coworking';
import { LOBBY } from '../../../shared/coworking-space';
import { seatPlace } from '../../../shared/layout';
import type { CoworkParticipant } from '../../../shared/protocol';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { $, h, openModal, toast } from '../../ui/dom';
import './ui.css';

const lobby = () => store.floor === LOBBY;

function seatName(seat?: string): string {
  const n = seat?.match(/^desk-seat-(\d+):0$/)?.[1];
  return n ? `Desk ${n}` : seat ?? '';
}

export function installCoworking(ctx: Ctx, seating: { sitAt(seatId: string): void; standUp(): void }) {
  const myParticipant = () => store.coworking.participants.find((p) => p.peerId === store.you);
  let modal: ReturnType<typeof openModal> | undefined;
  let list: HTMLElement | undefined;
  let quietAutoMute = false;
  let restoreMute = false;
  let changingForZone = false;
  let hostForcedMute = false;
  let zoneBadge: HTMLButtonElement | undefined;

  function memberRow(p: CoworkParticipant): HTMLElement {
    const mine = p.peerId === store.you;
    const intent = p.intention ? h('p.cowork-intention', {}, `Working on: ${p.intention}`) : null;
    const status = p.status ? h('span.cowork-status', {}, p.status) : null;
    const controls: HTMLElement[] = [];
    if (!mine && store.me.admin && p.guest) {
      controls.push(h('button.btn.subtle', { type: 'button', onclick: () => ctx.net.send({ t: 'cowork.moderate', peerId: p.peerId, action: p.muted ? 'unmute' : 'mute' }) }, p.muted ? 'Unmute' : 'Mute'));
      controls.push(h('button.btn.danger', { type: 'button', onclick: () => ctx.net.send({ t: 'cowork.moderate', peerId: p.peerId, action: 'kick' }) }, 'Remove'));
    }
    return h('article.cowork-person', {},
      h('div.cowork-person-head', {}, h('strong', {}, p.name), h('span.cowork-badges', {},
        h('span.cowork-zone', {}, p.zone === 'quiet' ? 'Quiet room' : 'Talk café'),
        p.seat ? h('span.cowork-seat', {}, seatName(p.seat)) : null,
        status,
        p.muted ? h('span.cowork-muted', {}, 'Muted') : null,
      )),
      intent,
      mine ? h('small', {}, 'You') : null,
      controls.length ? h('div.cowork-actions', {}, ...controls) : null,
    );
  }

  function refreshList() {
    if (!list) return;
    const people = store.coworking.participants;
    list.replaceChildren(...people.map(memberRow));
    if (!people.length) list.append(h('p.cowork-empty', {}, 'You are first in the lobby. Share an invite to bring someone in.'));
  }

  function syncQuietMute() {
    const quiet = lobby() && coworkZoneAt(ctx.player.pos.x) === 'quiet';
    if (hostForcedMute) return;
    if (quiet && ctx.voice.inVoice && !ctx.voice.muted) {
      restoreMute = false;
      quietAutoMute = true;
      changingForZone = true;
      ctx.voice.setMuted(true);
      changingForZone = false;
    } else if (!quiet && quietAutoMute) {
      quietAutoMute = false;
      changingForZone = true;
      ctx.voice.setMuted(restoreMute);
      changingForZone = false;
    }
  }

  function updateZoneBadge() {
    if (!zoneBadge) return;
    const zone = coworkZoneAt(ctx.player.pos.x);
    zoneBadge.hidden = !lobby();
    zoneBadge.textContent = `${zone === 'quiet' ? 'Quiet desks' : 'Talk café'}${zone === 'quiet' && ctx.voice.inVoice ? ' · mic muted' : ''} · Y`;
    zoneBadge.setAttribute('aria-label', `${zone === 'quiet' ? 'Quiet desk zone' : 'Talk café zone'}; press Y to open coworking`);
  }

  function guestIsHostMuted(): boolean {
    const me = store.me as typeof store.me & { role?: string; guest?: { muted?: boolean } };
    return me.role === 'guest' && me.guest?.muted === true;
  }

  function show() {
    if (!lobby()) return;
    if (modal) return;
    ctx.net.send({ t: 'cowork.sync' });
    const mine = myParticipant();
    const intention = h('input', { maxlength: 120, placeholder: 'What are you working on?', value: mine?.intention ?? '', 'aria-label': 'Work intention' }) as HTMLInputElement;
    const status = h('input', { maxlength: 60, placeholder: 'Status, e.g. heads down', value: mine?.status ?? '', 'aria-label': 'Status' }) as HTMLInputElement;
    const seat = h('select', { 'aria-label': 'Desk chair' }, h('option', { value: '' }, 'Choose an open desk chair…')) as HTMLSelectElement;
    const plan = ctx.plan();
    for (const def of plan.seating.filter((s) => s.id.startsWith('desk-seat-'))) {
      const key = `${def.id}:0`;
      const at = seatPlace(def, 0);
      if (Math.hypot(at.x - ctx.player.pos.x, at.z - ctx.player.pos.z) > 4) continue;
      const occupant = store.coworking.claims.find((c) => c.seat === key);
      if (!occupant || occupant.peerId === store.you) seat.append(h('option', { value: key, selected: mine?.seat === key }, `Desk ${def.id.slice('desk-seat-'.length)}${occupant ? ' · yours' : ''}`));
    }
    const save = h('button.btn', { type: 'button', onclick: () => {
      ctx.net.send({ t: 'cowork.profile', intention: intention.value, status: status.value });
    } }, 'Save profile');
    const claim = h('button.btn', { type: 'button', onclick: () => {
      if (!seat.value) return;
      const seatId = seat.value.slice(0, -2);
      const def = plan.seatingById.get(seatId);
      if (!def) return;
      const at = seatPlace(def, 0);
      ctx.net.send({ t: 'move', x: at.x, y: at.y, z: at.z, rotY: at.rotY, moving: false });
      seating.sitAt(seatId);
    } }, 'Sit and claim');
    const release = h('button.btn.subtle', { type: 'button', onclick: () => seating.standUp() }, 'Stand up');
    list = h('div.cowork-people');
    refreshList();
    const content = h('section.cowork-window', { role: 'dialog', 'aria-label': 'Coworking lobby' },
      h('header', {}, h('div', {}, h('h2', {}, 'Coworking lobby'), h('p', {}, 'Claim a real desk chair, set your intention and find your people.'))),
      h('div.cowork-layout', {},
        h('section.cowork-editor', {},
          h('h3', {}, 'Your work'),
          h('label', {}, 'Intention', intention),
          h('label', {}, 'Status', status),
          h('div.cowork-zone-info', {}, h('strong', {}, mine?.zone === 'talk' ? 'Talk café' : 'Quiet desks'), h('span', {}, 'Your area follows where you are in the lobby.')),
          h('div.cowork-form-actions', {}, save),
          h('h3', {}, 'Desk chair'),
          h('p.cowork-note', {}, 'These are the visible chairs at the room’s built-in desks. Walk to a chair or sit here to claim it.'),
          seat,
          h('div.cowork-form-actions', {}, claim, release),
          h('p.cowork-note', {}, 'Quiet is on the west workstation side; the talk café is east by the lounge. Audio stays peer-to-peer and still uses the same WebRTC connections.'),
        ),
        h('section.cowork-roster', {}, h('h3', {}, `People here · ${store.coworking.participants.length}`), list),
      ),
    );
    modal = openModal(content, { onClose: () => { modal = undefined; list = undefined; } });
    intention.focus();
  }

  ctx.keys.bind({ code: 'KeyY', when: lobby, repeat: false, run: () => { show(); } });
  ctx.messages.on('welcome', () => {
    hostForcedMute = guestIsHostMuted();
    if (hostForcedMute) ctx.voice.setMuted(true);
    updateZoneBadge();
    if (lobby()) ctx.net.send({ t: 'cowork.sync' });
  });
  ctx.messages.on('floor.enter', (m) => {
    updateZoneBadge();
    if (m.floor === LOBBY) ctx.net.send({ t: 'cowork.sync' });
  });
  ctx.messages.on('me', (m) => {
    const me = m.me as typeof m.me & { role?: string; guest?: { muted?: boolean } };
    hostForcedMute = me.role === 'guest' && me.guest?.muted === true;
    if (hostForcedMute) ctx.voice.setMuted(true);
  });
  ctx.messages.on('cowork.state', () => { refreshList(); syncQuietMute(); });
  ctx.messages.on('cowork.update', () => { refreshList(); syncQuietMute(); });
  ctx.messages.on('cowork.remove', refreshList);
  ctx.messages.on('cowork.refused', (m) => toast(m.text, 'warn'));
  ctx.messages.on('cowork.forceMute', (m) => {
    hostForcedMute = m.muted;
    if (m.muted) ctx.voice.setMuted(true);
  });
  ctx.messages.on('cowork.saved', () => toast('Your lobby profile is updated.'));
  ctx.messages.on('peer.update', () => {
    // Keep guest host controls and their voice-zone tag current when presence changes.
    if (modal) refreshList();
  });
  store.on('coworking', () => { refreshList(); syncQuietMute(); updateZoneBadge(); });
  ctx.voice.onChange(() => {
    if (changingForZone) return;
    if (hostForcedMute && !ctx.voice.muted) {
      changingForZone = true;
      ctx.voice.setMuted(true);
      changingForZone = false;
      return;
    }
    if (!hostForcedMute && lobby() && coworkZoneAt(ctx.player.pos.x) === 'quiet' && !ctx.voice.muted) {
      restoreMute = false;
      quietAutoMute = true;
      changingForZone = true;
      ctx.voice.setMuted(true);
      changingForZone = false;
    } else if (!quietAutoMute) restoreMute = ctx.voice.muted;
  });

  ctx.ticks.add('others', () => {
    updateZoneBadge();
    if (!lobby()) return;
    syncQuietMute();
    const listenerZone = coworkZoneAt(ctx.player.pos.x);
    for (const peer of store.peers.values()) {
      if (peer.id === store.you || peer.floor !== LOBBY || peer.lite) continue;
      const d = Math.hypot(peer.x - ctx.player.pos.x, peer.z - ctx.player.pos.z);
      const proximity = d < 4 ? 1 : Math.max(0.2, 1 - (d - 4) / 16);
      const volume = coworkVolumeFor(listenerZone, coworkZoneAt(peer.x), peer.voice, peer.muted, proximity);
      ctx.voice.setVolume(peer.id, volume);
    }
  });
  zoneBadge = h('button.cowork-zone-badge', { type: 'button', onclick: show, hidden: true });
  $('hud').append(zoneBadge);
  updateZoneBadge();
  return { show };
}
