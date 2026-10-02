# Coworking lobby implementation plan

The first release has three work packages. It keeps the existing peer-to-peer WebRTC voice transport and supports both a local host and a dedicated server.

## 1. A lobby independent of projects

- Give the social lobby a reserved `@lobby` identifier. It is a place people can occupy, not a repository checkout or a worker floor.
- Keep it reachable even when project floors exist, and return visitors there when an allowed project disappears.
- Add `--lobby-only` to start a standalone coworking server without opening saved project floors, resuming clones, or running project workers.
- Provide the same guest entry and social features in local and VPS hosting. Hosts supply a reachable HTTPS address; the application does not automatically publish a local machine to the internet.
- Keep existing trusted office accounts and ordinary project hosting compatible.

Acceptance: a clean home with no repository opens a usable lobby; lobby-only mode also opens no projects when its home already contains saved floors. A normal office can move between its lobby and project floors.

## 2. Guest sessions, scoped invitations, and server permissions

- A host creates an invitation granting lobby access and optionally a list of project floors a visitor may enter.
- Invitations have an expiry and are reusable or have a limited number of admissions. Their secret token is returned on creation; saved invitation metadata contains a token digest.
- A visitor exchanges the URL fragment token and a display name for a guest session. A guest session is separate from an account authenticated with the shared office password.
- Guests may change their own social presence, chat, voice status, work intention, and seating. They do not receive agent execution or project mutation permissions.
- Enforce a small, explicit guest command allowlist, HTTP route restrictions, scoped floor entry, and outgoing-message filtering. Unknown commands fail closed.
- Filter private floor listings, initial snapshots, presence, chat, tool state, and later broadcasts. Deny terminal streams, project file routes, sign-ins, service tunnels, and invitation administration.
- Revoking an invitation invalidates the sessions issued from it. Kicking a guest invalidates that guest session, rather than only disconnecting its current socket.

Acceptance: direct HTTP and WebSocket requests cannot bypass the UI; a forged floor ID cannot enter a private project; guests cannot receive private data after initial connection; used, expired, and revoked invitations do not admit new visitors.

The existing `member` account remains a trusted office collaborator. This release scopes public guest access; it does not sandbox the command execution of trusted collaborators. A future collaborator permission system must also consider isolation between worker processes.

## 3. Desks, intentions, zones, and host moderation

- Add human seating targets to the existing lobby workstation chairs.
- Make desk claims exclusive, tied to the current visitor, and released on standing, travel, or disconnect.
- Let people publish a short work intention and status. Show the roster with their desk and current area.
- Define a quiet workstation area and a conversation area using the lobby's physical layout. Show the current area and mute the ordinary client's microphone in the quiet area.
- Keep zone playback on the current WebRTC connections. Playback controls are social behavior, not an isolation or bandwidth guarantee.
- Let hosts mute, unmute, and remove guest sessions. Preserve host mute across reconnecting the same session.

Acceptance: two visitors cannot claim the same seat, even with the same display name; a visitor cannot modify somebody else's profile or moderate them; leaving frees the seat; mute and removal survive a socket reconnect; entering the quiet area updates the voice behavior.

## Integration and validation

GPT-6 Luna agents implement server access, social features, and guest entry/hosting instructions in separate worktrees. The orchestrator integrates their commits, reviews authorization and data paths, runs typecheck, tests, and production builds, and checks the guest and host flows with browser screenshots.

Use an isolated home and a separate port for verification. Do not test guest access against the host's real project credentials or publish the server as part of implementation testing.

Workspace portals, public server discovery, cross-server identities, and new voice infrastructure are later phases.
