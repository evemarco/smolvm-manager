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
3. Install the executables where the sandbox can reach them. The unit sets `ProtectHome=true`, so anything under `/root` or `/home` is invisible to the service — copy `bun` and `pylon` as real files (not symlinks into `/root`) to `/usr/local/bin/`, and install the full SmolVM distribution somewhere outside home directories such as `/opt/smolvm`.
4. Confirm that `pylon --version` works and that SmolVM serves `/tmp/smolvm.sock`. The provided SmolVM unit copies the host resolver into both the installed and cached agent rootfs before every start; this prevents TSI image pulls from using a stale hard-coded public DNS server. Guest DNS itself is set per machine at create time: the manager builds SmolVM with `scripts/smolvm-api-dns.patch` (adds `dns` to the create API) and sends Hetzner's resolver `185.12.64.1` by default (`SMOLVM_GUEST_DNS` overrides, `none` opts out), so no host-level DNAT redirect is needed. Machines created before this change still resolve through the compiled-in `1.1.1.1` — recreate them to migrate.
5. Run `bun install` and `bun run build`.
6. Create the `smolvm-manager` user and group:

   ```sh
   sudo useradd --system --home-dir /var/lib/smolvm-manager \
     --shell /sbin/nologin --comment "SmolVM Manager service" smolvm-manager
   sudo chown -R smolvm-manager:smolvm-manager /var/lib/smolvm-manager
   ```

7. Copy `docs/smolvm-manager.env` to `/etc/smolvm-manager/env` and edit values. With Pylon 0.3.333 or later you must set `PYLON_ADMIN_TOKEN` (generate one with `openssl rand -hex 32`): Pylon default-denies anonymous entity access and the manager presents this token on its server-side calls. Set `SMOLVM_COMMAND`, `SMOLVM_UPDATE_HOME`, and `SMOLVM_UPDATE_CWD` to match the SmolVM distribution and state directory used by `smolvm-serve.service` if you want live config updates such as adding or removing published ports.
8. Copy `docs/smolvm-manager.service` and `docs/smolvm-serve.service` to `/etc/systemd/system/`. The SmolVM unit carries `UMask=0000` so the manager's unprivileged user may connect to `/tmp/smolvm.sock` (a `022` umask creates it `srwxr-xr-x`, which rejects non-root clients).
9. Enable and start the service: `sudo systemctl enable --now smolvm-manager`.
10. Optionally configure a reverse proxy using the examples in `docs/reverse-proxy/`. Whichever way the manager is exposed, keep Pylon's HTTP port (from `PYLON_URL`, default `4321`) reachable from browsers: the dashboard's live sync (`/api/sync/ws`, `/api/fn/*`) connects to it directly, authenticated by the host-scoped `pylon_session` cookie.

## Service User and Filesystem Isolation

The manager unit runs as the dedicated `smolvm-manager` user with `ProtectSystem=strict`, `ProtectHome=true`, and `ReadWritePaths=/var/lib/smolvm-manager`. Concretely:

