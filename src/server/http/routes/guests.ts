import type http from 'node:http';
import type { Session } from '../../auth.js';
import type { Ctx } from '../../office/context.js';
import { sameOrigin, readBody, send, isSecure, clientIp } from '../util.js';
import type { Route } from '../router.js';
import { isGuestClient } from '../../access.js';

async function jsonBody(req: http.IncomingMessage): Promise<Record<string, unknown> | undefined> {
  try {
    const v = JSON.parse(await readBody(req, 8192));
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

function admin(ctx: Ctx, session: Session): boolean {
  return !session.guest && ctx.meOf(session.account?.id).admin;
}

function requireHost(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, session: Session): boolean {
  if (!admin(ctx, session)) { send(res, 403, { error: 'Only hosts can manage guest invitations' }); return false; }
  if (!sameOrigin(req, ctx.cfg)) { send(res, 403, { error: 'Request must come from this office' }); return false; }
  return true;
}

export const guestRoutes = {
  list: {
    path: '/api/guest/invitations', auth: 'session', method: 'GET', lobbyOnly: true,
    handle(ctx, { res, session }) {
      if (!admin(ctx, session)) return send(res, 403, { error: 'Only hosts can manage guest invitations' });
      return send(res, 200, { invitations: ctx.guests.list() });
    },
  },
  create: {
    path: '/api/guest/invitations', auth: 'session', method: 'POST', lobbyOnly: true,
    async handle(ctx, { req, res, session }) {
      if (!requireHost(ctx, req, res, session)) return;
      const body = await jsonBody(req);
      if (!body) return send(res, 400, { error: 'Bad request' });
      if ((body.name !== undefined && typeof body.name !== 'string') || (body.floorIds !== undefined && !Array.isArray(body.floorIds)) ||
        (body.uses !== undefined && body.uses !== null && typeof body.uses !== 'number') || (body.expiresAt !== undefined && typeof body.expiresAt !== 'number')) {
        return send(res, 400, { error: 'Invalid guest invitation fields' });
      }
      const result = ctx.guests.create(session.account?.name ?? 'host', {
        ...(typeof body.name === 'string' ? { name: body.name } : {}),
        ...(Array.isArray(body.floorIds) ? { floorIds: body.floorIds as string[] } : {}),
        ...(body.uses === null || typeof body.uses === 'number' ? { uses: body.uses as number | null } : {}),
        ...(typeof body.expiresAt === 'number' ? { expiresAt: body.expiresAt } : {}),
      });
      if (typeof result === 'string') return send(res, 400, { error: result });
      return send(res, 201, result);
    },
  },
  revoke: {
    prefix: '/api/guest/invitations/', auth: 'session', method: 'DELETE', lobbyOnly: true,
    handle(ctx, { req, res, path, session }) {
      if (!requireHost(ctx, req, res, session)) return;
      const id = path.slice('/api/guest/invitations/'.length);
      if (!/^[a-f0-9]{16}$/.test(id)) return send(res, 404, { error: 'No such invitation' });
      const revoked = ctx.guests.revoke(id);
      if (!revoked) return send(res, 404, { error: 'No such invitation' });
      const revokedIds = new Set(revoked);
      for (const client of ctx.clients.values()) if (client.guestId && revokedIds.has(client.guestId)) {
        client.out = true;
        client.ws.close(4003, 'Guest invitation revoked');
      }
      return send(res, 200, { ok: true });
    },
  },
  sessions: {
    path: '/api/guest/sessions', auth: 'session', method: 'GET', lobbyOnly: true,
    handle(ctx, { res, session }) {
      if (!admin(ctx, session)) return send(res, 403, { error: 'Only hosts can manage guest sessions' });
      const sessions = [...ctx.clients.values()].filter(isGuestClient).map((c) => ({ id: c.guestId!, name: c.peer.name, floor: c.peer.floor ?? null, muted: !!c.guestMuted }));
      return send(res, 200, { sessions });
    },
  },
  revokeSession: {
    prefix: '/api/guest/sessions/', auth: 'session', method: 'DELETE', lobbyOnly: true,
    handle(ctx, { req, res, path, session }) {
      if (!requireHost(ctx, req, res, session)) return;
      const id = path.slice('/api/guest/sessions/'.length);
      if (!/^[\w-]{32}$/.test(id) || !ctx.guests.revokeSession(id)) return send(res, 404, { error: 'No such guest session' });
      for (const client of ctx.clients.values()) if (client.guestId === id) { client.out = true; client.ws.close(4003, 'Guest access revoked'); }
      return send(res, 200, { ok: true });
    },
  },
  enter: {
    path: '/api/guest/enter', auth: 'public', method: 'POST',
    async handle(ctx, { req, res }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Request must come from this office' });
      const ip = clientIp(req, ctx.cfg.trustProxy);
      if (!ctx.auth.allowGuestEntry(ip)) return send(res, 429, { error: 'Too many guest entries. Try again in a minute.' });
      const body = await jsonBody(req);
      if (!body || typeof body.token !== 'string') return send(res, 400, { error: 'Bad request' });
      const result = ctx.guests.enter(body.token, typeof body.name === 'string' ? body.name : '');
      if (typeof result === 'string') return send(res, 410, { error: result });
      const cookie = ctx.auth.cookie(req, ctx.auth.issueGuest(result.id), isSecure(req, ctx.cfg));
      return send(res, 200, { ok: true, name: result.info.name, role: 'guest', floorIds: result.info.floorIds }, { 'set-cookie': cookie });
    },
  },
} satisfies Record<string, Route>;
