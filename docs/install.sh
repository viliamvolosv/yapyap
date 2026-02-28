#!/bin/bash
set -euo pipefail

# YapYap Installer for macOS and Linux
# Usage: curl -fsSL --proto '=https' --tlsv1.2 https://viliamvolosv.github.io/yapyap/install.sh | bash

BOLD='\033[1m'
ACCENT='\033[38;2;0;188;255m'       # cyan-bright  #00bcff
ACCENT_BRIGHT='\033[38;2;0;220;255m' # lighter cyan
INFO='\033[38;2;136;146;176m'       # text-secondary #8892b0
SUCCESS='\033[38;2;0;229;204m'      # cyan-bright   #00e5cc
WARN='\033[38;2;255;176;32m'        # amber (no site equiv, keep warm)
ERROR='\033[38;2;230;57;70m'        # coral-mid     #e63946
MUTED='\033[38;2;90;100;128m'       # text-muted    #5a6480
NC='\033[0m' # No Color

DEFAULT_TAGLINE="Decentralized P2P messenger for Agents"

ORIGINAL_PATH="${PATH:-}"

TMPFILES=()
cleanup_tmpfiles() {
    local f
    for f in "${TMPFILES[@]:-}"; do
        rm -rf "$f" 2>/dev/null || true
    done
}
trap cleanup_tmpfiles EXIT

mktempfile() {
    local f
    if [[ "$(uname)" == "Darwin" ]]; then
        f="$(mktemp /tmp/tmp.XXXXXX)"
    else
        f="$(mktemp)"
    fi
    TMPFILES+=("$f")
    echo "$f"
}

DOWNLOADER=""
detect_downloader() {
    if command -v curl &> /dev/null; then
        DOWNLOADER="curl"
        return 0
    fi
    if command -v wget &> /dev/null; then
        DOWNLOADER="wget"
        return 0
    fi
    ui_error "Missing downloader (curl or wget required)"
    exit 1
}

download_file() {
    local url="$1"
    local output="$2"
    if [[ -z "$DOWNLOADER" ]]; then
        detect_downloader
    fi
    if [[ "$DOWNLOADER" == "curl" ]]; then
        curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 1 --retry-connrefused -o "$output" "$url"
        return
    fi
    wget -q --https-only --secure-protocol=TLSv1_2 --tries=3 --timeout=20 -O "$output" "$url"
}

run_remote_bash() {
    local url="$1"
    local tmp
    tmp="$(mktempfile)"
    download_file "$url" "$tmp"
    /bin/bash "$tmp"
}

GUM_VERSION="${YAPYAP_GUM_VERSION:-0.17.0}"
GUM=""
GUM_STATUS="skipped"
GUM_REASON=""

gum_is_tty() {
    if [[ -n "${NO_COLOR:-}" ]]; then
        return 1
    fi
    if [[ "${TERM:-dumb}" == "dumb" ]]; then
        return 1
    fi
    if [[ -t 1 && -t 2 ]]; then
        return 0
    fi
    if [[ -r /dev/tty && -w /dev/tty ]]; then
        return 0
    fi
    return 1
}

gum_detect_os() {
    case "$(uname -s 2>/dev/null || true)" in
        Darwin) echo "Darwin" ;;
        Linux) echo "Linux" ;;
        *) echo "unsupported" ;;
    esac
}

gum_detect_arch() {
    case "$(uname -m 2>/dev/null || true)" in
        x86_64|amd64) echo "x86_64" ;;
        arm64|aarch64) echo "arm64" ;;
        i386|i686) echo "i386" ;;
        armv7l|armv7) echo "armv7" ;;
        armv6l|armv6) echo "armv6" ;;
        *) echo "unknown" ;;
    esac
}

verify_sha256sum_file() {
    local checksums="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum --ignore-missing -c "$checksums" >/dev/null 2>&1
        return $?
    fi
    if command -v shasum >/dev/null 2>&1; then
        shasum -a 256 --ignore-missing -c "$checksums" >/dev/null 2>&1
        return $?
    fi
    return 1
}

bootstrap_gum_temp() {
    GUM=""
    GUM_STATUS="skipped"
    GUM_REASON=""

    case "$YAPYAP_USE_GUM" in
        0|false|False|FALSE|off|OFF|no|NO)
            GUM_REASON="disabled via YAPYAP_USE_GUM"
            return 1
            ;;
    esac

    if ! gum_is_tty; then
        GUM_REASON="not a TTY"
        return 1
    fi

    if command -v gum >/dev/null 2>&1; then
        GUM="gum"
        GUM_STATUS="found"
        GUM_REASON="already installed"
        return 0
    fi

    if [[ "$YAPYAP_USE_GUM" != "1" && "$YAPYAP_USE_GUM" != "true" && "$YAPYAP_USE_GUM" != "TRUE" ]]; then
        if [[ "$YAPYAP_USE_GUM" != "auto" ]]; then
            GUM_REASON="invalid YAPYAP_USE_GUM value: $YAPYAP_USE_GUM"
            return 1
        fi
    fi

    if ! command -v tar >/dev/null 2>&1; then
        GUM_REASON="tar not found"
        return 1
    fi

    local os arch asset base gum_tmpdir gum_path
    os="$(gum_detect_os)"
    arch="$(gum_detect_arch)"
    if [[ "$os" == "unsupported" || "$arch" == "unknown" ]]; then
        GUM_REASON="unsupported os/arch ($os/$arch)"
        return 1
    fi

    asset="gum_${GUM_VERSION}_${os}_${arch}.tar.gz"
    base="https://github.com/charmbracelet/gum/releases/download/v${GUM_VERSION}"

    gum_tmpdir="$(mktemp -d)"
    TMPFILES+=("$gum_tmpdir")

    if ! download_file "${base}/${asset}" "$gum_tmpdir/$asset"; then
        GUM_REASON="download failed"
        return 1
    fi

    if ! download_file "${base}/checksums.txt" "$gum_tmpdir/checksums.txt"; then
        GUM_REASON="checksum unavailable or failed"
        return 1
    fi

    if ! (cd "$gum_tmpdir" && verify_sha256sum_file "checksums.txt"); then
        GUM_REASON="checksum unavailable or failed"
        return 1
    fi

    if ! tar -xzf "$gum_tmpdir/$asset" -C "$gum_tmpdir" >/dev/null 2>&1; then
        GUM_REASON="extract failed"
        return 1
    fi

    gum_path="$(find "$gum_tmpdir" -type f -name gum 2>/dev/null | head -n1 || true)"
    if [[ -z "$gum_path" ]]; then
        GUM_REASON="gum binary missing after extract"
        return 1
    fi

    chmod +x "$gum_path" >/dev/null 2>&1 || true
    if [[ ! -x "$gum_path" ]]; then
        GUM_REASON="gum binary is not executable"
        return 1
    fi

    GUM="$gum_path"
    GUM_STATUS="installed"
    GUM_REASON="temp, verified"
    return 0
}

print_gum_status() {
    case "$GUM_STATUS" in
        found)
            ui_success "gum available (${GUM_REASON})"
            ;;
        installed)
            ui_success "gum bootstrapped (${GUM_REASON}, v${GUM_VERSION})"
            ;;
        *)
            if [[ -n "$GUM_REASON" ]]; then
                ui_info "gum skipped (${GUM_REASON})"
            fi
            ;;
    esac
}

print_installer_banner() {
    if [[ -n "$GUM" ]]; then
        local title tagline hint card
        title="$("$GUM" style --foreground "#00b8ff" --bold "YapYap Installer")"
        tagline="$("$GUM" style --foreground "#8892b0" "$TAGLINE")"
        hint="$("$GUM" style --foreground "#5a6480" "modern installer mode")"
        card="$(printf '%s\n%s\n%s' "$title" "$tagline" "$hint")"
        "$GUM" style --border rounded --border-foreground "#00b8ff" --padding "1 2" "$card"
        echo ""
        return
    fi

    echo -e "${ACCENT}${BOLD}"
    echo "  YapYap Installer"
    echo -e "${NC}${INFO}  ${TAGLINE}${NC}"
    echo ""
}

