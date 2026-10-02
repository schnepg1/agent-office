import './guest-invites.css';
import type { FloorInfo } from '../../shared/protocol';
import { store } from '../state';
import { h, openModal, toast } from './dom';
import { copyButton } from './team';
import { LOBBY } from '../shared/guest';

interface Invitation {
  id: string;
  name?: string;
  floorIds: string[];
  uses?: number;
  expiresAt?: number;
  createdAt?: number;
}

const guestLink = (token: string) => `${location.origin}/guest#token=${encodeURIComponent(token)}`;
const dateLabel = (at?: number) => (at ? new Date(at).toLocaleString() : 'Never expires');

/** Admin-only, short-lived viewing links for guests. Link tokens are only shown on creation. */
export function openGuestInvites() {
  const body = h('div.body.guest-invites');
  const floors = store.floors.filter((floor) => floor.id !== LOBBY && !floor.cloning);
  const checked = new Set<string>();
  const checkboxes = floors.map((floor) => {
    const input = h('input', { type: 'checkbox', value: floor.id, 'aria-label': floor.name }) as HTMLInputElement;
    input.addEventListener('change', () => input.checked ? checked.add(floor.id) : checked.delete(floor.id));
    return h('label.guest-floor', {}, input, h('span', {}, floor.name));
  });
  const nameInput = h('input', { type: 'text', maxlength: 24, placeholder: 'Invitation label (optional)', 'aria-label': 'Invitation label', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const useSelect = h('select', { 'aria-label': 'How many times the link can be used' }, h('option', { value: '1' }, 'One visit'), h('option', { value: '' }, 'Reusable link')) as HTMLSelectElement;
  const expiry = h('select', { 'aria-label': 'Invitation expiry' }, h('option', { value: '86400000' }, 'Expires in 1 day'), h('option', { value: '604800000', selected: true }, 'Expires in 7 days'), h('option', { value: '2592000000' }, 'Expires in 30 days')) as HTMLSelectElement;
  const submit = h('button.btn.primary', { type: 'submit' }, 'Create guest link');
  const form = h('form.guest-form', {},
    h('label', {}, 'Invitation label (optional)', nameInput),
    h('label', {}, 'Link use', useSelect),
    h('label', {}, 'Expiry', expiry),
    h('fieldset', {}, h('legend', {}, 'Project floors they can view (optional)'), ...checkboxes),
    submit,
  ) as HTMLFormElement;
  const status = h('p.guest-status', { role: 'status', 'aria-live': 'polite' });
  const fresh = h('div.guest-fresh');
  const list = h('ul.team-list');
  const el = h('div.modal.guest-invites-modal', { role: 'dialog', 'aria-label': 'Guest invitations' }, h('header', {}, h('h2', {}, '🔗 Guest invitations')), body);
  body.append(
    h('p.note', {}, 'Guests can see the floors you select. Leave every floor unchecked to invite someone to the lobby only. They can join conversations and walk around, but cannot use workers or change the office.'),
    form,
    status, fresh,
    h('h4', {}, 'Open invitations'), list,
  );

  let invitations: Invitation[] = [];
  const floorNames = new Map(floors.map((floor) => [floor.id, floor.name]));
  const renderList = () => {
    list.replaceChildren(...(invitations.length ? invitations.map((invitation) => {
      const revoke = h('button.btn', { type: 'button', title: 'Stop this invitation from working' }, 'Revoke');
      revoke.addEventListener('click', () => void remove(invitation.id));
      return h('li', {},
        h('span.name', {}, invitation.name || 'Anyone with the link'),
        h('span.keys', {}, `${invitation.uses === 1 ? 'one visit' : 'reusable'} · ${dateLabel(invitation.expiresAt)}`),
        h('span.keys', {}, invitation.floorIds.length ? invitation.floorIds.map((id) => floorNames.get(id) ?? id).join(', ') : 'Lobby only'),
        revoke,
      );
    }) : [h('li.empty', {}, 'No open guest invitations')]));
  };
  const refresh = async () => {
    try {
      const response = await fetch('/api/guest/invitations', { cache: 'no-store' });
      const result = (await response.json()) as { invitations?: Invitation[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not load invitations');
      invitations = result.invitations ?? [];
      renderList();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Could not load invitations';
    }
  };
  const remove = async (id: string) => {
    try {
      const response = await fetch(`/api/guest/invitations/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not revoke invitation');
      invitations = invitations.filter((invitation) => invitation.id !== id);
      renderList();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not revoke invitation', 'error');
    }
  };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = 'Creating link…';
    fresh.replaceChildren();
    try {
      const duration = Number(expiry.value);
      const payload = {
        name: nameInput.value.trim() || undefined,
        floorIds: floors.filter((floor: FloorInfo) => checked.has(floor.id)).map((floor) => floor.id),
        uses: useSelect.value ? Number(useSelect.value) : undefined,
        expiresAt: Date.now() + duration,
      };
      const response = await fetch('/api/guest/invitations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { token?: string; invitation?: Invitation; error?: string };
      if (!response.ok || !result.token || !result.invitation) throw new Error(result.error ?? 'Could not create invitation');
      const link = guestLink(result.token);
      status.textContent = 'Guest link created. Copy it now; the full link is only shown once.';
      fresh.append(h('div.cmd', {}, h('pre', {}, link), copyButton('Copy guest link', () => link, 'primary')));
      invitations.unshift(result.invitation);
      renderList();
      nameInput.value = '';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Could not create invitation';
    } finally {
      submit.disabled = false;
    }
  });
  const unsub = store.on('floors', () => {
    // The current selection is intentionally scoped to the floors offered when the panel opened.
    void refresh();
  });
  const modal = openModal(el, { onClose: () => unsub() });
  void modal;
  void refresh();
}
