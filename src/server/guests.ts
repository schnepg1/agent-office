import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { GuestInfo, GuestInvitationInfo } from '../shared/coworking-space.js';
import { cleanName } from './accounts.js';

const MAX_INVITES = 100;
const MAX_USES = 100;
const MAX_SESSIONS = 10_000;
const MAX_SESSIONS_PER_INVITE = 200;
const MAX_TTL = 30 * 24 * 60 * 60_000;
const DEFAULT_TTL = 24 * 60 * 60_000;
const hash = (token: string) => createHash('sha256').update(token).digest();

interface SavedInvitation {
  id: string;
  tokenHash: string;
  name?: string;
  floorIds: string[];
  uses: number | null;
  usesLeft: number | null;
  expiresAt: number;
  createdAt: number;
  createdBy: string;
}

interface Saved { invitations: SavedInvitation[] }
export interface GuestSession { id: string; inviteId: string; expiresAt: number; info: GuestInfo; muted?: boolean }
export interface NewGuestInvitation { name?: string; floorIds?: string[]; uses?: number | null; expiresAt?: number }

/** Scoped public invitations. Tokens are only returned once; only their digest is written to disk. */
export class Guests {
  private file: string;
  private stamp = '';
  private data: Saved = { invitations: [] };
  private sessions = new Map<string, GuestSession>();
  private unreadable = false;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'guest-invitations.json');
    this.sync();
  }

  create(by: string, input: NewGuestInvitation): { token: string; invitation: GuestInvitationInfo } | string {
    this.sync(); this.expire();
    if (this.unreadable) throw new Error(`Guest invitations are unavailable because ${this.file} could not be read`);
    if (this.data.invitations.length >= MAX_INVITES) return 'Too many active guest invitations';
    const name = input.name === undefined ? undefined : cleanName(input.name);
    if (input.name !== undefined && !name) return 'That name has no letters in it';
    const floorIds = Array.isArray(input.floorIds) ? [...new Set(input.floorIds.filter((v): v is string => typeof v === 'string' && /^[\w.-]{1,64}$/.test(v)))].slice(0, 100) : [];
    if (input.floorIds && floorIds.length !== input.floorIds.length) return 'One or more floor IDs are invalid';
    const uses = input.uses === undefined || input.uses === null ? null : input.uses;
    if (uses !== null && (!Number.isInteger(uses) || uses < 1 || uses > MAX_USES)) return `Uses must be from 1 to ${MAX_USES}, or omitted for reusable`;
    const now = Date.now();
    const expiresAt = input.expiresAt === undefined ? now + DEFAULT_TTL : input.expiresAt;
    if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + MAX_TTL) return 'Expiry must be within the next 30 days';
    const token = randomBytes(32).toString('base64url');
    const saved: SavedInvitation = {
      id: randomBytes(8).toString('hex'), tokenHash: hash(token).toString('hex'),
      ...(name ? { name } : {}), floorIds, uses, usesLeft: uses, expiresAt, createdAt: now, createdBy: by,
    };
    this.data.invitations.push(saved);
    try { this.save(); } catch (err) { this.data.invitations.pop(); throw err; }
    return { token, invitation: this.info(saved) };
  }

  list(): GuestInvitationInfo[] {
    this.sync(); this.expire();
    this.pruneSessions();
    return this.data.invitations.map((v) => this.info(v));
  }

  revoke(id: string): string[] | undefined {
    this.sync();
    if (this.unreadable) throw new Error(`Guest invitations are unavailable because ${this.file} could not be read`);
    const before = this.data.invitations.length;
    const previous = this.data.invitations;
    this.data.invitations = this.data.invitations.filter((v) => v.id !== id);
    if (before === this.data.invitations.length) return undefined;
    const revoked = [...this.sessions.values()].filter((s) => s.inviteId === id).map((s) => s.id);
    try { this.save(); } catch (err) { this.data.invitations = previous; throw err; }
    for (const sessionId of revoked) this.sessions.delete(sessionId);
    return revoked;
  }

  enter(token: string, requestedName: string): GuestSession | string {
    this.sync(); this.expire();
    if (!token || token.length > 128) return 'That guest invitation is invalid or expired';
    const want = hash(token);
    const invite = this.data.invitations.find((v) => {
      const got = Buffer.from(v.tokenHash, 'hex');
      return got.length === want.length && timingSafeEqual(got, want);
    });
    if (!invite || (invite.usesLeft !== null && invite.usesLeft < 1)) return 'That guest invitation is invalid or expired';
    const name = cleanName(requestedName);
    if (!name) return 'Pick a name';
    if (this.sessions.size >= MAX_SESSIONS || [...this.sessions.values()].filter((s) => s.inviteId === invite.id).length >= MAX_SESSIONS_PER_INVITE) return 'This guest invitation has reached its session limit';
    if (invite.usesLeft !== null) {
      const previousUses = invite.usesLeft;
      invite.usesLeft--;
      try { this.save(); } catch (err) { invite.usesLeft = previousUses; throw err; }
    }
    const session: GuestSession = {
      id: randomBytes(24).toString('base64url'), inviteId: invite.id, expiresAt: Math.min(invite.expiresAt, Date.now() + MAX_TTL),
      info: { name, lobby: true, floorIds: [...invite.floorIds] },
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /** Resolves an active guest cookie. Revoking the invitation invalidates all sessions minted by it. */
  session(id: string | undefined): GuestSession | undefined {
    if (!id) return undefined;
    this.sync(); this.expire();
    this.pruneSessions();
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (!this.data.invitations.some((v) => v.id === session.inviteId)) {
      this.sessions.delete(id);
      return undefined;
    }
    return session;
  }

  revokeSession(id: string): boolean { return this.sessions.delete(id); }

  setMuted(id: string, muted: boolean): boolean {
    const session = this.session(id);
    if (!session) return false;
    session.muted = muted;
    return true;
  }

  private info(v: SavedInvitation): GuestInvitationInfo {
    return { id: v.id, ...(v.name ? { name: v.name } : {}), floorIds: [...v.floorIds], uses: v.uses, usesLeft: v.usesLeft, expiresAt: v.expiresAt };
  }
  private expire() {
    const now = Date.now();
    const keep = this.data.invitations.filter((v) => v.expiresAt > now);
    if (keep.length !== this.data.invitations.length) {
      const previous = this.data.invitations;
      this.data.invitations = keep;
      try { this.save(); } catch (err) { this.data.invitations = previous; throw err; }
    }
    const active = new Set(keep.map((v) => v.id));
    for (const [id, session] of this.sessions) if (!active.has(session.inviteId)) this.sessions.delete(id);
  }
  private pruneSessions() { const now = Date.now(); for (const [id, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(id); }
  private sync() {
    let stamp = '';
    try { const s = statSync(this.file); stamp = `${s.mtimeMs}:${s.size}`; } catch { /* first run */ }
    if (stamp === this.stamp) return;
    this.stamp = stamp;
    if (!stamp) { this.data = { invitations: [] }; this.sessions.clear(); this.unreadable = false; return; }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Saved>;
      this.data = { invitations: Array.isArray(parsed.invitations) ? parsed.invitations.filter((v) => v && typeof v.id === 'string' && typeof v.tokenHash === 'string' && Array.isArray(v.floorIds)) : [] };
      this.unreadable = false;
    } catch (err) {
      this.data = { invitations: [] };
      this.sessions.clear();
      this.unreadable = true;
      console.error(`agent-office: couldn't read ${this.file}: ${(err as Error).message}`);
    }
  }
  private save() {
    if (this.unreadable) throw new Error(`Guest invitations are unavailable because ${this.file} could not be read`);
    const tmp = `${this.file}.${process.pid}.tmp`;
    try { writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 }); renameSync(tmp, this.file); }
    catch (err) {
      try { rmSync(tmp, { force: true }); } catch { /* keep the original write error */ }
      console.error(`agent-office: couldn't save ${this.file}: ${(err as Error).message}`);
      throw err;
    }
    try { const s = statSync(this.file); this.stamp = `${s.mtimeMs}:${s.size}`; } catch { this.stamp = ''; }
  }
}