detect_os_or_die() {
    OS="unknown"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
    elif [[ "$OSTYPE" == "linux-gnu"* ]] || [[ -n "${WSL_DISTRO_NAME:-}" ]]; then
        OS="linux"
    fi

    if [[ "$OS" == "unknown" ]]; then
        ui_error "Unsupported operating system"
        echo "This installer supports macOS and Linux (including WSL)."
        echo "For Windows, use: iwr -useb https://raw.githubusercontent.com/viliamvolosv/yapyap/main/install.ps1 | iex"
        exit 1
    fi

    ui_success "Detected: $OS"
}

ui_info() {
    local msg="$*"
    if [[ -n "$GUM" ]]; then
        "$GUM" log --level info "$msg"
    else
        echo -e "${MUTED}·${NC} ${msg}"
    fi
}

ui_warn() {
    local msg="$*"
    if [[ -n "$GUM" ]]; then
        "$GUM" log --level warn "$msg"
    else
        echo -e "${WARN}!${NC} ${msg}"
    fi
}

ui_success() {
    local msg="$*"
    if [[ -n "$GUM" ]]; then
        local mark
        mark="$("$GUM" style --foreground "#00e5cc" --bold "✓")"
        echo "${mark} ${msg}"
    else
        echo -e "${SUCCESS}✓${NC} ${msg}"
    fi
}

ui_error() {
    local msg="$*"
    if [[ -n "$GUM" ]]; then
        "$GUM" log --level error "$msg"
    else
        echo -e "${ERROR}✗${NC} ${msg}"
    fi
}

INSTALL_STAGE_TOTAL=3
INSTALL_STAGE_CURRENT=0

ui_section() {
    local title="$1"
    if [[ -n "$GUM" ]]; then
        "$GUM" style --bold --foreground "#ff4d4d" --padding "1 0" "$title"
    else
        echo ""
        echo -e "${ACCENT}${BOLD}${title}${NC}"
    fi
}

ui_stage() {
    local title="$1"
    INSTALL_STAGE_CURRENT=$((INSTALL_STAGE_CURRENT + 1))
    ui_section "[${INSTALL_STAGE_CURRENT}/${INSTALL_STAGE_TOTAL}] ${title}"
}

ui_kv() {
    local key="$1"
    local value="$2"
    if [[ -n "$GUM" ]]; then
        local key_part value_part
        key_part="$("$GUM" style --foreground "#5a6480" --width 20 "$key")"
        value_part="$("$GUM" style --bold "$value")"
        "$GUM" join --horizontal "$key_part" "$value_part"
    else
        echo -e "${MUTED}${key}:${NC} ${value}"
    fi
}

ui_panel() {
    local content="$1"
    if [[ -n "$GUM" ]]; then
        "$GUM" style --border rounded --border-foreground "#5a6480" --padding "0 1" "$content"
    else
        echo "$content"
    fi
}

show_install_plan() {
    local detected_checkout="$1"

    ui_section "Install plan"
    ui_kv "OS" "$OS"
    ui_kv "Install method" "$INSTALL_METHOD"
    ui_kv "Requested version" "$YAPYAP_VERSION"
    if [[ "$USE_BETA" == "1" ]]; then
        ui_kv "Beta channel" "enabled"
    fi
    if [[ "$INSTALL_METHOD" == "git" ]]; then
        ui_kv "Git directory" "$GIT_DIR"
        ui_kv "Git update" "$GIT_UPDATE"
    fi
    if [[ -n "$detected_checkout" ]]; then
        ui_kv "Detected checkout" "$detected_checkout"
    fi
    if [[ "$DRY_RUN" == "1" ]]; then
        ui_kv "Dry run" "yes"
    fi
    if [[ "$NO_ONBOARD" == "1" ]]; then
        ui_kv "Onboarding" "skipped"
    fi
}

show_footer_links() {
    local faq_url="https://github.com/viliamvolosv/yapyap#readme"
    if [[ -n "$GUM" ]]; then
        local content
        content="$(printf '%s\n%s' "Need help?" "FAQ: ${faq_url}")"
        ui_panel "$content"
    else
        echo ""
        echo -e "FAQ: ${INFO}${faq_url}${NC}"
    fi
}

ui_celebrate() {
    local msg="$1"
    if [[ -n "$GUM" ]]; then
        "$GUM" style --bold --foreground "#00e5cc" "$msg"
    else
        echo -e "${SUCCESS}${BOLD}${msg}${NC}"
    fi
}

is_shell_function() {
    local name="${1:-}"
    [[ -n "$name" ]] && declare -F "$name" >/dev/null 2>&1
}

run_with_spinner() {
    local title="$1"
    shift

    if [[ -n "$GUM" ]] && gum_is_tty && ! is_shell_function "${1:-}"; then
        "$GUM" spin --spinner dot --title "$title" -- "$@"
        return $?
    fi

    "$@"
}

run_quiet_step() {
    local title="$1"
    shift

    if [[ "$VERBOSE" == "1" ]]; then
        run_with_spinner "$title" "$@"
        return $?
    fi

    local log
    log="$(mktempfile)"

    if [[ -n "$GUM" ]] && gum_is_tty && ! is_shell_function "${1:-}"; then
        local cmd_quoted=""
        local log_quoted=""
        printf -v cmd_quoted '%q ' "$@"
        printf -v log_quoted '%q' "$log"
        if run_with_spinner "$title" bash -c "${cmd_quoted}>${log_quoted} 2>&1"; then
            return 0
        fi
    else
        if "$@" >"$log" 2>&1; then
            return 0
        fi
    fi

    ui_error "${title} failed — re-run with --verbose for details"
    if [[ -s "$log" ]]; then
        tail -n 80 "$log" >&2 || true
    fi
    return 1
}

cleanup_legacy_submodules() {
    local repo_dir="$1"
    local legacy_dir="$repo_dir/Peekaboo"
    if [[ -d "$legacy_dir" ]]; then
        ui_info "Removing legacy submodule checkout: ${legacy_dir}"
        rm -rf "$legacy_dir"
    fi
}

cleanup_npm_yapyap_paths() {
    local npm_root=""
    npm_root="$(npm root -g 2>/dev/null || true)"
    if [[ -z "$npm_root" || "$npm_root" != *node_modules* ]]; then
        return 1
    fi
    rm -rf "$npm_root"/.yapyap-* "$npm_root"/yapyap 2>/dev/null || true
}

extract_yapyap_conflict_path() {
    local log="$1"
    local path=""
    path="$(sed -n 's/.*File exists: //p' "$log" | head -n1)"
    if [[ -z "$path" ]]; then
        path="$(sed -n 's/.*EEXIST: file already exists, //p' "$log" | head -n1)"
    fi
    if [[ -n "$path" ]]; then
        echo "$path"
        return 0
    fi
    return 1
}

cleanup_yapyap_bin_conflict() {
    local bin_path="$1"
    if [[ -z "$bin_path" || ( ! -e "$bin_path" && ! -L "$bin_path" ) ]]; then
        return 1
    fi
    local npm_bin=""
    npm_bin="$(npm_global_bin_dir 2>/dev/null || true)"
    if [[ -n "$npm_bin" && "$bin_path" != "$npm_bin/yapyap" ]]; then
        case "$bin_path" in
            "/opt/homebrew/bin/yapyap"|"/usr/local/bin/yapyap")
                ;;
            *)
                return 1
                ;;
        esac
    fi
    if [[ -L "$bin_path" ]]; then
        local target=""
        target="$(readlink "$bin_path" 2>/dev/null || true)"
        if [[ "$target" == *"/node_modules/yapyap/"* ]]; then
            rm -f "$bin_path"
            ui_info "Removed stale yapyap symlink at ${bin_path}"
            return 0
        fi
        return 1
    fi
    local backup=""
    backup="${bin_path}.bak-$(date +%Y%m%d-%H%M%S)"
    if mv "$bin_path" "$backup"; then
        ui_info "Moved existing yapyap binary to ${backup}"
        return 0
    fi
    return 1
}

