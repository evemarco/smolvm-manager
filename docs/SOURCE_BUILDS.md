# Building Pylon and SmolVM from Source

Use the project build scripts when the upstream executables cannot run on the deployment host. This commonly happens when a downloaded binary requires a newer glibc version, when its native libraries are unavailable, or when the host architecture does not match the published artifact.

Earlier versions of the project documentation listed the application dependencies but did not describe the complete native toolchains required to build Pylon and SmolVM. The requirements and fallback behavior are documented here so production installations do not have to discover them through loader errors.

## Before You Begin

Both builds require:

- A supported 64-bit Linux host
- Internet access to GitHub and the package registries used during the build
- A C compiler and linker
- [Rust](https://rustup.rs/) with Cargo
- Git
- Enough free space under `/tmp` for source trees and build artifacts

Install Rust with rustup when the distribution Rust package is too old:

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

## Pylon

### Why Build Pylon Locally?

`scripts/build-pylon.sh` compiles Pylon against the host's native glibc. Use it when the published Pylon executable fails with an error such as `GLIBC_x.y not found` or cannot load one of its native libraries.

The script builds the Pylon version pinned by this project, currently `v0.3.333`, including its Studio web UI.

### Pylon Build Requirements

The script checks for:

- `rustc` and `cargo`
- `bun`
- `git`
- `cc`
- `ldd`

Install Bun separately from [bun.sh](https://bun.sh/). A standard distribution development toolchain supplies `cc` and the linker.

Example for Rocky Linux, RHEL, or CentOS:

```sh
sudo dnf groupinstall -y "Development Tools"
sudo dnf install -y git glibc-common
```

Example for Debian or Ubuntu:

```sh
sudo apt-get update
sudo apt-get install -y build-essential git libc-bin
```

Some Pylon builds also require `libxmlsec1-openssl.so.1` at runtime. Install `xmlsec1-openssl` on Fedora-family distributions or `libxmlsec1-openssl` on Debian-family distributions if `ldd` reports it as missing.

### Build and Install Pylon

```sh
./scripts/build-pylon.sh
```

The default installation path is `$HOME/.local/bin/pylon`. Override the tag, clone directory, or installation directory with environment variables:

```sh
TAG=v0.3.333 \
REPO_DIR=/var/tmp/pylon-source \
INSTALL_DIR=$HOME/.local/bin \
./scripts/build-pylon.sh
```

`TAG` accepts three forms: an exact tag such as `v0.3.333`, `latest` to resolve and build the newest release tag from the remote, or an empty value (`TAG=""`) to build the latest commit on the default branch. Building a newer server should be paired with the matching `@pylonsync/*` package versions in `package.json` so the manager and the server share the same protocol revision.

Verify the result:

```sh
pylon --version
ldd "$(command -v pylon)"
```

If Pylon is installed outside `PATH`, set `PYLON_COMMAND` in `.env` or `/etc/smolvm-manager/env` to its absolute path.

## SmolVM

### Why Build SmolVM Locally?

`scripts/build-smolvm.sh` compiles the SmolVM executable, guest agent, and distribution resources on the deployment host. It also validates the exact `libkrun` and `libkrunfw` pair pinned by the selected SmolVM revision.

The SmolVM repository contains version-matched library binaries through Git LFS. They are patched SmolVM forks, so generic upstream `libkrun` or `libkrunfw` release files are not interchangeable. On Linux, the official distribution process also removes the hard `libvirglrenderer.so.1` dependency from non-GPU startup paths. Copying the raw Git LFS libraries after only running `cargo make dev` skips that packaging step and can make every VM exit before the guest agent is ready.

### SmolVM Runtime Requirements

- Linux on x86_64 or aarch64
- KVM available through `/dev/kvm`
- Rust, Cargo, and rustup
- Git and Git LFS
- `curl`, `file`, `ldd`, `readelf`, and `tar`
- `patchelf`
- `mkfs.ext4` from e2fsprogs
- GCC, Make, CMake, and pkg-config

Example for Rocky Linux, RHEL, or CentOS 9:

```sh
sudo dnf install -y epel-release
sudo dnf groupinstall -y "Development Tools"
sudo dnf install -y \
  git git-lfs curl file binutils glibc-common patchelf e2fsprogs tar \
  gcc gcc-c++ make cmake pkgconf-pkg-config
git lfs install
```

Example for Debian or Ubuntu:

```sh
sudo apt-get update
sudo apt-get install -y \
  build-essential git git-lfs curl file binutils libc-bin patchelf \
  e2fsprogs tar cmake pkg-config
git lfs install
```

Confirm KVM access before building:

```sh
test -r /dev/kvm -a -w /dev/kvm && echo "KVM is available"
```

### Library Selection Modes

The default `auto` mode performs these steps:

1. Clone the requested SmolVM revision and download its Git LFS library bundle.
2. Validate the library provenance against the pinned submodule commits.
3. Validate the ELF architecture and the `libkrun.so.2` and `libkrunfw.so.5` SONAMEs.
4. Build the guest agent rootfs and complete distribution.
5. Apply the upstream `patchelf` normalization and reject unresolved dependencies.
6. If compatibility validation still fails, initialize the patched submodules over public HTTPS and build them from source.

Select a mode explicitly when diagnosing a host:

```sh
# Prefer the version-matched Git LFS libraries and compile only if needed
./scripts/build-smolvm.sh --version v1.6.3 --libkrun-mode auto

# Refuse to compile libkrun and libkrunfw
./scripts/build-smolvm.sh --version v1.6.3 --libkrun-mode bundled

# Force the patched submodules to compile locally
./scripts/build-smolvm.sh --version v1.6.3 --libkrun-mode source
```

Source builds disable libkrun GPU support by default to avoid an unnecessary virglrenderer development dependency. Enable it only when GPU virtualization is required:

```sh
./scripts/build-smolvm.sh \
  --version v1.6.3 \
  --libkrun-mode source \
  --libkrun-gpu 1
```

### Additional Dependencies for a Forced Library Build

Compiling `libkrunfw` also compiles its guest Linux kernel and needs a larger native toolchain.

Debian or Ubuntu packages:

```sh
sudo apt-get install -y \
  flex bison libelf-dev libssl-dev bc cpio rsync kmod \
  python3 python3-pyelftools clang llvm libclang-dev
```

Rocky Linux, RHEL, or CentOS packages:

```sh
sudo dnf install -y \
  flex bison elfutils-libelf-devel openssl-devel bc cpio rsync kmod \
  python3 python3-pyelftools clang llvm-devel clang-devel
```

The complete kernel build is slow. Keep the default `auto` mode unless binary validation proves that a local library build is necessary.

### Local Patches

After cloning, the script applies every `*.patch` file found in `scripts/` to the SmolVM source tree. A patch that no longer applies cleanly — because upstream merged the fix or the surrounding code changed — is skipped with a log message and never fails the build. `scripts/smolvm-fnv64-fix.patch` currently repairs an upstream compile error in the `smolvm-cuda` guest build and can be deleted once the fix lands in a SmolVM release.

### Installation Paths and Verification

The default installation layout is:

- Wrapper and libraries: `$HOME/.smolvm`
- CLI symlink: `$HOME/.local/bin/smolvm`
- Temporary source tree: `/tmp/smolvm-build`

The installer builds and validates a staging directory before replacing an existing installation. A timestamped backup is retained beside the installation directory.

Verify the installed runtime:

```sh
smolvm --version
ldd "$HOME/.smolvm/lib/libkrun.so"
patchelf --print-needed "$HOME/.smolvm/lib/libkrun.so"
```

Start the API server and check it through the Unix socket:

```sh
smolvm serve start --listen unix:///tmp/smolvm.sock
curl --unix-socket /tmp/smolvm.sock http://localhost/health
```

The manager expects that socket unless `SMOLVM_SOCKET` is changed.

## Troubleshooting

### Empty `libkrun` or `libkrunfw` Directories

SmolVM records these dependencies as Git submodules with SSH URLs. The build script rewrites those URLs to public HTTPS when source compilation is required, so a GitHub SSH key is not necessary.

### `libvirglrenderer.so.1 => not found`

Do not copy the raw `libkrun.so` directly from the repository. Run `scripts/build-smolvm.sh`, which executes the complete upstream distribution process and verifies that virglrenderer is optional for non-GPU VMs.

### `GLIBC_x.y not found`

Build on the oldest distribution version that must run the executable, or build directly on the deployment host. This applies to both Pylon and SmolVM.

### `/dev/kvm` Is Missing or Inaccessible

Enable hardware virtualization in the firmware and load the host KVM modules. Containerized installations must explicitly pass `/dev/kvm` into the container.
