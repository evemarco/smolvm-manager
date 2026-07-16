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
- [Pylon](https://github.com/pylonsync/pylon) `0.3.298`, available as `pylon` or through `PYLON_COMMAND`
- [SmolVM](https://github.com/smol-machines/smolvm) installed and serving its API on `unix:///tmp/smolvm.sock`
- KVM access through `/dev/kvm` on Linux hosts that run SmolVM
- Optional: `libxmlsec1-openssl` runtime library if your Pylon package depends on it

Prebuilt Pylon or SmolVM executables may not run on hosts with an older glibc or a different native-library set. The original project requirements did not list the complete source-build toolchains. See [Building Pylon and SmolVM from Source](docs/SOURCE_BUILDS.md) for the required packages, fallback behavior, and verification commands.

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

## Building Runtime Executables from Source

If the downloaded executables fail with a glibc or shared-library error, build them on the deployment host:

```sh
./scripts/build-pylon.sh
./scripts/build-smolvm.sh --version v1.6.3
```

The Pylon script compiles the project-pinned `v0.3.298` release against the host glibc. The SmolVM script validates the version-matched Git LFS `libkrun` stack, creates the complete distribution, and automatically compiles SmolVM's patched `libkrun` and `libkrunfw` submodules over HTTPS only when compatibility checks require it.

The builds require native development packages beyond Bun. Follow [docs/SOURCE_BUILDS.md](docs/SOURCE_BUILDS.md) before running them on a production host.

## Environment Variables

| Variable              | Default                      | Description                                                 |
| --------------------- | ---------------------------- | ----------------------------------------------------------- |
| `SMOLVM_SOCKET`       | `/tmp/smolvm.sock`           | Unix socket path for SmolVM API                             |
| `MANAGER_HOST`        | `0.0.0.0`                    | Manager bind address                                        |
| `MANAGER_PORT`        | `3000` (dev) / `4173` (prod) | Manager bind port                                           |
| `PYLON_URL`           | `http://127.0.0.1:3001`      | Pylon HTTP endpoint                                         |
| `PYLON_COMMAND`       | `pylon`                      | Pylon CLI command                                           |
| `PYLON_DB_PATH`       | `./data/pylon-app.db`        | Pylon application database                                  |
| `PYLON_SESSION_DB`    | `./data/pylon-sessions.db`   | Pylon session database (plain path, no URI prefix)          |
| `PYLON_PID_FILE`      | `./.pylon/pylon.pid`         | Pylon process lock file                                     |
| `DOCKER_HUB_TOKEN`    | (empty)                      | Optional Docker Hub token for authenticated image search    |
| `PYLON_STORE_MODE`    | `typed`                      | Pylon store transport: `typed` (default), `rest`, or `mock` |
| `PYLON_SERVICE_TOKEN` | (empty)                      | Server-side secret for background jobs (metrics, audit)     |

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

Update `PYLON_DB_PATH` and `PYLON_SESSION_DB` to point under this directory.

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

### Pylon Boundary

The codebase is split between [Pylon](https://github.com/pylonsync/pylon) (metadata, auth, policies) and SvelteKit (VM orchestration, streaming, proxies).

**Pylon handles:**

- Authentication and sessions (admin role, session validation via `hooks.server.ts`)
- Durable metadata: settings, saved VM configs, TOML snapshots, metrics history, audit events, UI preferences
- RBAC policies for metadata access
- Reactive sync MVP for UI state (dashboard view mode, saved configs, metrics samples bounded to 100)

**SvelteKit handles:**

- SmolVM Unix socket proxying (`/api/smolvm/*` routes)
- SSE log streaming and terminal WebSocket
- Docker Hub proxy and TOML utilities
- VM lifecycle orchestration (create, start, stop, restart, delete)

This boundary is intentional. SmolVM operations remain SvelteKit-owned so the manager can proxy to the local Unix socket without routing through Pylon.

### Other Notes

- The manager never exposes the SmolVM Unix socket directly. All SmolVM access goes through authenticated `/api/smolvm/*` endpoints.
- The terminal WebSocket endpoint (`/api/smolvm/machines/[name]/terminal/ws`) requires the reverse proxy to forward `Upgrade` and `Connection` headers.
- PWA offline support works best under HTTPS or `localhost`. On plain HTTP LAN origins, the browser may restrict service worker installation.

## License

MIT
