# ETI 生产环境部署指南

**目标服务器：** 43.157.213.212（腾讯云，Ubuntu 24.04.4 LTS）
**域名：** etiverify.com
**GitHub 仓库：** https://github.com/dragonzxh1/Energy_trade_inspection
**最后更新：** 2026-04-09

---

## 服务器环境（已就绪，无需重复安装）

| 软件 | 版本 |
|------|------|
| OS | Ubuntu 24.04.4 LTS |
| Node.js | v22.22.2 |
| npm | 10.9.7 |
| PM2 | 6.0.14 |
| Git | 2.43.0 |
| Nginx | 1.24.0 |
| Certbot | 2.9.0 |
| PostgreSQL | 16.13 |

---

## 前置检查清单

- [ ] SSH 能正常登录（`ssh ubuntu@43.157.213.212`）
- [ ] 所有 API Key 已准备好（见下方环境变量清单）
- [ ] 域名 etiverify.com 的 DNS 已指向服务器 IP
- [ ] Google Cloud Console 访问权限（配置 OAuth 回调）
- [ ] GitHub 仓库可访问

---



---


---

## 第三步：创建数据库

SSH 登录服务器后执行：

```bash
sudo -u postgres psql << 'EOF'
CREATE USER eti WITH PASSWORD '请替换为强密码';
CREATE DATABASE energy_trade_inspection OWNER eti;
GRANT ALL PRIVILEGES ON DATABASE energy_trade_inspection TO eti;
\c energy_trade_inspection
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
\q
EOF
```

验证连接：

```bash
psql postgresql://eti:请替换为强密码@localhost:5432/energy_trade_inspection -c "SELECT 1;"
```

---

## 第四步：克隆代码

```bash
sudo mkdir -p /var/www/eti
sudo chown ubuntu:ubuntu /var/www/eti
cd /var/www/eti
git clone https://github.com/dragonzxh1/Energy_trade_inspection .
```

> 若仓库为私有，使用 token 克隆：
> ```bash
> git clone https://YOUR_GITHUB_USERNAME:YOUR_PAT@github.com/dragonzxh1/Energy_trade_inspection .
> ```

---

## 第五步：配置环境变量

```bash
nano /var/www/eti/.env.local
```

### 完整环境变量清单

```bash
# ============================================================
# 必填 — 应用无法启动的变量
# ============================================================

# 数据库（与第三步保持一致）
DATABASE_URL=postgresql://eti:请替换为强密码@localhost:5432/energy_trade_inspection

# NextAuth 密钥（运行 openssl rand -base64 32 生成）
AUTH_SECRET=

# 应用地址
NEXT_PUBLIC_APP_URL=https://etiverify.com

# Google OAuth（在 Google Cloud Console → APIs & Services → Credentials 获取）
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# ============================================================
# AI 实体提取（通义千问 / DashScope）
# ============================================================
QWEN_API_KEY=
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

# ============================================================
# 制裁数据
# ============================================================
OPENSANCTIONS_API_KEY=

# ============================================================
# 船舶 AIS 数据（至少配置一个，AIS_PROVIDER 填对应名称）
# AIS_PROVIDER 可选值: vesselapi | aisstream | datalastic | hifleet
# ============================================================
AIS_PROVIDER=vesselapi
VESSELAPI_KEY=
AISSTREAM_KEY=
DATALASTIC_API_KEY=
HIFLEET_KEY=

# ============================================================
# 公司注册数据（可选，影响 Companies House / OpenCorporates / Zefix 查询）
# ============================================================
COMPANIES_HOUSE_API_KEY=
OC_API_TOKEN=
ZEFIX_USERNAME=
ZEFIX_PASSWORD=

# ============================================================
# 管理员
# ============================================================
ADMIN_SECRET=
ADMIN_EMAILS=your@email.com

# ============================================================
# Stripe 支付（可稍后配置，留空应用仍可启动）
# ============================================================
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_PRICE_STARTER=
STRIPE_PRICE_PROFESSIONAL=
```

生成 AUTH_SECRET：

```bash
openssl rand -base64 32
```

---

## 第六步：安装依赖并构建

```bash
cd /var/www/eti
npm install
NODE_OPTIONS="--max-old-space-size=3072" npm run build
```

> 构建失败时先检查 `.env.local` 是否有语法错误，再看 `npm run build` 的报错信息。

---

## 第七步：导入数据库（如需从本地迁移数据）

在本地运行（导出）：

```bash
# 本地 Docker 环境
docker exec eti-postgres pg_dump -U eti energy_trade_inspection | gzip > eti_db_backup.sql.gz
# 上传到服务器
scp eti_db_backup.sql.gz ubuntu@43.157.213.212:/home/ubuntu/
```

在服务器上运行（导入）：

```bash
gunzip -c /home/ubuntu/eti_db_backup.sql.gz | sudo -u postgres psql -d energy_trade_inspection

# 验证
sudo -u postgres psql -d energy_trade_inspection -c "
SELECT
  (SELECT COUNT(*) FROM entities) AS entities,
  (SELECT COUNT(*) FROM icij_entities) AS icij_entities,
  (SELECT COUNT(*) FROM icij_relationships) AS icij_relationships;
"
```

