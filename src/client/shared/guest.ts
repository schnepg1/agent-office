import { store } from '../state';

type GuestMe = { role?: string; guest?: { name: string; floorIds: string[] } };
type LobbyMe = { lobbyOnly?: boolean };

/** Guest state is sent in whoami and the welcome; authorization remains enforced by the server. */
export const isGuest = () => (store.me as typeof store.me & GuestMe).role === 'guest';
export const GUEST_LOBBY = '@lobby';
export const isSocialLobby = () => store.floor === GUEST_LOBBY || !!(store.me as typeof store.me & LobbyMe).lobbyOnly || (isGuest() && !store.project);
/** Controls that spawn, inspect, or change project workers and tools stay out of the lobby. */
export const canUseProjectTools = () => !isGuest() && !isSocialLobby() && !!store.project;
