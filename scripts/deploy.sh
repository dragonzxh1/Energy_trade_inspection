#!/bin/bash
# deploy.sh — 在 CVM 上执行，拉取最新代码并重启服务
# 用法: bash /var/www/eti/scripts/deploy.sh

set -e

APP_DIR="/var/www/eti/Energy_trade_inspection"
cd "$APP_DIR"

echo "=== [1/4] 拉取最新代码 ==="
git pull origin master
echo "当前版本: $(git rev-parse --short HEAD)"

echo "=== [2/4] 安装依赖 ==="
npm install

echo "=== [3/4] 构建 ==="
npm run build

echo "=== [4/4] 重启服务 ==="
pm2 restart all --update-env
pm2 status

echo ""
echo "✓ 部署完成"
