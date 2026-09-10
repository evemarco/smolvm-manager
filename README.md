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
- [Pylon](https://github.com/pylonsync/pylon) `0.3.355`, available as `pylon` or through `PYLON_COMMAND`
- [SmolVM](https://github.com/smol-machines/smolvm) installed and serving its API on `unix:///tmp/smolvm.sock` — verified against **1.6.13–1.7.1** and **1.14.6** (see below)
- KVM access through `/dev/kvm` on Linux hosts that run SmolVM
- Optional: `libxmlsec1-openssl` runtime library if your Pylon package depends on it

> **The prebuilt SmolVM binary does not expose every control-plane field the manager needs.**
> Build SmolVM from source with `./scripts/build-smolvm.sh --version v1.14.6`.
> The build applies `scripts/smolvm-api-manager-parity.patch`, which adds per-machine
> DNS to HTTP create, exposes persisted image/workdir data for safe update planning,
> and makes API exec/run/stream/terminal paths inherit persisted env/workdir/user.
> The script fails loudly if this patch stops applying; never deploy a silently
> unpatched binary. Machines created before the DNS fix must be recreated to migrate.
> Secret references remain CLI-only because the HTTP API deliberately cannot read
> host environment variables or files.

Prebuilt Pylon or SmolVM executables may not run on hosts with an older glibc or a different native-library set. The original project requirements did not list the complete source-build toolchains. See [Building Pylon and SmolVM from Source](docs/SOURCE_BUILDS.md) for the required packages, fallback behavior, and verification commands.

### SmolVM Compatibility

The manager is verified against SmolVM **1.6.13–1.7.1** and **1.14.6** (current). Version-sensitive behaviors that matter:

- Since 1.6.13, the log-stream `follow` query parameter is strictly deserialized as a boolean: `follow=1` is rejected with a 400. The manager sends `follow=true`; custom clients against the SmolVM API must do the same.
- Guest DNS is set per machine at create time. SmolVM's stock HTTP create API has no `dns` field; the consolidated `scripts/smolvm-api-manager-parity.patch` adds CLI parity and the manager sends `dns=185.12.64.1` (Hetzner's resolver) unless the config sets another resolver or `SMOLVM_GUEST_DNS=none` opts out. Machines created before this change must be recreated. The patch also makes `dns` imply networking and preserves it through `.smolcheckpoint` restores.
- SmolVM 1.7.0 rejects invalid create/update payloads that earlier versions accepted silently: out-of-range CPU/memory, `cmd`/`entrypoint` without an image, duplicate guest mount targets, and malformed env names, ports, or egress CIDRs. The manager form pre-validates most of these; any remaining case now surfaces as a clear 400 error in the UI instead of being silently ignored.
- The create API's exact wire names are `allowedHosts`/`allowedCidrs`; the bare `allowHosts`/`allowCidrs` are silently ignored upstream, as are the CLI-only `init`, `sshAgent`, and `gpuVramMb`. The manager emits only names the API honors.
- The exec/run API uses `denyUnknownFields` since 1.9.2: a mis-cased safety field (`timeout_secs` instead of `timeoutSecs`) is a hard 422, never a silent drop. The manager sends exactly the accepted fields.
- 1.14 serves disk sizes in machine responses as `storageGb`/`overlayGb` (the loose `memory`/`storage` aliases are gone) and `machine ls` reports `branchable` alongside the legacy `forkable` echo; the manager reads both forms.
- 1.8 adds transactional/batched forks, hardened registry pulls, egress-denial events, `host.smolvm.internal`, and named inter-VM networks.
- 1.9 adds live SSE exec output, durable detached exec, container-aware file/socket operations, automatic disk reclaim, strict exec/run payloads, shared COW disk bases, proxy-aware image pulls, and remote volumes.
- 1.10–1.11 add native S3/rclone volumes and carry them through embedded, run, and API exec paths.
- 1.12 adds virtio-GPU desktops with host VNC, browser access, stronger fork transactions, and reliable large pack pushes.
- 1.13 adds nested and portable live checkpoints, checkpoint persistence across restarts, browser VNC, and one-to-one port ranges.
- 1.14 makes branching the primary lifecycle, adds browser H.264 desktop streaming, portable image-service checkpoints, parallel/staged virtio-fs mounts, Kubernetes/containerd packaging, workload `user`, selectable block-I/O engines, faster concurrent OCI pulls, and improved branch memory accounting/reclaim. 1.14.6 also improves pack-pull diagnostics, archive path resolution, and deletion ordering.

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
./scripts/build-smolvm.sh --version v1.14.6
```

The Pylon script compiles the project-pinned `v0.3.355` release against the host glibc. The SmolVM script validates the version-matched Git LFS `libkrun` stack, creates the complete distribution, and automatically compiles SmolVM's patched `libkrun` and `libkrunfw` submodules over HTTPS only when compatibility checks require it.

The builds require native development packages beyond Bun. Follow [docs/SOURCE_BUILDS.md](docs/SOURCE_BUILDS.md) before running them on a production host.

## Environment Variables

| Variable              | Default                      | Description                                                 |
| --------------------- | ---------------------------- | ----------------------------------------------------------- |
| `SMOLVM_SOCKET`       | `/tmp/smolvm.sock`           | Unix socket path for SmolVM API                             |
| `SMOLVM_PUBLISH_ADDR` | `127.0.0.1`                  | Global IPv4 bind address for all published VM TCP ports     |
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

The service runs as a dedicated `smolvm-manager` user under a strict mount sandbox (`ProtectHome=true`), so create the user and install `bun` and `pylon` as real files in `/usr/local/bin` — never symlinks into `/root`:

```sh
sudo useradd --system --home-dir /var/lib/smolvm-manager \
  --shell /sbin/nologin --comment "SmolVM Manager service" smolvm-manager
sudo chown -R smolvm-manager:smolvm-manager /var/lib/smolvm-manager
sudo cp "$(command -v bun)" /usr/local/bin/bun
sudo cp "$(command -v pylon)" /usr/local/bin/pylon
```

Copy the example service and environment files:

```sh
sudo cp docs/smolvm-manager.service /etc/systemd/system/
sudo cp docs/smolvm-manager.env /etc/smolvm-manager/env
sudo systemctl daemon-reload
sudo systemctl enable --now smolvm-manager
```

With Pylon 0.3.333 or later, also set `PYLON_ADMIN_TOKEN` in `/etc/smolvm-manager/env` (`openssl rand -hex 32`) — Pylon default-denies anonymous entity access and the manager authenticates its server-side calls with this token.

The service expects `smolvm-serve.service` to be active (it uses `After=` and `Wants=`). Install it from `docs/smolvm-serve.service`, which sets `UMask=0000` so the manager's unprivileged user can connect to `/tmp/smolvm.sock`. See `docs/DEPLOYMENT.md` for the full layout and the trade-offs of running as `root` instead.

### 4. Reverse Proxy (Optional)

Direct HTTP is acceptable on LAN or Tailscale networks. For HTTPS or PWA install on non-localhost origins, place a reverse proxy in front of the manager.

Examples are provided in `docs/reverse-proxy/`:

- `nginx.conf` — Nginx with WebSocket upgrade support
- `Caddyfile` — Caddy with automatic HTTPS

**Important:** The proxy must only forward to the manager. Never expose the raw SmolVM Unix socket (`/tmp/smolvm.sock`) or a raw SmolVM TCP endpoint to the browser.

**Live sync port:** the dashboard's reactive sync (metrics history, saved configs, UI preferences) connects directly from the browser to Pylon's HTTP port — derived from `PYLON_URL`, default `4321` — at `/api/sync/ws` and `/api/fn/*`, authenticated by the host-scoped `pylon_session` cookie. That port must be reachable from the browser (open it on LAN/Tailscale, or proxy it separately). VM statuses and capacity travel over SSE through the manager origin (`/api/smolvm/machines/stream`) and need no extra port.

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
- Reactive sync MVP for UI state (dashboard view mode, saved configs, metrics samples bounded to 100 server-side via the entity's `sync: { limit: 100 }` scope; audit log and TOML snapshots stay out of client replicas with `sync: false`)

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