npm_log_indicates_missing_build_tools() {
    local log="$1"
    if [[ -z "$log" || ! -f "$log" ]]; then
        return 1
    fi

    grep -Eiq "(not found: make|make: command not found|cmake: command not found|CMAKE_MAKE_PROGRAM is not set|Could not find CMAKE|gyp ERR! find Python|no developer tools were found|is not able to compile a simple test program|Failed to build llama\\.cpp|It seems that \"make\" is not installed in your system|It seems that the used \"cmake\" doesn't work properly)" "$log"
}

install_build_tools_linux() {
    require_sudo

    if command -v apt-get &> /dev/null; then
        if is_root; then
            run_quiet_step "Updating package index" apt-get update -qq
            run_quiet_step "Installing build tools" apt-get install -y -qq build-essential python3 make g++ cmake
        else
            run_quiet_step "Updating package index" sudo apt-get update -qq
            run_quiet_step "Installing build tools" sudo apt-get install -y -qq build-essential python3 make g++ cmake
        fi
        return 0
    fi

    if command -v dnf &> /dev/null; then
        if is_root; then
            run_quiet_step "Installing build tools" dnf install -y -q gcc gcc-c++ make cmake python3
        else
            run_quiet_step "Installing build tools" sudo dnf install -y -q gcc gcc-c++ make cmake python3
        fi
        return 0
    fi

    if command -v yum &> /dev/null; then
        if is_root; then
            run_quiet_step "Installing build tools" yum install -y -q gcc gcc-c++ make cmake python3
        else
            run_quiet_step "Installing build tools" sudo yum install -y -q gcc gcc-c++ make cmake python3
        fi
        return 0
    fi

    if command -v apk &> /dev/null; then
        if is_root; then
            run_quiet_step "Installing build tools" apk add --no-cache build-base python3 cmake
        else
            run_quiet_step "Installing build tools" sudo apk add --no-cache build-base python3 cmake
        fi
        return 0
    fi

    ui_warn "Could not detect package manager for auto-installing build tools"
    return 1
}

install_build_tools_macos() {
    local ok=true

    if ! xcode-select -p >/dev/null 2>&1; then
        ui_info "Installing Xcode Command Line Tools (required for make/clang)"
        xcode-select --install >/dev/null 2>&1 || true
        if ! xcode-select -p >/dev/null 2>&1; then
            ui_warn "Xcode Command Line Tools are not ready yet"
            ui_info "Complete the installer dialog, then re-run this installer"
            ok=false
        fi
    fi

    if ! command -v cmake >/dev/null 2>&1; then
        if command -v brew >/dev/null 2>&1; then
            run_quiet_step "Installing cmake" brew install cmake
        else
            ui_warn "Homebrew not available; cannot auto-install cmake"
            ok=false
        fi
    fi

    if ! command -v make >/dev/null 2>&1; then
        ui_warn "make is still unavailable"
        ok=false
    fi
    if ! command -v cmake >/dev/null 2>&1; then
        ui_warn "cmake is still unavailable"
        ok=false
    fi

    [[ "$ok" == "true" ]]
}

auto_install_build_tools_for_npm_failure() {
    local log="$1"
    if ! npm_log_indicates_missing_build_tools "$log"; then
        return 1
    fi

    ui_warn "Detected missing native build tools; attempting automatic setup"
    if [[ "$OS" == "linux" ]]; then
        install_build_tools_linux || return 1
    elif [[ "$OS" == "macos" ]]; then
        install_build_tools_macos || return 1
    else
        return 1
    fi
    ui_success "Build tools setup complete"
    return 0
}

run_npm_global_install() {
    local spec="$1"
    local log="$2"

    local -a cmd
    cmd=(env "SHARP_IGNORE_GLOBAL_LIBVIPS=$SHARP_IGNORE_GLOBAL_LIBVIPS" npm --loglevel "$NPM_LOGLEVEL")
    if [[ -n "$NPM_SILENT_FLAG" ]]; then
        cmd+=("$NPM_SILENT_FLAG")
    fi
    cmd+=(--no-fund --no-audit install -g "$spec")

    if [[ "$VERBOSE" == "1" ]]; then
        "${cmd[@]}" 2>&1 | tee "$log"
        return $?
    fi

    if [[ -n "$GUM" ]] && gum_is_tty; then
        local cmd_quoted=""
        local log_quoted=""
        printf -v cmd_quoted '%q ' "${cmd[@]}"
        printf -v log_quoted '%q' "$log"
        run_with_spinner "Installing YapYap package" bash -c "${cmd_quoted}>${log_quoted} 2>&1"
        return $?
    fi

    "${cmd[@]}" >"$log" 2>&1
}

install_yapyap_npm() {
    local spec="$1"
    local log
    log="$(mktempfile)"
    if ! run_npm_global_install "$spec" "$log"; then
        local attempted_build_tool_fix=false
        if auto_install_build_tools_for_npm_failure "$log"; then
            attempted_build_tool_fix=true
            ui_info "Retrying npm install after build tools setup"
            if run_npm_global_install "$spec" "$log"; then
                ui_success "YapYap npm package installed"
                return 0
            fi
        fi

        if [[ "$VERBOSE" != "1" ]]; then
            if [[ "$attempted_build_tool_fix" == "true" ]]; then
                ui_warn "npm install still failed after build tools setup; showing last log lines"
            else
                ui_warn "npm install failed; showing last log lines"
            fi
            tail -n 80 "$log" >&2 || true
        fi

        if grep -q "ENOTEMPTY: directory not empty, rename .*yapyap" "$log"; then
            ui_warn "npm left stale directory; cleaning and retrying"
            cleanup_npm_yapyap_paths
            if run_npm_global_install "$spec" "$log"; then
                ui_success "YapYap npm package installed"
                return 0
            fi
            return 1
        fi
        if grep -q "EEXIST" "$log"; then
            local conflict=""
            conflict="$(extract_yapyap_conflict_path "$log" || true)"
            if [[ -n "$conflict" ]] && cleanup_yapyap_bin_conflict "$conflict"; then
                if run_npm_global_install "$spec" "$log"; then
                    ui_success "YapYap npm package installed"
                    return 0
                fi
                return 1
            fi
            ui_error "npm failed because a yapyap binary already exists"
            if [[ -n "$conflict" ]]; then
                ui_info "Remove or move ${conflict}, then retry"
            fi
            ui_info "Or rerun with: npm install -g --force ${spec}"
        fi
        return 1
    fi
    ui_success "YapYap npm package installed"
    return 0
}

TAGLINES=()
TAGLINES+=("End-to-end encrypted messaging. No servers, no UI.")
TAGLINES+=("Your messages, your servers, your privacy.")
TAGLINES+=("P2P messaging that respects your autonomy.")
TAGLINES+=("Decentralized communication. Built for freedom.")
TAGLINES+=("Offline-first. E2E encrypted. Zero trust needed.")
TAGLINES+=("Your data, your device, your rules.")
TAGLINES+=("No middleman. Just direct connections.")
TAGLINES+=("Privacy by design. Security by default.")
TAGLINES+=("The messenger that doesn't need a company behind it.")
TAGLINES+=("Peer-to-peer, end-to-end encrypted, open source.")
TAGLINES+=("No servers required. Just direct connections.")
TAGLINES+=("Your messages never leave your control.")
TAGLINES+=("Simple. Secure. Decentralized.")
TAGLINES+=("P2P messaging for the post-surveillance era.")
TAGLINES+=("Privacy-focused, dependency-light, open-source.")
TAGLINES+=("Direct connections. No intermediaries.")
TAGLINES+=("End-to-end encryption built into the protocol.")
TAGLINES+=("Your chat, your way. No accounts required.")
TAGLINES+=("The future of messaging: decentralized and private.")

