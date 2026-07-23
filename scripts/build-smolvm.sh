#!/usr/bin/env bash
set -euo pipefail

SMOLVM_VERSION="${SMOLVM_VERSION:-latest}"
BUILD_DIR="${BUILD_DIR:-/tmp/smolvm-build}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.smolvm}"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
MODIFY_PATH="${MODIFY_PATH:-true}"
LIBKRUN_MODE="${LIBKRUN_MODE:-auto}"
LIBKRUN_GPU="${LIBKRUN_GPU:-0}"
REPO_URL="${REPO_URL:-https://github.com/smol-machines/smolvm.git}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR=""
LIBKRUN_SOURCE_BUILT=false

usage() {
    cat <<EOF
Usage: $0 [OPTIONS]

Build and install SmolVM from source while using the version-matched bundled
libkrun stack when compatible. If validation fails, auto mode builds SmolVM's
patched libkrun and libkrunfw submodules from source.

Options:
  -v, --version VERSION      Git tag to build (for example v1.6.3). Default: latest
  -b, --build-dir PATH       Temporary build directory. Default: /tmp/smolvm-build
  -i, --install-dir PATH     Installation directory. Default: ~/.smolvm
      --bin-dir PATH         Directory for the PATH symlink. Default: ~/.local/bin
      --libkrun-mode MODE    auto, bundled, or source. Default: auto
      --libkrun-gpu 0|1      GPU support for source-built libkrun. Default: 0
      --no-modify-path       Do not create a symlink in the PATH
  -h, --help                 Show this help

Examples:
  $0
  $0 --version v1.6.3
  $0 --version v1.6.3 --libkrun-mode source

Environment variables:
  SMOLVM_VERSION, BUILD_DIR, INSTALL_DIR, BIN_DIR, MODIFY_PATH
  LIBKRUN_MODE, LIBKRUN_GPU, REPO_URL
EOF
}

log() {
    printf '[smolvm-build] %s\n' "$*"
}

error() {
    printf '[smolvm-build] ERROR: %s\n' "$*" >&2
    exit 1
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || error "$1 is required but is not installed."
}

assert_safe_directory() {
    local path label
    path="${1%/}"
    label="$2"
    case "$path" in
        ""|/|.|..|"$HOME"|/root|/usr|/usr/local|/tmp|/var|/var/tmp)
            error "$label resolves to an unsafe directory: $1"
            ;;
    esac
}

parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -v|--version)
                [[ -n "${2:-}" ]] || error "$1 requires a value."
                SMOLVM_VERSION="$2"
                shift 2
                ;;
            -b|--build-dir)
                [[ -n "${2:-}" ]] || error "$1 requires a value."
                BUILD_DIR="$2"
                shift 2
                ;;
            -i|--install-dir)
                [[ -n "${2:-}" ]] || error "$1 requires a value."
                INSTALL_DIR="$2"
                shift 2
                ;;
            --bin-dir)
                [[ -n "${2:-}" ]] || error "$1 requires a value."
                BIN_DIR="$2"
                shift 2
                ;;
            --libkrun-mode)
                [[ -n "${2:-}" ]] || error "$1 requires a value."
                LIBKRUN_MODE="$2"
                shift 2
                ;;
            --libkrun-gpu)
                [[ -n "${2:-}" ]] || error "$1 requires a value."
                LIBKRUN_GPU="$2"
                shift 2
                ;;
            --no-modify-path)
                MODIFY_PATH=false
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                error "Unknown argument: $1"
                ;;
        esac
    done

    case "$LIBKRUN_MODE" in
        auto|bundled|source) ;;
        *) error "--libkrun-mode must be auto, bundled, or source." ;;
    esac
    case "$LIBKRUN_GPU" in
        0|1) ;;
        *) error "--libkrun-gpu must be 0 or 1." ;;
    esac
    case "$MODIFY_PATH" in
        true|false) ;;
        *) error "MODIFY_PATH must be true or false." ;;
    esac
    assert_safe_directory "$BUILD_DIR" "BUILD_DIR"
    assert_safe_directory "$INSTALL_DIR" "INSTALL_DIR"
    [[ "$BUILD_DIR" != "$INSTALL_DIR" ]] || error "BUILD_DIR and INSTALL_DIR must be different."
}

check_requirements() {
    local command_name
    for command_name in rustc cargo rustup git git-lfs curl file ldd readelf patchelf mkfs.ext4 tar gcc make cmake pkg-config; do
        require_command "$command_name"
    done
    [[ "$(uname -s)" == "Linux" ]] || error "This installer currently supports Linux only."
    if [[ ! -e /dev/kvm ]]; then
        log "WARNING: /dev/kvm does not exist. SmolVM requires KVM to start microVMs."
    fi
}

