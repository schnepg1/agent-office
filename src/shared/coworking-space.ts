/** The project-independent shared room. It is never a project Floor. */
export const LOBBY = '@lobby';

/** A guest can always see the lobby and may have read access to named project floors. */
export interface GuestAccess {
  lobby: true;
  floorIds: string[];
}

export interface GuestInfo extends GuestAccess {
  name: string;
  /** Set only by host moderation; independent of a guest's browser mute setting. */
  muted?: boolean;
}

export interface GuestInvitationInfo {
  id: string;
  name?: string;
  floorIds: string[];
  /** null means reusable until its expiry or revocation. */
  uses: number | null;
  usesLeft: number | null;
  expiresAt: number;
}