append_holiday_taglines() {
    local today
    local month_day
    today="$(date -u +%Y-%m-%d 2>/dev/null || date +%Y-%m-%d)"
    month_day="$(date -u +%m-%d 2>/dev/null || date +%m-%d)"

    case "$month_day" in
        "01-01") TAGLINES+=("New Year's: New year, new privacy. Same old surveillance, but you're ready.") ;;
        "02-14") TAGLINES+=("Valentine's Day: Private messages for private moments.") ;;
        "10-31") TAGLINES+=("Halloween: Beware of surveillance. Keep your data private.") ;;
        "12-25") TAGLINES+=("Christmas: Private connections for the holidays.") ;;
    esac
}

pick_tagline() {
    append_holiday_taglines
    local count=${#TAGLINES[@]}
    if [[ "$count" -eq 0 ]]; then
        echo "$DEFAULT_TAGLINE"
        return
    fi
    if [[ -n "${YAPYAP_TAGLINE_INDEX:-}" ]]; then
        if [[ "${YAPYAP_TAGLINE_INDEX}" =~ ^[0-9]+$ ]]; then
            local idx=$((YAPYAP_TAGLINE_INDEX % count))
            echo "${TAGLINES[$idx]}"
            return
        fi
    fi
    local idx=$((RANDOM % count))
    echo "${TAGLINES[$idx]}"
}

TAGLINE=$(pick_tagline)

NO_ONBOARD=${YAPYAP_NO_ONBOARD:-0}
NO_PROMPT=${YAPYAP_NO_PROMPT:-0}
DRY_RUN=${YAPYAP_DRY_RUN:-0}
INSTALL_METHOD=${YAPYAP_INSTALL_METHOD:-}
YAPYAP_VERSION=${YAPYAP_VERSION:-latest}
USE_BETA=${YAPYAP_BETA:-0}
GIT_DIR_DEFAULT="${HOME}/yapyap"
GIT_DIR=${YAPYAP_GIT_DIR:-$GIT_DIR_DEFAULT}
GIT_UPDATE=${YAPYAP_GIT_UPDATE:-1}
SHARP_IGNORE_GLOBAL_LIBVIPS="${SHARP_IGNORE_GLOBAL_LIBVIPS:-1}"
NPM_LOGLEVEL="${YAPYAP_NPM_LOGLEVEL:-error}"
NPM_SILENT_FLAG="--silent"
VERBOSE="${YAPYAP_VERBOSE:-0}"
YAPYAP_USE_GUM="${YAPYAP_USE_GUM:-auto}"
YAPYAP_BIN=""
PNPM_CMD=()
HELP=0

print_usage() {
    cat <<EOF
YapYap installer (macOS + Linux)

Usage:
  curl -fsSL --proto '=https' --tlsv1.2 https://raw.githubusercontent.com/viliamvolosv/yapyap/main/install.sh | bash

Options:
  --install-method, --method npm|git   Install via npm (default) or from a git checkout
  --npm                               Shortcut for --install-method npm
  --git, --github                     Shortcut for --install-method git
  --version <version|dist-tag>         npm install: version (default: latest)
  --beta                               Use beta if available, else latest
  --git-dir, --dir <path>             Checkout directory (default: ~/yapyap)
  --no-git-update                      Skip git pull for existing checkout
  --no-onboard                          Skip onboarding (non-interactive)
  --no-prompt                           Disable prompts (required in CI/automation)
  --dry-run                             Print what would happen (no changes)
  --verbose                             Print debug output (set -x, npm verbose)
  --gum                                 Force gum UI if possible
  --no-gum                              Disable gum UI
  --help, -h                            Show this help

Environment variables:
  YAPYAP_INSTALL_METHOD=git|npm
  YAPYAP_VERSION=latest|next|<semver>
  YAPYAP_BETA=0|1
  YAPYAP_GIT_DIR=...
  YAPYAP_GIT_UPDATE=0|1
  YAPYAP_NO_PROMPT=1
  YAPYAP_DRY_RUN=1
  YAPYAP_NO_ONBOARD=1
  YAPYAP_VERBOSE=1
  YAPYAP_USE_GUM=auto|1|0           Default: auto (try gum on interactive TTY)
  YAPYAP_NPM_LOGLEVEL=error|warn|notice  Default: error (hide npm deprecation noise)
  SHARP_IGNORE_GLOBAL_LIBVIPS=0|1    Default: 1 (avoid sharp building against global libvips)

Examples:
  curl -fsSL --proto '=https' --tlsv1.2 https://raw.githubusercontent.com/viliamvolosv/yapyap/main/install.sh | bash
  curl -fsSL --proto '=https' --tlsv1.2 https://raw.githubusercontent.com/viliamvolosv/yapyap/main/install.sh | bash -s -- --no-onboard
  curl -fsSL --proto '=https' --tlsv1.2 https://raw.githubusercontent.com/viliamvolosv/yapyap/main/install.sh | bash -s -- --install-method git --no-onboard
EOF
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --no-onboard)
                NO_ONBOARD=1
                shift
                ;;
            --onboard)
                NO_ONBOARD=0
                shift
                ;;
            --dry-run)
                DRY_RUN=1
                shift
                ;;
            --verbose)
                VERBOSE=1
                shift
                ;;
            --gum)
                YAPYAP_USE_GUM=1
                shift
                ;;
            --no-gum)
                YAPYAP_USE_GUM=0
                shift
                ;;
            --no-prompt)
                NO_PROMPT=1
                shift
                ;;
            --help|-h)
                HELP=1
                shift
                ;;
            --install-method|--method)
                INSTALL_METHOD="$2"
                shift 2
                ;;
            --version)
                YAPYAP_VERSION="$2"
                shift 2
                ;;
            --beta)
                USE_BETA=1
                shift
                ;;
            --npm)
                INSTALL_METHOD="npm"
                shift
                ;;
            --git|--github)
                INSTALL_METHOD="git"
                shift
                ;;
            --git-dir|--dir)
                GIT_DIR="$2"
                shift 2
                ;;
            --no-git-update)
                GIT_UPDATE=0
                shift
                ;;
            *)
                shift
                ;;
        esac
    done
}

configure_verbose() {
    if [[ "$VERBOSE" != "1" ]]; then
        return 0
    fi
    if [[ "$NPM_LOGLEVEL" == "error" ]]; then
        NPM_LOGLEVEL="notice"
    fi
    NPM_SILENT_FLAG=""
    set -x
}

is_promptable() {
    if [[ "$NO_PROMPT" == "1" ]]; then
        return 1
    fi
    if [[ -r /dev/tty && -w /dev/tty ]]; then
        return 0
    fi
    return 1
}

prompt_choice() {
    local prompt="$1"
    local answer=""
    if ! is_promptable; then
        return 1
    fi
    echo -e "$prompt" > /dev/tty
    read -r answer < /dev/tty || true
    echo "$answer"
}

choose_install_method_interactive() {
    local detected_checkout="$1"

    if ! is_promptable; then
        return 1
    fi

    if [[ -n "$GUM" ]] && gum_is_tty; then
        local header selection
        header="Detected YapYap checkout in: ${detected_checkout}
Choose install method"
        selection="$("$GUM" choose \
            --header "$header" \
            --cursor-prefix "❯ " \
            "git  · update this checkout and use it" \
            "npm  · install globally via npm" < /dev/tty || true)"

        case "$selection" in
            git*)
                echo "git"
                return 0
                ;;
            npm*)
                echo "npm"
                return 0
                ;;
        esac
        return 1
    fi

    local choice=""
    choice="$(prompt_choice "$(cat <<EOF
${WARN}→${NC} Detected a YapYap source checkout in: ${INFO}${detected_checkout}${NC}
Choose install method:
  1) Update this checkout (git) and use it
  2) Install global via npm (migrate away from git)
