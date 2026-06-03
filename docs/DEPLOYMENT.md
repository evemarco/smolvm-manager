# Production Environment Example

This file documents a complete production deployment layout for [SmolVM Manager](https://github.com/evemarco/smolvm-manager).

## Directory Layout

```
/var/lib/smolvm-manager/
├── data/
│   ├── pylon-app.db
│   └── pylon-sessions.db
├── .pylon/
│   └── pylon.pid
├── .env
├── app.ts
├── scripts/
│   └── start-manager.ts
├── build/
│   └── (vite production build)
└── docs/
    ├── smolvm-manager.service
    ├── smolvm-manager.env
    └── reverse-proxy/
        ├── nginx.conf
        └── Caddyfile
```

## Setup Steps

1. Clone the repository to `/var/lib/smolvm-manager`.
2. Run `bun install` and `bun run build`.
3. Create the `smolvm-manager` user and group.
4. Copy `docs/smolvm-manager.env` to `/etc/smolvm-manager/env` and edit values.
5. Copy `docs/smolvm-manager.service` to `/etc/systemd/system/`.
6. Enable and start the service: `sudo systemctl enable --now smolvm-manager`.
7. Optionally configure a reverse proxy using the examples in `docs/reverse-proxy/`.

## Security Notes

- The manager binds to `127.0.0.1:3000` by default in production. Use a reverse proxy for external access.
- The SmolVM Unix socket (`/tmp/smolvm.sock`) must never be exposed to the browser or public network.
- Admin credentials are set during first-run setup. Keep them secure.
- The systemd unit uses `ProtectSystem=strict` and `NoNewPrivileges=true` for sandboxing.

## Pylon Architecture Boundary

The manager uses [Pylon](https://github.com/pylonsync/pylon) for authentication, durable metadata, and reactive UI sync. SvelteKit retains ownership of all SmolVM-facing routes.

**Pylon owns:** auth/sessions, settings, saved VM configs, TOML snapshots, metrics history, audit events, UI preferences, RBAC policies, and reactive sync (dashboard view mode, saved configs, metrics samples up to 100).

**SvelteKit owns:** SmolVM Unix socket proxying (`/api/smolvm/*`), SSE log streaming, terminal WebSocket, Docker Hub proxy, TOML utilities, and VM lifecycle orchestration.

This split lets the manager store metadata in Pylon while keeping VM operations local and fast.

## Rollout Controls

Two environment variables control Pylon integration:

- `PYLON_STORE_MODE` — Transport layer for metadata operations:
  - `typed` (default): Uses Pylon typed queries and mutations. Recommended for production.
  - `rest`: Falls back to direct REST calls. Useful for rollback if typed mode has issues.
  - `mock`: In-memory mock store. Use only in tests.

- `PYLON_SERVICE_TOKEN` — Server-side-only secret for background jobs. The metrics sampler and audit logger use this token to write data without a browser session. Never expose this to the client.

## Pylon Runtime Dependencies

Some [Pylon](https://github.com/pylonsync/pylon) builds require `libxmlsec1-openssl.so.1` at runtime. If the service fails to start with a library error, install the corresponding system package (e.g., `libxmlsec1-openssl` on Debian/Ubuntu, `xmlsec1-openssl` on Fedora).

## Logs

View manager logs via journald:

```sh
sudo journalctl -u smolvm-manager -f
```

[Pylon](https://github.com/pylonsync/pylon) and SvelteKit stdout/stderr are both captured in the same journal stream.

## Backup

Back up the `data/` directory regularly. It contains all application and session state.

```sh
sudo tar czf /backup/smolvm-manager-$(date +%Y%m%d).tar.gz -C /var/lib/smolvm-manager data/
```

## Restore

Stop the service, extract the backup, and restart:

```sh
sudo systemctl stop smolvm-manager
sudo tar xzf /backup/smolvm-manager-YYYYMMDD.tar.gz -C /
sudo systemctl start smolvm-manager
```
