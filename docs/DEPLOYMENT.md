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
    ├── SOURCE_BUILDS.md
    ├── smolvm-manager.service
    ├── smolvm-serve.service
    ├── smolvm-manager.env
    └── reverse-proxy/
        ├── nginx.conf
        └── Caddyfile
```

## Setup Steps

1. Clone the repository to `/var/lib/smolvm-manager`.
2. Install Pylon and SmolVM, or build them locally by following [`SOURCE_BUILDS.md`](SOURCE_BUILDS.md) when the published executables are incompatible with the host.
3. Install the executables where the sandbox can reach them. The unit sets `ProtectHome=true`, so anything under `/root` or `/home` is invisible to the service — copy `bun` and `pylon` as real files (not symlinks into `/root`) to `/usr/local/bin/`.
4. Confirm that `pylon --version` works and that SmolVM serves `/tmp/smolvm.sock`.
5. Run `bun install` and `bun run build`.
6. Create the `smolvm-manager` user and group:

   ```sh
   sudo useradd --system --home-dir /var/lib/smolvm-manager \
     --shell /sbin/nologin --comment "SmolVM Manager service" smolvm-manager
   sudo chown -R smolvm-manager:smolvm-manager /var/lib/smolvm-manager
   ```

7. Copy `docs/smolvm-manager.env` to `/etc/smolvm-manager/env` and edit values. With Pylon 0.3.333 or later you must set `PYLON_ADMIN_TOKEN` (generate one with `openssl rand -hex 32`): Pylon default-denies anonymous entity access and the manager presents this token on its server-side calls.
8. Copy `docs/smolvm-manager.service` and `docs/smolvm-serve.service` to `/etc/systemd/system/`. The SmolVM unit carries `UMask=0000` so the manager's unprivileged user may connect to `/tmp/smolvm.sock` (a `022` umask creates it `srwxr-xr-x`, which rejects non-root clients).
9. Enable and start the service: `sudo systemctl enable --now smolvm-manager`.
10. Optionally configure a reverse proxy using the examples in `docs/reverse-proxy/`.

## Service User and Filesystem Isolation

The manager unit runs as the dedicated `smolvm-manager` user with `ProtectSystem=strict`, `ProtectHome=true`, and `ReadWritePaths=/var/lib/smolvm-manager`. Concretely:

- `/root` and `/home` do not exist for the process. This is why `bun` and `pylon` must live in `/usr/local/bin` rather than under `/root`.
- The whole filesystem is read-only except `/var/lib/smolvm-manager`, which covers the app data, Pylon databases, and Vite's temporary config bundle.
- Files owned by root elsewhere on the host do not need to change: the service is self-contained in its own directory and only talks to SmolVM through `/tmp/smolvm.sock`.

Running as `root` instead is possible: set `User=root` and `Group=root` in `smolvm-manager.service`, keep the working directory anywhere you like, and drop `ProtectHome=true` if the app must read `/root`. You lose the sandbox — a manager compromise is then a root compromise — so prefer the dedicated user on any host that matters.

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

This runtime package is not the complete build toolchain. Pylon source builds also require Rust, Cargo, Bun, Git, a C compiler, and the system linker. SmolVM source builds additionally require Git LFS, KVM, `patchelf`, e2fsprogs, CMake, and related native build tools. The full distribution-specific package lists are in [`SOURCE_BUILDS.md`](SOURCE_BUILDS.md).

## Runtime Executable Installation

The systemd unit expects both runtime services to be available before the manager starts:

- `PYLON_COMMAND` must resolve to the Pylon executable.
- `smolvm-serve.service` must start SmolVM on the socket configured by `SMOLVM_SOCKET`.

When upstream executables cannot run on the deployment distribution, build them before enabling `smolvm-manager.service`:

```sh
./scripts/build-pylon.sh
./scripts/build-smolvm.sh --version v1.6.3
```

Do not install raw `libkrun.so` files directly from the SmolVM source tree. The project script runs the complete SmolVM distribution packaging step, which makes GPU libraries optional for non-GPU VMs and validates the resulting loader dependencies.

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
