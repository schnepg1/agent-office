# The social lobby

The Lobby entry in the floor menu opens a permanent room independent of any repository. It has its own map and human chairs. Project floors keep their existing office, castle or custom map.

This foundation uses the office's existing password/account authentication. Invite only people you trust with the existing office privileges. Public guest invitations and coworking profiles are separate additions.

For a standalone room:

```sh
agent-office --lobby-only --home /path/to/lobby-home --password YOUR_PASSWORD --no-open
```

`AGENT_OFFICE_LOBBY_ONLY=1` is the environment equivalent. Standalone mode skips saved project floors, clone resumption and worker startup, and denies project HTTP/WebSocket tools. Saved project configuration is retained for a later normal startup.

For remote hosting, use the existing host/TLS deployment options in [self-hosting](self-hosting.md). Microphone access needs HTTPS outside localhost.

## Extending the lobby

- `shared/lobby-map.ts` owns its plan, human seats and physical zone bounds. Both client and server resolve it through `planForSpace`.
- `client/world/lobby.ts` builds its scenery through the existing world-builder registry. It builds no worker seats or project boards.
- Its reserved space ID is `@lobby`; its map ID is independent of the building's map choice.
- Voice connections follow visible, same-floor peers. Mute restrictions compose with personal mute and push-to-talk.

Keep new social behavior in feature modules and register it through the existing message, state and lifecycle registries. A visual map does not grant permission to project tools.
