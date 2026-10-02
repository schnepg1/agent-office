# Coworking with guests

Back to the [README](../README.md).

Agent Office can host a small, private coworking room. An admin creates a guest invitation from **☰ → Guest invitations**, chooses the project floors the guest may view, and copies the link. The guest opens `/guest#token=…`, chooses a display name, and joins in the quiet lobby. The token stays in the URL fragment, which browsers do not send to the server.

Guest access is view-only for the selected project floors. Guests can walk around, see the people and shared coworking features, and talk in zone audio. They cannot start, attach to, type into, or control an agent worker, use project execution tools, or manage floors. The server checks these limits on every request and WebSocket action; hiding a button in the browser is only a convenience. A guest can return to the lobby from the floor directory. Revoke an invitation from its list to stop future visits. Use one-visit invitations for a named visitor; reusable links can be forwarded, so share them only with people you trust.

## Choose a place to host it

For a quick private room, run Agent Office on a computer that stays on and share it over your private LAN or a VPN such as [Tailscale](https://tailscale.com). Keep the listener on localhost or the private interface. A laptop is fine for a few people, but it must stay awake and connected. Local hosting keeps projects and agent credentials on that machine.

For a room people can visit any time, use a dedicated VPS or server. Give it a separate, unprivileged Linux account such as `agent-office`; keep its home and project storage on a persistent disk, and run it under systemd. Do not run the service as root. The following is a starting point for a host with Node.js 20+, Git, and the GitHub CLI installed:

```sh
sudo useradd --create-home --shell /bin/bash agent-office
sudo install -d -o agent-office -g agent-office /var/lib/agent-office /opt/agent-office
sudo chown agent-office:agent-office /opt/agent-office
sudo -u agent-office git clone https://github.com/AgentSystemLabs/agent-office /opt/agent-office/source
sudo -u agent-office sh -c 'cd /opt/agent-office/source && npm ci && npm run build'
```

Create `/etc/agent-office.env` with `AGENT_OFFICE_PASSWORD` set to a long random password, then lock it to root with `sudo chown root:root /etc/agent-office.env && sudo chmod 600 /etc/agent-office.env`. Create `/etc/systemd/system/agent-office.service`:

```ini
[Unit]
Description=Agent Office
After=network-online.target
Wants=network-online.target

[Service]
User=agent-office
Group=agent-office
WorkingDirectory=/opt/agent-office/source
Environment=AGENT_OFFICE_HOME=/var/lib/agent-office
EnvironmentFile=/etc/agent-office.env
ExecStart=/usr/bin/node /opt/agent-office/source/bin/agent-office.js --host 127.0.0.1 --port 4600 --home /var/lib/agent-office --projects /var/lib/agent-office/projects
Restart=on-failure
RestartSec=3
UMask=0077

[Install]
WantedBy=multi-user.target
```

Then run `sudo systemctl daemon-reload && sudo systemctl enable --now agent-office`. Keep `/var/lib/agent-office` on persistent storage and back it up: it contains office settings, invitations, accounts, and configuration. Project checkouts, worker worktrees, and agent sign-ins also need persistent storage. Install and sign in to the agent CLIs as the `agent-office` user. Updates should rebuild the checkout as that user, then restart the service.

## HTTPS and private access

Guest entry, voice, and browser media need HTTPS except on localhost. Put Caddy or nginx in front of the localhost listener, configure it to pass WebSocket upgrades, and terminate TLS there. Start Agent Office with `--trust-proxy` only when the proxy is the trusted path to the process; this lets it honor forwarded HTTPS and client address headers. Keep port 4600 closed to the public internet. Alternatively, use Tailscale to keep the entire service private and avoid a public reverse proxy.

Use invitations only for a defined group. Give each guest an explicit list of project floors to view; guest mode does not expose worker execution. For a private group, Tailscale access control provides a second boundary around the service. A guest invitation is still needed inside Agent Office.

Zone audio lets people nearby hear each other. It does not reduce the bandwidth used by voice or make a public server private. Keep zone audio separate from your hosting and access decisions.

`--lobby-only` is for a lightweight social lobby when the host should not open project floors or run agent workers. See [configuration](configuration.md#lobby-only-mode) for its behavior.