clone_smolvm() {
    log "Cloning SmolVM into $BUILD_DIR ..."
    rm -rf "$BUILD_DIR"
    if [[ "$SMOLVM_VERSION" == "latest" ]]; then
        git clone --depth 1 "$REPO_URL" "$BUILD_DIR"
    elif ! git clone --depth 1 --branch "$SMOLVM_VERSION" "$REPO_URL" "$BUILD_DIR"; then
        log "Shallow tag clone failed; retrying with a full clone."
        rm -rf "$BUILD_DIR"
        git clone "$REPO_URL" "$BUILD_DIR"
        git -C "$BUILD_DIR" checkout "$SMOLVM_VERSION"
    fi
    git -C "$BUILD_DIR" lfs pull
}

apply_local_patches() {
    local patch_file
    for patch_file in "$SCRIPT_DIR"/*.patch; do
        [[ -e "$patch_file" ]] || return 0
        if git -C "$BUILD_DIR" apply --check "$patch_file" 2>/dev/null; then
            log "Applying local patch: $(basename "$patch_file") ..."
            git -C "$BUILD_DIR" apply "$patch_file"
        else
            log "Skipping $(basename "$patch_file"): does not apply cleanly (already merged upstream or codebase changed)."
        fi
    done
}

host_arch() {
    uname -m
}

distribution_arch() {
    local arch
    arch="$(host_arch)"
    [[ "$arch" == "aarch64" ]] && arch="arm64"
    printf '%s\n' "$arch"
}

bundled_lib_dir() {
    printf '%s/lib/linux-%s\n' "$BUILD_DIR" "$(host_arch)"
}

validate_bundled_libraries() {
    local lib_dir
    lib_dir="$(bundled_lib_dir)"
    [[ -f "$lib_dir/libkrun.so" && -f "$lib_dir/libkrunfw.so" ]] || return 1
    file "$lib_dir/libkrun.so" | grep -q 'ELF 64-bit' || return 1
    file -L "$lib_dir/libkrunfw.so" | grep -q 'ELF 64-bit' || return 1
    "$BUILD_DIR/scripts/check-libkrun-provenance.sh" >/dev/null || return 1
    readelf -d "$lib_dir/libkrun.so" | grep -q 'Library soname: \[libkrun.so.2\]' || return 1
    readelf -d "$lib_dir/libkrunfw.so" | grep -q 'Library soname: \[libkrunfw.so.5\]' || return 1
}

initialize_patched_submodules() {
    log "Initializing patched libkrun and libkrunfw submodules over HTTPS ..."
    git -C "$BUILD_DIR" \
        -c url."https://github.com/".insteadOf=git@github.com: \
        submodule update --init --recursive --depth 1 libkrun libkrunfw
    git -C "$BUILD_DIR" config url."https://github.com/".insteadOf git@github.com:
}

build_patched_libraries() {
    initialize_patched_submodules
    log "Building SmolVM's patched libkrun stack from source (GPU=$LIBKRUN_GPU) ..."
    (
        cd "$BUILD_DIR"
        GPU="$LIBKRUN_GPU" ./scripts/build-libkrun-linux.sh
    )
    validate_bundled_libraries || error "The source-built libkrun stack failed provenance or ABI validation."
    LIBKRUN_SOURCE_BUILT=true
}

select_libraries() {
    case "$LIBKRUN_MODE" in
        bundled)
            validate_bundled_libraries || error "The bundled libkrun stack failed provenance or ABI validation."
            log "Using SmolVM's version-matched Git LFS library bundle."
            ;;
        source)
            build_patched_libraries
            ;;
        auto)
            if validate_bundled_libraries; then
                log "Using SmolVM's version-matched Git LFS library bundle."
            else
                log "Bundled libraries failed validation; switching to a source build."
                build_patched_libraries
            fi
            ;;
    esac
}

distribution_dir() {
    local version
    version="$(grep '^version' "$BUILD_DIR/Cargo.toml" | head -1 | cut -d'"' -f2)"
    printf '%s/dist/smolvm-%s-linux-%s\n' "$BUILD_DIR" "$version" "$(distribution_arch)"
}

build_distribution() {
    log "Building the complete SmolVM distribution ..."
    (
        cd "$BUILD_DIR"
        ./scripts/build-dist.sh
    )
}

build_agent_rootfs() {
    log "Building the SmolVM agent rootfs ..."
    (
        cd "$BUILD_DIR"
        ./scripts/build-agent-rootfs.sh
    )
}

validate_distribution() {
    local dist_dir lib_dir ldd_output
    dist_dir="$(distribution_dir)"
    lib_dir="$dist_dir/lib"

    [[ -x "$dist_dir/smolvm" && -x "$dist_dir/smolvm-bin" ]] || return 1
    [[ -d "$dist_dir/agent-rootfs" ]] || return 1
    [[ -f "$dist_dir/storage-template.ext4" && -f "$dist_dir/overlay-template.ext4" ]] || return 1
    [[ -f "$lib_dir/libkrun.so" && -f "$lib_dir/libkrunfw.so" ]] || return 1
    if patchelf --print-needed "$lib_dir/libkrun.so" | grep -q '^libvirglrenderer\.so\.1$'; then
        log "Distribution validation failed: libvirglrenderer is still a hard dependency."
        return 1
    fi
    ldd_output="$(LD_LIBRARY_PATH="$lib_dir" ldd "$lib_dir/libkrun.so" 2>&1)"
    if grep -q 'not found' <<<"$ldd_output"; then
        printf '%s\n' "$ldd_output" >&2
        return 1
    fi
    "$dist_dir/smolvm" --version >/dev/null
}

prepare_valid_distribution() {
    select_libraries
    build_agent_rootfs || error "The SmolVM agent rootfs build failed."
    build_distribution || error "The SmolVM distribution build failed."
    if validate_distribution; then
        return
    fi
    if [[ "$LIBKRUN_MODE" == "auto" ]] && [[ "$LIBKRUN_SOURCE_BUILT" == "false" ]]; then
        log "Bundled distribution failed host compatibility checks; retrying with source-built libraries."
        build_patched_libraries
        build_distribution || error "The SmolVM distribution rebuild failed."
        validate_distribution || error "Source-built distribution failed host compatibility checks."
        return
    fi
    error "The SmolVM distribution failed host compatibility checks."
}

install_distribution() {
    local dist_dir installed_version stage_dir
    dist_dir="$(distribution_dir)"
    installed_version="$("$dist_dir/smolvm-bin" --version)"
    stage_dir="${INSTALL_DIR}.tmp.$$"

    rm -rf "$stage_dir"
    mkdir -p "$stage_dir"
    cp -a "$dist_dir"/. "$stage_dir"/
    printf '%s\n' "$installed_version" > "$stage_dir/.version"
    verify_install_tree "$stage_dir"

    if [[ -d "$INSTALL_DIR" ]]; then
        BACKUP_DIR="${INSTALL_DIR}.backup.$(date +%Y%m%d_%H%M%S)"
        log "Backing up the current installation to $BACKUP_DIR ..."
        mv "$INSTALL_DIR" "$BACKUP_DIR"
    fi

    if ! mv "$stage_dir" "$INSTALL_DIR"; then
        [[ -z "$BACKUP_DIR" ]] || mv "$BACKUP_DIR" "$INSTALL_DIR"
        error "Could not activate the staged installation."
    fi

    if [[ "$MODIFY_PATH" == "true" ]]; then
        mkdir -p "$BIN_DIR"
        ln -sf "$INSTALL_DIR/smolvm" "$BIN_DIR/smolvm"
        log "Symlink created: $BIN_DIR/smolvm -> $INSTALL_DIR/smolvm"
    fi
}

verify_install_tree() {
    local install_root ldd_output
    install_root="$1"
    "$install_root/smolvm" --version >/dev/null
    ldd_output="$(LD_LIBRARY_PATH="$install_root/lib" ldd "$install_root/lib/libkrun.so" 2>&1)"
    if grep -q 'not found' <<<"$ldd_output"; then
        printf '%s\n' "$ldd_output" >&2
        return 1
    fi
}

verify_installation() {
    "$INSTALL_DIR/smolvm" --version
    verify_install_tree "$INSTALL_DIR" || error "Installed libkrun has unresolved dependencies."
    log "Installation verified at $INSTALL_DIR."
    [[ -z "$BACKUP_DIR" ]] || log "Previous installation retained at $BACKUP_DIR."
}

main() {
    parse_arguments "$@"
    check_requirements
    log "Target version: $SMOLVM_VERSION"
    log "libkrun mode: $LIBKRUN_MODE"
    clone_smolvm
    apply_local_patches
    rustup target add "$(host_arch)-unknown-linux-musl" >/dev/null
    prepare_valid_distribution
    install_distribution
    verify_installation
}

main "$@"