Enter 1 or 2:
EOF
)" || true)"

    case "$choice" in
        1)
            echo "git"
            return 0
            ;;
        2)
            echo "npm"
            return 0
            ;;
    esac

    return 1
}

detect_yapyap_checkout() {
    local dir="$1"
    if [[ ! -f "$dir/package.json" ]]; then
        return 1
    fi
    if ! grep -q '"name"[[:space:]]*:[[:space:]]*"yapyap"' "$dir/package.json" 2>/dev/null; then
        return 1
    fi
    echo "$dir"
    return 0
}

# Check for Homebrew on macOS
install_homebrew() {
    if [[ "$OS" == "macos" ]]; then
        if ! command -v brew &> /dev/null; then
            ui_info "Homebrew not found, installing"
            run_quiet_step "Installing Homebrew" run_remote_bash "https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh"

            # Add Homebrew to PATH for this session
            if [[ -f "/opt/homebrew/bin/brew" ]]; then
                eval "$(/opt/homebrew/bin/brew shellenv)"
            elif [[ -f "/usr/local/bin/brew" ]]; then
                eval "$(/usr/local/bin/brew shellenv)"
            fi
            ui_success "Homebrew installed"
        else
            ui_success "Homebrew already installed"
        fi
    fi
}

# Check Node.js version
check_node() {
    if command -v node &> /dev/null; then
        local NODE_MAJOR_VERSION
        NODE_MAJOR_VERSION=$(node -v | sed 's/^v\([0-9]*\).*/\1/')
        if [[ "$NODE_MAJOR_VERSION" -ge 22 ]]; then
            ui_success "Node.js v$(node -v | cut -d'v' -f2) found"
            return 0
        else
            ui_info "Node.js $(node -v) found, upgrading to v22+"
            return 1
        fi
    else
        ui_info "Node.js not found, installing it now"
        return 1
    fi
}

# Install Node.js
install_node() {
    if [[ "$OS" == "macos" ]]; then
        ui_info "Installing Node.js via Homebrew"
        run_quiet_step "Installing node@22" brew install node@22
        brew link node@22 --overwrite --force 2>/dev/null || true
        ui_success "Node.js installed"
    elif [[ "$OS" == "linux" ]]; then
        ui_info "Installing Node.js via NodeSource"
        require_sudo

        ui_info "Installing Linux build tools (make/g++/cmake/python3)"
        if install_build_tools_linux; then
            ui_success "Build tools installed"
        else
            ui_warn "Continuing without auto-installing build tools"
        fi

        if command -v apt-get &> /dev/null; then
            local tmp
            tmp="$(mktempfile)"
            download_file "https://deb.nodesource.com/setup_22.x" "$tmp"
            if is_root; then
                run_quiet_step "Configuring NodeSource repository" bash "$tmp"
                run_quiet_step "Installing Node.js" apt-get install -y -qq nodejs
            else
                run_quiet_step "Configuring NodeSource repository" sudo -E bash "$tmp"
                run_quiet_step "Installing Node.js" sudo apt-get install -y -qq nodejs
            fi
        elif command -v dnf &> /dev/null; then
            local tmp
            tmp="$(mktempfile)"
            download_file "https://rpm.nodesource.com/setup_22.x" "$tmp"
            if is_root; then
                run_quiet_step "Configuring NodeSource repository" bash "$tmp"
                run_quiet_step "Installing Node.js" dnf install -y -q nodejs
            else
                run_quiet_step "Configuring NodeSource repository" sudo bash "$tmp"
                run_quiet_step "Installing Node.js" sudo dnf install -y -q nodejs
            fi
        elif command -v yum &> /dev/null; then
            local tmp
            tmp="$(mktempfile)"
            download_file "https://rpm.nodesource.com/setup_22.x" "$tmp"
            if is_root; then
                run_quiet_step "Configuring NodeSource repository" bash "$tmp"
                run_quiet_step "Installing Node.js" yum install -y -q nodejs
            else
                run_quiet_step "Configuring NodeSource repository" sudo bash "$tmp"
                run_quiet_step "Installing Node.js" sudo yum install -y -q nodejs
            fi
        else
            ui_error "Could not detect package manager"
            echo "Please install Node.js 22+ manually: https://nodejs.org"
            exit 1
        fi

        ui_success "Node.js v22 installed"
    fi
}

# Check Git
check_git() {
    if command -v git &> /dev/null; then
        ui_success "Git already installed"
        return 0
    fi
    ui_info "Git not found, installing it now"
    return 1
}

is_root() {
    [[ "$(id -u)" -eq 0 ]]
}

# Run a command with sudo only if not already root
maybe_sudo() {
    if is_root; then
        # Skip -E flag when root (env is already preserved)
        if [[ "${1:-}" == "-E" ]]; then
            shift
        fi
        "$@"
    else
        sudo "$@"
    fi
}

require_sudo() {
    if [[ "$OS" != "linux" ]]; then
        return 0
    fi
    if is_root; then
        return 0
    fi
    if command -v sudo &> /dev/null; then
        if ! sudo -n true >/dev/null 2>&1; then
            ui_info "Administrator privileges required; enter your password"
            sudo -v
        fi
        return 0
    fi
    ui_error "sudo is required for system installs on Linux"
    echo "  Install sudo or re-run as root."
    exit 1
}

install_git() {
    if [[ "$OS" == "macos" ]]; then
        run_quiet_step "Installing Git" brew install git
    elif [[ "$OS" == "linux" ]]; then
        require_sudo
        if command -v apt-get &> /dev/null; then
            if is_root; then
                run_quiet_step "Updating package index" apt-get update -qq
                run_quiet_step "Installing Git" apt-get install -y -qq git
            else
                run_quiet_step "Updating package index" sudo apt-get update -qq
                run_quiet_step "Installing Git" sudo apt-get install -y -qq git
            fi
        elif command -v dnf &> /dev/null; then
            if is_root; then
                run_quiet_step "Installing Git" dnf install -y -q git
            else
                run_quiet_step "Installing Git" sudo dnf install -y -q git
            fi
        elif command -v yum &> /dev/null; then
            if is_root; then
                run_quiet_step "Installing Git" yum install -y -q git
            else
                run_quiet_step "Installing Git" sudo yum install -y -q git
            fi
        else
            ui_error "Could not detect package manager for Git"
            exit 1
        fi
    fi
    ui_success "Git installed"
}

# Fix npm permissions for global installs (Linux)
fix_npm_permissions() {
    if [[ "$OS" != "linux" ]]; then
        return 0
    fi

    local npm_prefix
    npm_prefix="$(npm config get prefix 2>/dev/null || true)"
    if [[ -z "$npm_prefix" ]]; then
        return 0
    fi

    local needs_setup=false
    local npm_global_dir="$HOME/.npm-global"

    # Check if npm prefix is system-wide (not writable by user)
    if [[ ! -w "$npm_prefix" && ! -w "$npm_prefix/lib" ]]; then
        needs_setup=true
        ui_info "Configuring npm for user-local installs"
        mkdir -p "$npm_global_dir"
        npm config set prefix "$npm_global_dir"
    fi

    # If using user-local npm directory, ensure PATH is in shell rc files
    if [[ "$npm_prefix" == "$HOME/.npm-global"* ]] || [[ "$needs_setup" == "true" ]]; then
        # shellcheck disable=SC2016
        local path_line='export PATH="$HOME/.npm-global/bin:$PATH"'
        for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
            if [[ -f "$rc" ]] && ! grep -q ".npm-global" "$rc"; then
                echo "$path_line" >> "$rc"
                ui_info "Added npm bin to $rc"
            fi
        done

        export PATH="$HOME/.npm-global/bin:$PATH"
        ui_success "npm configured for user installs"
    fi
}

