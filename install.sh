#!/bin/sh
set -eu

VERSION="${RIL_VERSION:-0.2.1}"
INSTALL_DIR="${RIL_INSTALL_DIR:-$HOME/.local/bin}"
REPO="retvest/ril"

OS=$(uname -s)
ARCH=$(uname -m)

case "${OS}/${ARCH}" in
  Darwin/arm64|Darwin/aarch64)
    TARGET="aarch64-apple-darwin"
    ;;
  Linux/x86_64|Linux/amd64)
    TARGET="x86_64-unknown-linux-gnu"
    ;;
  Linux/aarch64|Linux/arm64)
    TARGET="aarch64-unknown-linux-gnu"
    ;;
  *)
    echo "Unsupported platform: ${OS}/${ARCH}." >&2
    echo "Supported targets: macOS arm64, Linux x86_64, Linux arm64 (and Windows x86_64 via install.ps1)." >&2
    exit 1
    ;;
esac

ARCHIVE="ril-${VERSION}-${TARGET}.tar.gz"
BASE_URL="https://github.com/${REPO}/releases/download/v${VERSION}"
TMPDIR_INSTALL=$(mktemp -d)
trap 'rm -rf "$TMPDIR_INSTALL"' EXIT INT TERM

echo "Downloading RIL v${VERSION} (${TARGET})..."
curl -fsSL "${BASE_URL}/${ARCHIVE}" -o "${TMPDIR_INSTALL}/${ARCHIVE}"
curl -fsSL "${BASE_URL}/SHA256SUMS.txt" -o "${TMPDIR_INSTALL}/SHA256SUMS.txt"

echo "Verifying SHA-256 checksum..."
(
  cd "$TMPDIR_INSTALL"
  EXPECTED=$(awk -v f="$ARCHIVE" '$2 == f { print $1 }' SHA256SUMS.txt)
  if [ -z "$EXPECTED" ]; then
    echo "Checksum entry for ${ARCHIVE} missing from SHA256SUMS.txt." >&2
    exit 1
  fi
  if command -v shasum >/dev/null 2>&1; then
    ACTUAL=$(shasum -a 256 "$ARCHIVE" | awk '{ print $1 }')
  elif command -v sha256sum >/dev/null 2>&1; then
    ACTUAL=$(sha256sum "$ARCHIVE" | awk '{ print $1 }')
  else
    echo "Neither shasum nor sha256sum found; refusing unverified install." >&2
    exit 1
  fi
  if [ "$ACTUAL" != "$EXPECTED" ]; then
    echo "SHA-256 mismatch for ${ARCHIVE}." >&2
    exit 1
  fi
)

mkdir -p "$INSTALL_DIR"
tar -xzf "${TMPDIR_INSTALL}/${ARCHIVE}" -C "$TMPDIR_INSTALL"
install -m 0755 "${TMPDIR_INSTALL}/ril" "${INSTALL_DIR}/ril"

echo ""
echo "Installed ril to ${INSTALL_DIR}/ril"
"${INSTALL_DIR}/ril" --version || true
case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *) echo "Add to your PATH: export PATH=\"${INSTALL_DIR}:\$PATH\"" ;;
esac