预期：entities ≈ 20 万，icij_entities ≈ 160 万，icij_relationships ≈ 330 万。

> 若是全新部署（不迁移数据），应用启动时会自动运行迁移脚本创建表结构。制裁数据需通过 `/api/admin/sync` 接口触发同步。

---

## 第八步：用 PM2 启动应用

```bash
cd /var/www/eti
pm2 start npm --name "eti" -- start
pm2 save

# 设置开机自启（按输出提示执行对应命令）
pm2 startup
```

验证：

```bash
pm2 status
pm2 logs eti --lines 30
# 应看到 Next.js server started on port 3000
```

---

## 第九步：配置 Nginx 反向代理

```bash
sudo tee /etc/nginx/sites-available/etiverify.com > /dev/null << 'EOF'
server {
    listen 80;
    server_name etiverify.com www.etiverify.com;

    client_max_body_size 20M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 120s;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/etiverify.com /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

此时 `http://etiverify.com` 应能访问（需要 DNS 已生效）。

---

## 第十步：申请 HTTPS 证书

> **前提：** DNS 已生效，`dig etiverify.com +short` 应返回 `43.157.213.212`。

```bash
sudo certbot --nginx -d etiverify.com -d www.etiverify.com \
  --non-interactive --agree-tos --email 你的邮箱@example.com

# 验证自动续期
sudo certbot renew --dry-run
```

---

## 第十一步：配置 Google OAuth 回调

登录 [Google Cloud Console](https://console.cloud.google.com)：

1. APIs & Services → Credentials → 点击你的 OAuth 2.0 Client ID
2. **已授权的重定向 URI** 中添加：
   ```
   https://etiverify.com/api/auth/callback/google
   ```
3. 保存

> 本地开发的 `http://localhost:3000/api/auth/callback/google` 可保留。

---

## 第十二步：防火墙确认（腾讯云安全组）

在腾讯云控制台确认以下端口已开放：

| 协议 | 端口 | 用途 |
|------|------|------|
| TCP | 22 | SSH |
| TCP | 80 | HTTP |
| TCP | 443 | HTTPS |

> 端口 3000 **不需要**对外开放，Nginx 负责代理。

---

## 验证清单

部署完成后逐项确认：

- [ ] `https://etiverify.com` 能打开首页，HTTPS 锁图标正常
- [ ] Google 登录正常（OAuth 回调成功）
- [ ] 搜索功能正常（能搜到实体）
- [ ] `/screen` 上传合同文件，能提取实体并返回风险结果
- [ ] `/trade` 贸易核查功能正常
- [ ] PDF 报告下载正常
- [ ] `pm2 status` 显示 `eti` 进程为 `online`

---

## 常用运维命令

```bash
# 查看应用日志（实时）
pm2 logs eti

# 重启应用
pm2 restart eti

# 更新代码后重新部署
cd /var/www/eti
git pull
npm install
NODE_OPTIONS="--max-old-space-size=3072" npm run build
pm2 restart eti

# 查看 Nginx 错误日志
sudo tail -50 /var/log/nginx/error.log

# 连接数据库
sudo -u postgres psql -d energy_trade_inspection

# 磁盘 / 内存使用
df -h && free -h
```

---

## 故障排查

### 应用启动失败
```bash
pm2 logs eti --lines 50
# 常见原因：.env.local 变量缺失、数据库连不上、构建产物不存在
```

### 数据库连接失败
```bash
psql postgresql://eti:密码@localhost:5432/energy_trade_inspection -c "SELECT 1;"
# 失败则检查 pg_hba.conf 是否允许本地密码认证
sudo nano /etc/postgresql/16/main/pg_hba.conf
```

### 构建内存不足
```bash
NODE_OPTIONS="--max-old-space-size=3072" npm run build
```

### 证书申请失败
```bash
dig etiverify.com +short          # 确认 DNS 已解析
curl http://etiverify.com         # 确认 80 端口可访问
```

### Google 登录报错 redirect_uri_mismatch
检查 Google Console 重定向 URI 是否含 `https://etiverify.com/api/auth/callback/google`，
确认 `.env.local` 中 `NEXT_PUBLIC_APP_URL=https://etiverify.com`（无尾部斜杠）。

---

## Stripe 支付接入（后续）

功能验证稳定后再配置：

1. Stripe Dashboard 创建 Products → 获取 Price ID
2. `.env.local` 填入 `STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`、`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`、`STRIPE_PRICE_STARTER`、`STRIPE_PRICE_PROFESSIONAL`
3. Stripe Webhook 端点设置为 `https://etiverify.com/api/stripe/webhook`，事件选 `checkout.session.completed`、`customer.subscription.deleted`
4. `pm2 restart eti`

---

*Energy Trade Inspection — 部署文档 v2.0（2026-04-09）*