ensure_yapyap_bin_link() {
    local npm_root=""
    npm_root="$(npm root -g 2>/dev/null || true)"
    if [[ -z "$npm_root" || ! -d "$npm_root/yapyap" ]]; then
        return 1
    fi
    local npm_bin=""
    npm_bin="$(npm_global_bin_dir || true)"
    if [[ -z "$npm_bin" ]]; then
        return 1
    fi
    mkdir -p "$npm_bin"
    if [[ ! -x "${npm_bin}/yapyap" ]]; then
        ln -sf "$npm_root/yapyap/dist/cli.js" "${npm_bin}/yapyap"
        ui_info "Created yapyap bin link at ${npm_bin}/yapyap"
    fi
    return 0
}

# Check for existing YapYap installation
check_existing_yapyap() {
    if [[ -n "$(type -P yapyap 2>/dev/null || true)" ]]; then
        ui_info "Existing YapYap installation detected, upgrading"
        return 0
    fi
    return 1
}

set_pnpm_cmd() {
    PNPM_CMD=("$@")
}

pnpm_cmd_pretty() {
    if [[ ${#PNPM_CMD[@]} -eq 0 ]]; then
        echo ""
        return 1
    fi
    printf '%s' "${PNPM_CMD[*]}"
    return 0
}

pnpm_cmd_is_ready() {
    if [[ ${#PNPM_CMD[@]} -eq 0 ]]; then
        return 1
    fi
    "${PNPM_CMD[@]}" --version >/dev/null 2>&1
}

detect_pnpm_cmd() {
    if command -v pnpm &> /dev/null; then
        set_pnpm_cmd pnpm
        return 0
    fi
    if command -v corepack &> /dev/null; then
        if corepack pnpm --version >/dev/null 2>&1; then
            set_pnpm_cmd corepack pnpm
            return 0
        fi
    fi
    return 1
}

ensure_pnpm() {
    if detect_pnpm_cmd && pnpm_cmd_is_ready; then
        ui_success "pnpm ready ($(pnpm_cmd_pretty))"
        return 0
    fi

    if command -v corepack &> /dev/null; then
        ui_info "Configuring pnpm via Corepack"
        corepack enable >/dev/null 2>&1 || true
        if ! run_quiet_step "Activating pnpm" corepack prepare pnpm@10 --activate; then
            ui_warn "Corepack pnpm activation failed; falling back"
        fi
        refresh_shell_command_cache
        if detect_pnpm_cmd && pnpm_cmd_is_ready; then
            if [[ "${PNPM_CMD[*]}" == "corepack pnpm" ]]; then
                ui_warn "pnpm shim not on PATH; using corepack pnpm fallback"
            fi
            ui_success "pnpm ready ($(pnpm_cmd_pretty))"
            return 0
        fi
    fi

    ui_info "Installing pnpm via npm"
    fix_npm_permissions
    run_quiet_step "Installing pnpm" npm install -g pnpm@10
    refresh_shell_command_cache
    if detect_pnpm_cmd && pnpm_cmd_is_ready; then
        ui_success "pnpm ready ($(pnpm_cmd_pretty))"
        return 0
    fi

    ui_error "pnpm installation failed"
    return 1
}

ensure_pnpm_binary_for_scripts() {
    if command -v pnpm >/dev/null 2>&1; then
        return 0
    fi

    if command -v corepack >/dev/null 2>&1; then
        ui_info "Ensuring pnpm command is available"
        corepack enable >/dev/null 2>&1 || true
        corepack prepare pnpm@10 --activate >/dev/null 2>&1 || true
        refresh_shell_command_cache
        if command -v pnpm >/dev/null 2>&1; then
            ui_success "pnpm command enabled via Corepack"
            return 0
        fi
    fi

    if [[ "${PNPM_CMD[*]}" == "corepack pnpm" ]] && command -v corepack >/dev/null 2>&1; then
        ensure_user_local_bin_on_path
        local user_pnpm="${HOME}/.local/bin/pnpm"
        cat >"${user_pnpm}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exec corepack pnpm "$@"
EOF
        chmod +x "${user_pnpm}"
        refresh_shell_command_cache

        if command -v pnpm >/dev/null 2>&1; then
            ui_warn "pnpm shim not on PATH; installed user-local wrapper at ${user_pnpm}"
            return 0
        fi
    fi

    ui_error "pnpm command not available on PATH"
    ui_info "Install pnpm globally (npm install -g pnpm@10) and retry"
    return 1
}

run_pnpm() {
    if ! pnpm_cmd_is_ready; then
        ensure_pnpm
    fi
    "${PNPM_CMD[@]}" "$@"
}

run_doctor() {
    warn_yapyap_not_found
    return 0
    ui_info "Running doctor to migrate settings"
    local yapyap="${YAPYAP_BIN:-}"
    if [[ -z "$yapyap" ]]; then
        yapyap="$(resolve_yapyap_bin || true)"
    fi
    if [[ -z "$yapyap" ]]; then
        ui_info "Skipping doctor (yapyap not on PATH yet)"
        warn_yapyap_not_found
        return 0
    fi
    run_quiet_step "Running doctor" "$yapyap" doctor --non-interactive || true
    ui_success "Doctor complete"
}

ensure_user_local_bin_on_path() {
    local target="$HOME/.local/bin"
    mkdir -p "$target"

    export PATH="$target:$PATH"

    # shellcheck disable=SC2016
    local path_line='export PATH="$HOME/.local/bin:$PATH"'
    for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
        if [[ -f "$rc" ]] && ! grep -q ".local/bin" "$rc"; then
            echo "$path_line" >> "$rc"
        fi
    done
}

npm_global_bin_dir() {
    local prefix
    prefix="$(npm prefix -g 2>/dev/null || true)"
    if [[ -n "$prefix" && "$prefix" == /* ]]; then
        echo "${prefix%/}/bin"
        return 0
    fi
    prefix="$(npm config get prefix 2>/dev/null || true)"
    if [[ -n "$prefix" && "$prefix" == /* ]]; then
        echo "${prefix%/}/bin"
        return 0
    fi
    echo ""
    return 1
}

refresh_shell_command_cache() {
    hash -r 2>/dev/null || true
}

path_has_dir() {
    local path="$1"
    local dir="${2%/}"
    if [[ -z "$dir" ]]; then
        return 1
    fi
    case ":${path}:" in
        *":${dir}:"*) return 0 ;;
        *) return 1 ;;
    esac
}

warn_shell_path_missing_dir() {
    local dir="${1%/}"
    local label="$2"
    if [[ -z "$dir" ]]; then
        return 0
    fi
    if path_has_dir "$ORIGINAL_PATH" "$dir"; then
        return 0
    fi

    echo ""
    ui_warn "PATH missing ${label}: ${dir}"
    echo "  This can make yapyap show as \"command not found\" in new terminals."
    echo "  Fix (zsh: ~/.zshrc, bash: ~/.bashrc):"
    echo "    export PATH=\"${dir}:\$PATH\""
}

ensure_npm_global_bin_on_path() {
    local bin_dir=""
    bin_dir="$(npm_global_bin_dir || true)"
    if [[ -n "$bin_dir" ]]; then
        export PATH="${bin_dir}:$PATH"
    fi
}

maybe_nodenv_rehash() {
    if command -v nodenv &> /dev/null; then
        nodenv rehash >/dev/null 2>&1 || true
    fi
}

warn_yapyap_not_found() {
    ui_warn "Installed, but yapyap is not discoverable on PATH in this shell"
    echo "  Try: hash -r (bash) or rehash (zsh), then retry."
    local t=""
    t="$(type -t yapyap 2>/dev/null || true)"
    if [[ "$t" == "alias" || "$t" == "function" ]]; then
        ui_warn "Found a shell ${t} named yapyap; it may shadow the real binary"
    fi
    if command -v nodenv &> /dev/null; then
        echo -e "Using nodenv? Run: ${INFO}nodenv rehash${NC}"
    fi

    local npm_prefix=""
    npm_prefix="$(npm prefix -g 2>/dev/null || true)"
    local npm_bin=""
    npm_bin="$(npm_global_bin_dir 2>/dev/null || true)"
    if [[ -n "$npm_prefix" ]]; then
        echo -e "npm prefix -g: ${INFO}${npm_prefix}${NC}"
    fi
    if [[ -n "$npm_bin" ]]; then
        echo -e "npm bin -g: ${INFO}${npm_bin}${NC}"
        echo -e "If needed: ${INFO}export PATH=\"${npm_bin}:\$PATH\"${NC}"
    fi
}

resolve_yapyap_bin() {
    refresh_shell_command_cache
    local resolved=""
    resolved="$(type -P yapyap 2>/dev/null || true)"
    if [[ -n "$resolved" && -x "$resolved" ]]; then
        echo "$resolved"
        return 0
    fi

    ensure_npm_global_bin_on_path
    refresh_shell_command_cache
    resolved="$(type -P yapyap 2>/dev/null || true)"
    if [[ -n "$resolved" && -x "$resolved" ]]; then
        echo "$resolved"
        return 0
    fi

    local npm_bin=""
    npm_bin="$(npm_global_bin_dir || true)"
    if [[ -n "$npm_bin" && -x "${npm_bin}/yapyap" ]]; then
        echo "${npm_bin}/yapyap"
        return 0
    fi

    maybe_nodenv_rehash
    refresh_shell_command_cache
    resolved="$(type -P yapyap 2>/dev/null || true)"
    if [[ -n "$resolved" && -x "$resolved" ]]; then
        echo "$resolved"
        return 0
    fi

    if [[ -n "$npm_bin" && -x "${npm_bin}/yapyap" ]]; then
        echo "${npm_bin}/yapyap"
        return 0
    fi

    echo ""
    return 1
}

install_yapyap_from_git() {
    local repo_dir="$1"
    local repo_url="https://github.com/viliamvolosv/yapyap.git"

    if [[ -d "$repo_dir/.git" ]]; then
        ui_info "Installing YapYap from git checkout: ${repo_dir}"
    else
        ui_info "Installing YapYap from GitHub (${repo_url})"
    fi

    if ! check_git; then
        install_git
    fi

    ensure_pnpm
    ensure_pnpm_binary_for_scripts

    if [[ ! -d "$repo_dir" ]]; then
        run_quiet_step "Cloning YapYap" git clone "$repo_url" "$repo_dir"
    fi

    if [[ "$GIT_UPDATE" == "1" ]]; then
        if [[ -z "$(git -C "$repo_dir" status --porcelain 2>/dev/null || true)" ]]; then
            run_quiet_step "Updating repository" git -C "$repo_dir" pull --rebase || true
        else
            ui_info "Repo has local changes; skipping git pull"
        fi
    fi

    cleanup_legacy_submodules "$repo_dir"

    SHARP_IGNORE_GLOBAL_LIBVIPS="$SHARP_IGNORE_GLOBAL_LIBVIPS" run_quiet_step "Installing dependencies" run_pnpm -C "$repo_dir" install

    if ! run_quiet_step "Building YapYap" run_pnpm -C "$repo_dir" build; then
        ui_warn "Build failed; continuing (CLI may still work)"
    fi

    ensure_user_local_bin_on_path

    cat > "$HOME/.local/bin/yapyap" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec node "${repo_dir}/dist/cli.js" "\$@"
EOF
    chmod +x "$HOME/.local/bin/yapyap"
    ui_success "YapYap wrapper installed to \$HOME/.local/bin/yapyap"
    ui_info "This checkout uses pnpm — run pnpm install (or corepack pnpm install) for deps"
}

# Install YapYap
resolve_beta_version() {
    local beta=""
    beta="$(npm view yapyap dist-tags.beta 2>/dev/null || true)"
    if [[ -z "$beta" || "$beta" == "undefined" || "$beta" == "null" ]]; then
        return 1
    fi
    echo "$beta"
}

install_yapyap() {
    local package_name="yapyap"
    if [[ "$USE_BETA" == "1" ]]; then
        local beta_version=""
        beta_version="$(resolve_beta_version || true)"
        if [[ -n "$beta_version" ]]; then
            YAPYAP_VERSION="$beta_version"
            ui_info "Beta tag detected (${beta_version})"
            package_name="yapyap"
        else
            YAPYAP_VERSION="latest"
            ui_info "No beta tag found; using latest"
        fi
    fi

    if [[ -z "${YAPYAP_VERSION}" ]]; then
        YAPYAP_VERSION="latest"
    fi

    local resolved_version=""
    resolved_version="$(npm view "${package_name}@${YAPYAP_VERSION}" version 2>/dev/null || true)"
    if [[ -n "$resolved_version" ]]; then
        ui_info "Installing YapYap v${resolved_version}"
    else
        ui_info "Installing YapYap (${YAPYAP_VERSION})"
    fi
    local install_spec=""
    if [[ "${YAPYAP_VERSION}" == "latest" ]]; then
        install_spec="${package_name}@latest"
    else
        install_spec="${package_name}@${YAPYAP_VERSION}"
    fi

    if ! install_yapyap_npm "${install_spec}"; then
        ui_warn "npm install failed; retrying"
        cleanup_npm_yapyap_paths
        install_yapyap_npm "${install_spec}"
    fi

    if [[ "${YAPYAP_VERSION}" == "latest" && "${package_name}" == "yapyap" ]]; then
        if ! resolve_yapyap_bin &> /dev/null; then
            ui_warn "npm install yapyap@latest failed; retrying yapyap@next"
            cleanup_npm_yapyap_paths
            install_yapyap_npm "yapyap@next"
        fi
    fi

    ensure_yapyap_bin_link || true

    # Add npm global bin to PATH for the current session
    ensure_npm_global_bin_on_path
    refresh_shell_command_cache

    # Also persist PATH to shell rc files for future sessions
    local npm_bin=""
    npm_bin="$(npm_global_bin_dir || true)"
    if [[ -n "$npm_bin" && "$INSTALL_METHOD" == "npm" ]]; then
        # shellcheck disable=SC2016
        local path_line='export PATH="$HOME/.npm-global/bin:$PATH"'
        if [[ "$npm_bin" == "$HOME/.npm-global/bin" ]]; then
            for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
                if [[ -f "$rc" ]] && ! grep -q ".npm-global" "$rc"; then
                    echo "$path_line" >> "$rc"
                    ui_info "Added npm bin to $rc"
                fi
            done
        fi
    fi

    ui_success "YapYap installed"
}

# Main installation flow
main() {
    if [[ "$HELP" == "1" ]]; then
        print_usage
        return 0
    fi

    bootstrap_gum_temp || true
    print_installer_banner
    print_gum_status
    detect_os_or_die

    local detected_checkout=""
    detected_checkout="$(detect_yapyap_checkout "$PWD" || true)"

    if [[ -z "$INSTALL_METHOD" && -n "$detected_checkout" ]]; then
        if ! is_promptable; then
            ui_info "Found YapYap checkout but no TTY; defaulting to npm install"
            INSTALL_METHOD="npm"
        else
            local selected_method=""
            selected_method="$(choose_install_method_interactive "$detected_checkout" || true)"
            case "$selected_method" in
                git|npm)
                    INSTALL_METHOD="$selected_method"
                    ;;
                *)
                    ui_error "no install method selected"
                    echo "Re-run with: --install-method git|npm (or set YAPYAP_INSTALL_METHOD)."
                    exit 2
                    ;;
            esac
        fi
    fi

    if [[ -z "$INSTALL_METHOD" ]]; then
        INSTALL_METHOD="npm"
    fi

    if [[ "$INSTALL_METHOD" != "npm" && "$INSTALL_METHOD" != "git" ]]; then
        ui_error "invalid --install-method: ${INSTALL_METHOD}"
        echo "Use: --install-method npm|git"
        exit 2
    fi

    show_install_plan "$detected_checkout"

    if [[ "$DRY_RUN" == "1" ]]; then
        ui_success "Dry run complete (no changes made)"
        return 0
    fi

    # Check for existing installation
    local is_upgrade=false
    if check_existing_yapyap; then
        is_upgrade=true
    fi

    ui_stage "Preparing environment"

    # Step 1: Homebrew (macOS only)
    install_homebrew

    # Step 2: Node.js
    if ! check_node; then
        install_node
    fi

    ui_stage "Installing YapYap"

    local final_git_dir=""
    if [[ "$INSTALL_METHOD" == "git" ]]; then
        # Clean up npm global install if switching to git
        if npm list -g yapyap &>/dev/null; then
            ui_info "Removing npm global install (switching to git)"
            npm uninstall -g yapyap 2>/dev/null || true
            ui_success "npm global install removed"
        fi

        local repo_dir="$GIT_DIR"
        if [[ -n "$detected_checkout" ]]; then
            repo_dir="$detected_checkout"
        fi
        final_git_dir="$repo_dir"
        install_yapyap_from_git "$repo_dir"
    else
        # Clean up git wrapper if switching to npm
        if [[ -x "$HOME/.local/bin/yapyap" ]]; then
            ui_info "Removing git wrapper (switching to npm)"
            rm -f "$HOME/.local/bin/yapyap"
            ui_success "git wrapper removed"
        fi

        # Step 3: Git (required for npm installs that may fetch from git or apply patches)
        if ! check_git; then
            install_git
        fi

        # Step 4: npm permissions (Linux)
        fix_npm_permissions

        # Step 5: YapYap
        install_yapyap
    fi

    ui_stage "Finalizing setup"

    YAPYAP_BIN="$(resolve_yapyap_bin || true)"

    # PATH warning for npm installs: the PATH export in this script runs in a subshell
    # (due to curl | bash), so it won't persist in the user's shell. We need to show
    # instructions even if yapyap was found during the script execution.
    local npm_bin=""
    npm_bin="$(npm_global_bin_dir || true)"
    if [[ "$INSTALL_METHOD" == "npm" && -n "$npm_bin" ]]; then
        # Check if npm_bin is in ORIGINAL_PATH (user's shell PATH before script ran)
        if ! path_has_dir "$ORIGINAL_PATH" "$npm_bin"; then
            echo ""
            ui_warn "PATH missing npm global bin dir: ${npm_bin}"
            echo "  This can make yapyap show as \"command not found\" in new terminals."
            echo "  Fix (add to ~/.bashrc or ~/.zshrc):"
            echo "    export PATH=\"${npm_bin}:\$PATH\""
            echo ""
            echo "  For this session, run:"
            echo "    export PATH=\"${npm_bin}:\$PATH\""
            echo "    hash -r  # Clear command cache (bash)"
        fi
    fi
    if [[ "$INSTALL_METHOD" == "git" ]]; then
        if [[ -x "$HOME/.local/bin/yapyap" ]]; then
            warn_shell_path_missing_dir "$HOME/.local/bin" "user-local bin dir (~/.local/bin)"
        fi
    fi

    # Step 6: Run doctor for migrations on upgrades and git installs
    local run_doctor_after=false
    if [[ "$is_upgrade" == "true" || "$INSTALL_METHOD" == "git" ]]; then
        run_doctor_after=true
    fi
    #if [[ "$run_doctor_after" == "true" ]]; then
       # run_doctor
   # fi

    local installed_version
    installed_version=$(resolve_yapyap_version)

    echo ""
    if [[ -n "$installed_version" ]]; then
        ui_celebrate "YapYap installed successfully (${installed_version})!"
    else
        ui_celebrate "YapYap installed successfully!"
    fi
    if [[ "$is_upgrade" == "true" ]]; then
        local update_messages=(
            "Leveled up! New features unlocked. You're welcome."
            "Fresh code, same YapYap. Miss me?"
            "Back and better. Did you even notice I was gone?"
            "Update complete. I learned some new tricks while I was out."
            "Upgraded! Now with 23% more privacy."
            "I've evolved. Try to keep up. 🦞"
            "New version, who dis? Oh right, still me but shinier."
            "Patched, polished, and ready to chat. Let's go."
            "The YapYap has molted. Harder shell, sharper claws."
            "Update done! Check the changelog or just trust me, it's good."
            "Reborn from the boiling waters of npm. Stronger now."
            "I went away and came back smarter. You should try it sometime."
            "Update complete. The bugs feared me, so they left."
            "New version installed. Old version sends its regards."
            "Firmware fresh. Brain wrinkles: increased."
            "I've seen things you wouldn't believe. Anyway, I'm updated."
            "Back online. The changelog is long but our friendship is longer."
            "Upgraded! Privacy features unlocked. Blame me if it breaks."
            "Molting complete. Please don't look at my soft shell phase."
            "Version bump! Same chaos energy, fewer crashes (probably)."
        )
        local update_message
        update_message="${update_messages[RANDOM % ${#update_messages[@]}]}"
        echo -e "${MUTED}${update_message}${NC}"
    else
        local completion_messages=(
            "Ahh nice, I like it here. Got any chats to start?"
            "Home sweet home. Don't worry, I won't rearrange your messages."
            "I'm in. Let's start some private conversations."
            "Installation complete. Your messages are now safer."
            "Settled in. Time to connect with your friends privately."
            "Cozy. I've already read your libp2p config. We need to talk."
            "Finally unpacked. Now point me at your contacts."
            "cracks claws Alright, what are we messaging about?"
            "The YapYap has landed. Your privacy is now protected."
            "All done! I promise to keep your messages encrypted."
        )
        local completion_message
        completion_message="${completion_messages[RANDOM % ${#completion_messages[@]}]}"
        echo -e "${MUTED}${completion_message}${NC}"
    fi
    echo ""

    if [[ "$INSTALL_METHOD" == "git" && -n "$final_git_dir" ]]; then
        ui_section "Source install details"
        ui_kv "Checkout" "$final_git_dir"
        ui_kv "Wrapper" "$HOME/.local/bin/yapyap"
        ui_kv "Update command" "yapyap update --restart"
        ui_kv "Switch to npm" "curl -fsSL --proto '=https' --tlsv1.2 https://raw.githubusercontent.com/viliamvolosv/yapyap/main/install.sh | bash -s -- --install-method npm"
    elif [[ "$is_upgrade" == "true" ]]; then
        ui_info "Upgrade complete"
        ui_info "Run: yapyap --help to get started"
    else
        ui_info "Run: yapyap --help to get started"
    fi

    show_footer_links
}

resolve_yapyap_version() {
    local version=""
    local yapyap="${YAPYAP_BIN:-}"
    if [[ -z "$yapyap" ]] && command -v yapyap &> /dev/null; then
        yapyap="$(command -v yapyap)"
    fi
    if [[ -n "$yapyap" ]]; then
        version=$("$yapyap" --version 2>/dev/null | head -n 1 | tr -d '\r')
    fi
    if [[ -z "$version" ]]; then
        local npm_root=""
        npm_root=$(npm root -g 2>/dev/null || true)
        if [[ -n "$npm_root" && -f "$npm_root/yapyap/package.json" ]]; then
            version=$(node -e "console.log(require('${npm_root}/yapyap/package.json').version)" 2>/dev/null || true)
        fi
    fi
    echo "$version"
}

if [[ "${YAPYAP_INSTALL_SH_NO_RUN:-0}" != "1" ]]; then
    parse_args "$@"
    configure_verbose
    main
fi