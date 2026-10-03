# Coworking architecture

The lobby is a project-independent space with its own map. `@lobby` stays reachable with project floors present; `--lobby-only` skips projects, clones and workers. Server and browser resolve human seats and physical zones through `shared/lobby-map.ts`.

`client/world/lobby.ts` builds social scenery without worker hiring targets, board agents or project boards. Project floors keep their office/castle/custom map choice. Project map changes do not affect lobby chairs or claims.

Guest sessions are separate from trusted accounts. Invitations grant lobby access and optional social visits to selected project floors. Guests receive public presence, geometry and chat without project contents, terminals or worker mutations. Social visits do not wake agents or refresh project boards.

Incoming authorization uses HTTP route metadata and a WebSocket command allowlist. `server/guests/visibility.ts` owns explicit outgoing public fields. Revocation invalidates existing sessions; logout/kick closes all tabs of a session. Invitations persist as token hashes; sessions and social profiles are in memory.

The social feature owns exclusive claims, intentions/status, roster and host moderation. Claims release on stand, travel and disconnect through the existing lifecycle registries.

Voice remains peer-to-peer WebRTC. Connections follow visible same-floor peers and close on travel. Personal mute/push-to-talk intent is separate from quiet/host restrictions. Zone playback filters the normal proximity mix through one volume policy. It is client behavior, not hostile-client media isolation or bandwidth optimization.

See [the contribution workflow](coworking-contribution-workflow.md) for the complete product and smaller draft stack. Portals, discovery, federation and voice infrastructure changes remain later work.
