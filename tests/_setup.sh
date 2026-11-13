#!/usr/bin/env bash
# 测试依赖一键重建（2026-11-13）
#
# 为什么需要：jsdom 装在本地盘 /tmp/nmroot（走 virtiofs 读上千小文件会挂起，
# 不能放在 /sandbox/workspace），但 /tmp 在沙箱重置后会清空，于是所有 jsdom
# 套件一起报 MODULE_NOT_FOUND —— 表现为「48 项失败」，看起来像代码坏了，
# 其实只是依赖没了。
#
# 用法：bash tests/_setup.sh
set -e

NMR="${NMR:-/tmp/nmroot}"
HERE="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$NMR"
cd "$NMR"
[ -f package.json ] || npm init -y >/dev/null 2>&1 || true

if node -e "require('jsdom')" >/dev/null 2>&1; then
  echo "jsdom 已就绪：$NMR"
else
  echo "安装 jsdom 到 $NMR ……"
  npm i jsdom --no-audit --no-fund --registry=https://registry.npmjs.org/
fi

# 让 tests/node_modules 指向它
if [ ! -e "$HERE/node_modules" ]; then
  ln -s "$NMR/node_modules" "$HERE/node_modules"
  echo "已建立软链 $HERE/node_modules → $NMR/node_modules"
elif [ -L "$HERE/node_modules" ]; then
  echo "软链已存在：$(readlink "$HERE/node_modules")"
else
  echo "注意：$HERE/node_modules 是真实目录（不是软链），未改动"
fi

node -e "require(process.argv[1] + '/node_modules/jsdom'); console.log('自检通过：jsdom 可加载')" "$HERE"
