#!/usr/bin/env bash
# 无 root 环境下，为 Playwright Chromium 安装缺失的共享库。
# 用 apt-get download 取 .deb 再 dpkg -x 解包到仓库内 .playwright-libs/root，
# playwright.config.js 会自动把其中的库目录加入 LD_LIBRARY_PATH。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEBS="$ROOT/.playwright-libs/debs"
LIBS_ROOT="$ROOT/.playwright-libs/root"
APT_STATE="$(mktemp -d)"
trap 'rm -rf "$APT_STATE"' EXIT

mkdir -p "$DEBS" "$LIBS_ROOT" "$APT_STATE/lists" "$APT_STATE/archives/partial"

SOURCES="$APT_STATE/sources.list"
cat > "$SOURCES" <<'EOF'
deb http://deb.debian.org/debian bookworm main
EOF

APT_OPTS=(
  -o "Dir::Etc::sourcelist=$SOURCES"
  -o "Dir::Etc::sourceparts=-"
  -o "Dir::State::Lists=$APT_STATE/lists"
  -o "Dir::Cache=$APT_STATE/archives"
)

apt-get "${APT_OPTS[@]}" update

PACKAGES=(
  libnspr4 libnss3 libxcomposite1 libxdamage1 libxfixes3 libxrandr2
  libasound2 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0
  libdbus-1-3 libgbm1 libxkbcommon0 libxi6 libdrm2 libwayland-server0
)

(cd "$DEBS" && apt-get "${APT_OPTS[@]}" download "${PACKAGES[@]}")
for deb in "$DEBS"/*.deb; do
  dpkg -x "$deb" "$LIBS_ROOT"
done

echo "Chromium 依赖库已解包到 $LIBS_ROOT"
