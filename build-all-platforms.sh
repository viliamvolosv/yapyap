#!/usr/bin/env bash

# YapYap Messenger - Build All Platforms Script
# This script builds executables for all supported platforms

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}YapYap Messenger - Multi-Platform Build${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "Version: ${VERSION}"
echo -e "Build Time: ${BUILD_TIME}"
echo -e "Platform: ${UNAME_S} ${UNAME_M}"
echo -e ""

# Check if we're on macOS
if [[ "$UNAME_S" == "Darwin" ]]; then
    echo -e "${YELLOW}Detected macOS. Building for macOS and Linux only.${NC}"
    echo -e ""
fi

# Build production executable first
echo -e "${BLUE}[1/4] Building production executable...${NC}"
NODE_ENV=production bun run build.ts
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Production build complete${NC}"
else
    echo -e "${RED}✗ Production build failed${NC}"
    exit 1
fi
echo -e ""

# Build Linux platforms
echo -e "${BLUE}[2/4] Building Linux platforms...${NC}"
bun run build:compile:linux
bun run build:compile:linux:baseline
bun run build:compile:linux:modern
bun run build:compile:linux:arm64
bun run build:compile:linux:arm64:musl
echo -e "${GREEN}✓ All Linux builds complete${NC}"
echo -e ""

# Build macOS platforms
if [[ "$UNAME_S" == "Darwin" ]] || [[ "$1" == "--all-platforms" ]]; then
    echo -e "${BLUE}[3/4] Building macOS platforms...${NC}"
    bun run build:compile:macos
    bun run build:compile:macos:x64
    bun run build:compile:macos:x64:baseline
    echo -e "${GREEN}✓ All macOS builds complete${NC}"
    echo -e ""
fi

# Build Windows platforms
if [[ "$UNAME_S" == "MINGW"* ]] || [[ "$UNAME_S" == "MSYS"* ]] || [[ "$1" == "--all-platforms" ]]; then
    echo -e "${BLUE}[3/4] Building Windows platforms...${NC}"
    bun run build:compile:windows
    bun run build:compile:windows:baseline
    echo -e "${GREEN}✓ All Windows builds complete${NC}"
    echo -e ""
fi

echo -e "${BLUE}[4/4] Summary${NC}"
echo -e ""

# List all built files
echo -e "Linux builds:"
ls -lh dist/yapyap-linux* 2>/dev/null || echo "  (none)"
echo -e ""

echo -e "macOS builds:"
ls -lh dist/yapyap-macos* 2>/dev/null || echo "  (none)"
echo -e ""

echo -e "Windows builds:"
ls -lh dist/yapyap*.exe 2>/dev/null || echo "  (none)"
echo -e ""

# Create distribution packages
echo -e "${BLUE}Creating distribution packages...${NC}"
mkdir -p dist/distributions

# Linux packages
if ls dist/yapyap-linux* >/dev/null 2>&1; then
    tar czf dist/distributions/yapyap-linux-x64.tar.gz dist/yapyap-linux
    tar czf dist/distributions/yapyap-linux-baseline.tar.gz dist/yapyap-linux-baseline
    tar czf dist/distributions/yapyap-linux-modern.tar.gz dist/yapyap-linux-modern
    tar czf dist/distributions/yapyap-linux-arm64.tar.gz dist/yapyap-linux-arm64
    tar czf dist/distributions/yapyap-linux-arm64-musl.tar.gz dist/yapyap-linux-arm64-musl
    echo -e "${GREEN}✓ Linux distribution packages created${NC}"
fi

# macOS packages
if ls dist/yapyap-macos* >/dev/null 2>&1; then
    tar czf dist/distributions/yapyap-macos-arm64.tar.gz dist/yapyap-macos
    tar czf dist/distributions/a-macos-x64.tar.gz dist/yapyap-macos-x64
    tar czf dist/distributions/yapyap-macos-x64-baseline.tar.gz dist/yapyap-macos-x64-baseline
    echo -e "${GREEN}✓ macOS distribution packages created${NC}"
fi

# Windows packages
if ls dist/yapyap*.exe >/dev/null 2>&1; then
    zip -r dist/distributions/yapyap-windows-x64.zip dist/yapyap.exe dist/yapyap-baseline.exe
    echo -e "${GREEN}✓ Windows distribution packages created${NC}"
fi

echo -e ""
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}Build Complete!${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e ""
echo -e "Distribution packages available in: ${GREEN}dist/distributions/${NC}"
echo -e ""
echo -e "To distribute:"
echo -e "  Linux:  scp dist/distributions/yapyap-linux-x64.tar.gz user@server:/path/"
echo -e "  macOS:  scp dist/distributions/yapyap-macos-arm64.tar.gz user@mac:/path/"
echo -e "  Windows: scp dist/distributions/yapyap-windows-x64.zip user@windows:/path/"
echo -e ""
echo -e "Or copy individual binaries:"
echo -e "  Linux:  cp dist/yapyap-linux user@server:/usr/local/bin/a"
echo -e "  macOS:  cp dist/yapyap-macos user@mac:/usr/local/bin/yapyap"
echo -e "  Windows: cp dist/yapyap.exe user@windows:/usr/local/bin/yapyap.exe"
echo -e ""

# Exit with success
exit 0