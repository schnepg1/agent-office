import { store } from '../state';
import { LOBBY } from '../../shared/coworking-space';

/** Guest state is sent in whoami and the welcome; authorization remains enforced by the server. */
export { LOBBY };
export const isGuest = () => store.me.role === 'guest';
export const isSocialLobby = () => store.floor === LOBBY || !!store.me.lobbyOnly || (isGuest() && !store.project);
/** Controls that spawn, inspect, or change project workers and tools stay out of the lobby. */
export const canUseProjectTools = () => !isGuest() && !isSocialLobby() && !!store.project;
