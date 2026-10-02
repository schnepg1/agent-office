import { store } from '../state';

type GuestMe = { role?: string; guest?: { name: string; floorIds: string[] } };

/** Guest state is sent in whoami and the welcome; authorization remains enforced by the server. */
export const isGuest = () => (store.me as typeof store.me & GuestMe).role === 'guest';
export const GUEST_LOBBY = '@lobby';