- `/root` and `/home` do not exist for the process. This is why `bun` and `pylon` must live in `/usr/local/bin` rather than under `/root`.
- The whole filesystem is read-only except `/var/lib/smolvm-manager`, which covers the app data, Pylon databases, and Vite's temporary config bundle.
- Most lifecycle operations only talk to SmolVM through `/tmp/smolvm.sock`. Live config updates are different: SmolVM 1.7 exposes machine update support through the CLI, so the manager runs `SMOLVM_COMMAND machine update` with `HOME=$SMOLVM_UPDATE_HOME` and `cwd=$SMOLVM_UPDATE_CWD`.
- The SmolVM update CLI must be able to read its distribution files and write SmolVM's server store. With the example layout, grant the manager user access only to the server store directory instead of broadening the whole sandbox:

  ```sh
  sudo setfacl -m u:smolvm-manager:rwx /var/lib/smolvm/.local/share/smolvm/server
  sudo setfacl -m u:smolvm-manager:rw /var/lib/smolvm/.local/share/smolvm/server/smolvm.db
  ```

  If the SmolVM store uses SQLite sidecar files (`smolvm.db-wal` or `smolvm.db-shm`), grant the same user write access to those files too. The shipped unit also adds `/var/lib/smolvm/.local/share/smolvm/server` to `ReadWritePaths`; keep that path as narrow as possible.

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
./scripts/build-smolvm.sh --version v1.7.1
```

The SmolVM source build is **mandatory**, not optional, on hosts that need custom guest DNS (Hetzner included): the prebuilt GitHub binary has no `dns` field in its HTTP create API and silently ignores it, so guests would fall back to the blocked compiled-in `1.1.1.1` with no error. The build script applies `scripts/smolvm-api-dns.patch` and refuses to produce a silently-unpatched binary.

Do not install raw `libkrun.so` files directly from the SmolVM source tree. The project script runs the complete SmolVM distribution packaging step, which makes GPU libraries optional for non-GPU VMs and validates the resulting loader dependencies.

### Upgrading SmolVM

Rebuild (or install) the new SmolVM version, then restart only `smolvm-serve.service`. The manager opens a fresh Unix-socket connection per request and needs neither a rebuild nor a restart; browser SSE/WebSocket streams reconnect on their own. The manager is verified against SmolVM 1.6.13, 1.7.0, and 1.7.1 — see the "SmolVM Compatibility" section of the [README](../README.md) for the version-sensitive behaviors (strict boolean `follow`, per-machine guest DNS via the `smolvm-api-dns.patch` build, and 1.7.0's stricter create/update validation).

## Published Port Bind Address

Machines created with published TCP `ports` get host-side listeners from the SmolVM process. Since SmolVM 1.7.1 these listeners bind to IPv4 `127.0.0.1` by default, so a published port is reachable only from the host itself. The `SMOLVM_PUBLISH_ADDR` environment variable overrides that bind address.

Key facts:

- The scope is global to the SmolVM process: one value applies to every published port of every VM it manages. It cannot be configured per VM or per port.
- An unset or malformed value falls back to `127.0.0.1`. A valid IPv4 address must already exist on an active host interface or the published-port listener cannot bind. Check candidates with `ip -4 addr show`.
- It is independent from the SmolVM API socket (`/tmp/smolvm.sock`, the channel the manager uses to control SmolVM) and from the manager's own bind address (`MANAGER_HOST`). Neither is affected by this setting.
- Published ports reach guests over virtio-net. TSI has no inbound path, so this setting does not affect it.
- Setting it to a LAN address such as `172.21.0.1` makes the listeners reachable through that interface's host routes and firewall rules. It does not automatically make them publicly reachable, and no `0.0.0.0` bind or public exposure is required.

For host-specific production config, prefer a systemd drop-in over editing the shipped unit, so repository updates to `docs/smolvm-serve.service` stay clean:

```sh
sudo mkdir -p /etc/systemd/system/smolvm-serve.service.d
sudo tee /etc/systemd/system/smolvm-serve.service.d/publish-addr.conf <<'EOF'
[Service]
Environment=SMOLVM_PUBLISH_ADDR=172.21.0.1
EOF
```

Then verify the address exists on the host, reload, and restart only the SmolVM service (the manager talks to SmolVM over the Unix socket and needs no restart):

```sh
ip -4 addr show
sudo systemctl daemon-reload
sudo systemctl restart smolvm-serve
```

Confirm the effective environment and the listeners:

```sh
systemctl show smolvm-serve -p Environment
sudo ss -tlnp
```

Published ports should now appear bound to the configured address, or to `127.0.0.1` when the variable is unset.

## Logs

View manager logs via journald:

```sh
sudo journalctl -u smolvm-manager -f
```

[Pylon](https://github.com/pylonsync/pylon) and SvelteKit stdout/stderr are both captured in the same journal stream.

Authenticated administrators can also open **Diagnostics** in the manager navigation. This bounded view records the latest SmolVM API failures, including the upstream error payload, so startup failures remain inspectable without shell access.

View the raw SmolVM service journal when host access is available:

```sh
sudo journalctl -u smolvm-serve -f
```

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
