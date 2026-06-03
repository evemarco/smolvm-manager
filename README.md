# SmolVM Manager

A web-based manager for [SmolVM](https://github.com/smol-machines/smolvm) virtual machines. Built with SvelteKit, [Pylon](https://github.com/pylonsync/pylon), and Tailwind CSS.

## Features

- Dashboard for VM lifecycle (create, start, stop, restart, delete)
- TOML config import/export, copy, and recreate flows
- Real-time log streaming and interactive terminal via WebSocket
- Docker Hub image search and tag selection
- [Pylon](https://github.com/pylonsync/pylon)-backed authentication with admin role
- PWA support for installable offline-capable UI

## Requirements

- [Bun](https://bun.sh/) 1.3.14 or later
- [SmolVM](https://github.com/smol-machines/smolvm) installed and running (`smolvm-serve` on `unix:///tmp/smolvm.sock`)
- Optional: `libxmlsec1-openssl` runtime library if your Pylon package depends on it

## Quick Start

```sh
# Install dependencies
bun install

# Copy environment template
cp .env.example .env

# Start the manager (dev mode with Vite dev server + Pylon)
bun run dev:manager

# Or start in production mode (Vite preview + Pylon)
bun run start:manager
```

The manager listens on `MANAGER_HOST:MANAGER_PORT` (default `0.0.0.0:3000` in dev, `0.0.0.0:4173` in prod).

## Environment Variables

| Variable           | Default                             | Description                                              |
| ------------------ | ----------------------------------- | -------------------------------------------------------- |
| `SMOLVM_SOCKET`    | `/tmp/smolvm.sock`                  | Unix socket path for SmolVM API                          |
| `MANAGER_HOST`     | `0.0.0.0`                           | Manager bind address                                     |
| `MANAGER_PORT`     | `3000` (dev) / `4173` (prod)        | Manager bind port                                        |
| `PYLON_URL`        | `http://127.0.0.1:3001`             | Pylon HTTP endpoint                                      |
| `PYLON_COMMAND`    | `pylon`                             | Pylon CLI command                                        |
| `PYLON_APP_DB`     | `sqlite://./data/pylon-app.db`      | Pylon application database                               |
| `PYLON_SESSION_DB` | `sqlite://./data/pylon-sessions.db` | Pylon session database                                   |
| `PYLON_PID_FILE`   | `./.pylon/pylon.pid`                | Pylon process lock file                                  |
| `DOCKER_HUB_TOKEN` | (empty)                             | Optional Docker Hub token for authenticated image search |

See `.env.example` for the full template.

## Production Deployment

### 1. Build

```sh
bun run build
```

### 2. Data Directory

Create a persistent data directory:

```sh
sudo mkdir -p /var/lib/smolvm-manager/data
sudo chown -R $USER:$USER /var/lib/smolvm-manager
```

Update `PYLON_APP_DB` and `PYLON_SESSION_DB` to point under this directory.

### 3. Systemd Service

Copy the example service and environment files:

```sh
sudo cp docs/smolvm-manager.service /etc/systemd/system/
sudo cp docs/smolvm-manager.env /etc/smolvm-manager/env
sudo systemctl daemon-reload
sudo systemctl enable --now smolvm-manager
```

The service expects `smolvm-serve.service` to be active (it uses `After=` and `Wants=`). See `docs/smolvm-manager.service` for details.

### 4. Reverse Proxy (Optional)

Direct HTTP is acceptable on LAN or Tailscale networks. For HTTPS or PWA install on non-localhost origins, place a reverse proxy in front of the manager.

Examples are provided in `docs/reverse-proxy/`:

- `nginx.conf` — Nginx with WebSocket upgrade support
- `Caddyfile` — Caddy with automatic HTTPS

**Important:** The proxy must only forward to the manager. Never expose the raw SmolVM Unix socket (`/tmp/smolvm.sock`) or a raw SmolVM TCP endpoint to the browser.

### 5. Admin Setup

On first start, visit the manager in a browser and complete the initial admin setup. One admin user is created; there is no multi-user admin panel.

## Upgrade

```sh
cd /var/lib/smolvm-manager
git pull
bun install
bun run build
sudo systemctl restart smolvm-manager
```

## Backup and Restore

The manager stores all persistent data in SQLite files:

```sh
# Backup
sudo tar czf smolvm-manager-backup-$(date +%Y%m%d).tar.gz /var/lib/smolvm-manager/data/

# Restore
sudo systemctl stop smolvm-manager
sudo tar xzf smolvm-manager-backup-YYYYMMDD.tar.gz -C /
sudo systemctl start smolvm-manager
```

## Admin Recovery

If you lose admin access, run the reset script on the server:

```sh
cd /var/lib/smolvm-manager
bun run admin:reset
```

This resets the admin password interactively.

## Development

```sh
# Dev server with hot reload and Pylon
bun run dev:manager

# Type check
bun run check

# Lint
bun run lint

# Format
bun run format

# Unit tests
bun run test

# E2E tests
bun run test:e2e
```

## Architecture Notes

- The manager never exposes the SmolVM Unix socket directly. All SmolVM access goes through authenticated `/api/smolvm/*` endpoints.
- Pylon handles authentication and sessions. SvelteKit delegates session validation to Pylon via `hooks.server.ts`.
- The terminal WebSocket endpoint (`/api/smolvm/machines/[name]/terminal/ws`) requires the reverse proxy to forward `Upgrade` and `Connection` headers.
- PWA offline support works best under HTTPS or `localhost`. On plain HTTP LAN origins, the browser may restrict service worker installation.

## License

MIT
