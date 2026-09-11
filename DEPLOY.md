# Leaf Blog 服务器部署教程

本文适用于当前版本的 Leaf Blog：Node.js + SQLite + Redis。外部访问可以使用脚本配置的 Nginx，也可以使用 1Panel 反向代理。

## 一键部署

项目内提供了 [deploy.sh](./deploy.sh)。它会检查依赖，缺少时安装；已安装的 Node.js 22、npm、SQLite、Redis、Nginx、Git 和编译工具会跳过，然后自动配置 SQLite、Redis、systemd、Nginx 和健康检查。

建议先把项目上传到服务器的临时目录，再由脚本同步到正式目录：

```bash
cd /tmp/leaf-blog
chmod +x deploy.sh
sudo bash deploy.sh --domain blog.example.com
```

Node 默认使用本机 8080 端口，也可以自定义，例如：

```bash
sudo bash deploy.sh --domain blog.example.com --port 9000
```

如果从 GitHub 拉取代码，执行前先确认仓库中没有隐私文件；脚本会把运行时数据排除在同步之外。

需要同时申请 HTTPS：

```bash
sudo bash deploy.sh --domain blog.example.com --https --https-email admin@example.com
```

脚本不会删除已有数据库、JSON、文章和备份，不会覆盖已有 `.env`。首次运行会交互询问后台 QQ 号、后台密码和 SMTP 配置。

### 使用 1Panel 反向代理

如果服务器已经由 1Panel 管理网站和 HTTPS，请跳过系统 Nginx 配置：

```bash
sudo bash deploy.sh --domain blog.example.com --no-nginx
```

然后在 1Panel 中将域名反向代理到：

```text
http://127.0.0.1:8080
```

如果部署时使用自定义端口，例如 9000，两处都要使用 9000：

```bash
sudo bash deploy.sh --domain blog.example.com --no-nginx --port 9000
```

1Panel 的代理目标填写 `http://127.0.0.1:9000`，HTTPS 也在 1Panel 中申请。使用 `--no-nginx` 时不要再加 `--https`。

### 安全上传 GitHub

可以把代码上传 GitHub，但不要上传隐私数据。项目的 `.gitignore` 已默认忽略：

- `.env`
- SQLite 数据库及 WAL 临时文件
- `backups`、`logs`、`.run`、`node_modules`
- 用户、评论、留言、随笔、浏览状态和站点私有配置 JSON
- `public/uploads`

文章 Markdown 和 `posts.json` 默认保留，因为它们属于博客公开内容。第一次提交前检查：

```bash
git status --short
git diff -- .env data/users.json data/comments.json data/guestbook.json data/journals.json data/site.json
```

如果某个隐私文件以前已经 `git add` 或提交过，仅加入 `.gitignore` 还不够，需要从 Git 索引移除：

```bash
git rm --cached .env data/users.json data/comments.json data/guestbook.json data/journals.json data/state.json data/site.json
git commit -m "停止跟踪运行时隐私数据"
```

如果隐私内容已经推送到公开仓库，必须立即更换后台密码、SMTP 授权码和其他密钥；历史提交仍可能包含旧内容，需要再清理 Git 历史。

## 一、部署前准备

推荐环境：

- Ubuntu 22.04/24.04 x64
- Node.js 22 或更高版本
- Redis 7 或更高版本
- Nginx（使用脚本自带反向代理时需要；使用 1Panel 时可不安装）
- 一个已经解析到服务器的域名，例如 `blog.example.com`

当前项目使用 `better-sqlite3@13`，服务器上的 Node.js 不能低于 22。SQLite 不需要单独安装数据库服务，Node.js 依赖会自带 SQLite 运行库；Redis 需要单独运行。

下面示例使用这些路径和账号：

```text
项目目录：/srv/leaf-blog
运行用户：leaf
SQLite：/var/lib/leaf-blog/leaf-blog.db
备份目录：/var/backups/leaf-blog
域名：blog.example.com
```

请把示例域名替换成自己的域名。

## 二、安装系统软件

```bash
sudo apt update
sudo apt install -y nginx redis-server curl ca-certificates build-essential

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

node --version
npm --version
```

Node 版本应显示 `v22` 或更高版本。

## 三、创建运行用户和目录

```bash
sudo adduser --system --group --home /srv/leaf-blog leaf
sudo mkdir -p /srv/leaf-blog /var/lib/leaf-blog /var/backups/leaf-blog
sudo chown -R leaf:leaf /srv/leaf-blog /var/lib/leaf-blog /var/backups/leaf-blog
```

## 四、上传项目

把整个 `leaf-blog` 项目上传到服务器的 `/srv/leaf-blog`。需要上传：

- `server.js`、`lib`、`tools`、`public`
- `data/content` 和现有的文章数据
- `package.json`、`package-lock.json`
- `.env.example`

不要上传本地的：

- `.env`
- `node_modules`
- `.run`、`logs`、`backups`
- 正在运行中的 `data/leaf-blog.db-wal` 和 `data/leaf-blog.db-shm`

如果要迁移本地已经生成的 SQLite 数据库，请先执行 `npm run backup`，再使用备份目录中的 `data/leaf-blog.db`。不要直接复制运行中的 WAL 文件。

如果只上传 JSON 和文章 Markdown，服务器第一次启动时会自动把 JSON 导入 SQLite，原 JSON 不会被删除。

## 五、安装依赖并创建配置

```bash
cd /srv/leaf-blog
sudo -u leaf npm ci --omit=dev
sudo -u leaf cp .env.example .env
sudo chmod 600 .env
```

编辑配置文件：

```bash
sudo -u leaf nano /srv/leaf-blog/.env
```

生产环境至少配置为：

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=8080
TRUST_PROXY=true

DB_PATH=/var/lib/leaf-blog/leaf-blog.db
REDIS_URL=redis://127.0.0.1:6379

ADMIN_ACCOUNT=你的QQ号
ADMIN_PASSWORD=一串长度至少20位的随机密码

BACKUP_ENABLED=true
BACKUP_INTERVAL_HOURS=24
BACKUP_KEEP=7
BACKUP_DIR=/var/backups/leaf-blog

VIEW_DEDUP_MINUTES=30
LINK_BLOCKLIST=example-bad-domain.com,another-bad-domain.com
```

验证码邮件配置按实际邮箱填写：

```dotenv
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=你的QQ邮箱@qq.com
SMTP_PASS=QQ邮箱SMTP授权码
SMTP_FROM=你的QQ邮箱@qq.com

OTP_TTL_MINUTES=5
OTP_HASH_SECRET=至少32字节的随机字符串
OTP_EMAIL_DAILY_LIMIT=10
OTP_IP_DAILY_LIMIT=10
OTP_GLOBAL_DAILY_LIMIT=500
```

生成随机密钥：

```bash
openssl rand -hex 32
```

注意：`ADMIN_PASSWORD`、`SMTP_PASS` 和 `OTP_HASH_SECRET` 不能提交 Git，也不要发到聊天或工单中。修改密码后应重启服务。

当前 CAPTCHA 后端接口已经预留，但前端组件还没有绑定。如果没有接入具体 CAPTCHA 前端组件，不要把 `CAPTCHA_ENABLED` 改为 `true`，否则注册和评论会被要求提交不存在的验证码。

## 六、启动 Redis

```bash
sudo systemctl enable --now redis-server
sudo systemctl status redis-server --no-pager
redis-cli ping
```

看到 `PONG` 才算正常。

确认 Redis 只监听本机：

```bash
sudo ss -lntp | grep 6379
```

如果 Redis 配置过密码，`.env` 中改成：

```dotenv
REDIS_URL=redis://:Redis密码@127.0.0.1:6379
```

密码中含有 `@`、`#`、`/` 等特殊字符时，需要先进行 URL 编码。

## 七、设置目录权限

```bash
sudo chown -R leaf:leaf /srv/leaf-blog/data /var/lib/leaf-blog /var/backups/leaf-blog
sudo chmod 700 /var/lib/leaf-blog /var/backups/leaf-blog
sudo chmod 600 /srv/leaf-blog/.env
```

程序只需要写入数据、数据库和备份目录。`public` 目录不应该让运行用户随意写入。

## 八、先手动启动测试

```bash
cd /srv/leaf-blog
sudo -u leaf npm start
```

另开一个终端测试：

```bash
curl http://127.0.0.1:8080/api/health
```

返回包含 `"ok":true` 后按 `Ctrl+C` 停止测试。

启动日志应同时显示：

```text
数据库：SQLite /var/lib/leaf-blog/leaf-blog.db
共享状态：Redis
```

如果显示“单机内存”，说明 `REDIS_URL` 没有配置、Redis 没启动或连接失败。

## 九、配置 systemd 常驻运行

创建服务文件：

```bash
sudo nano /etc/systemd/system/leaf-blog.service
```

填入：

```ini
[Unit]
Description=Leaf Blog
After=network-online.target redis-server.service
Wants=network-online.target

[Service]
Type=simple
User=leaf
Group=leaf
WorkingDirectory=/srv/leaf-blog
ExecStart=/usr/bin/node /srv/leaf-blog/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/srv/leaf-blog/data /var/lib/leaf-blog /var/backups/leaf-blog

[Install]
WantedBy=multi-user.target
```

启用服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now leaf-blog
sudo systemctl status leaf-blog --no-pager
```

查看日志：

```bash
sudo journalctl -u leaf-blog -f
```

## 十、配置 Nginx 反向代理

创建站点配置：

```bash
sudo nano /etc/nginx/sites-available/leaf-blog
```

填入：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name blog.example.com;

    # data、.env、日志、备份和依赖目录禁止直接访问
    location ~ ^/(?:\.env(?:$|/)|data(?:/|$)|logs(?:/|$)|backups(?:/|$)|\.git(?:/|$)|node_modules(?:/|$)) {
        return 404;
    }

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        client_max_body_size 2m;
    }
}
```

启用配置并检查：

```bash
sudo ln -s /etc/nginx/sites-available/leaf-blog /etc/nginx/sites-enabled/leaf-blog
sudo nginx -t
sudo systemctl reload nginx
```

如果服务器已有默认站点，可以按需移除：

```bash
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

## 十一、配置 HTTPS

先把域名的 DNS A 记录指向服务器公网 IP，再执行：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d blog.example.com
```

按提示选择 HTTP 自动跳转 HTTPS。验证自动续期：

```bash
sudo certbot renew --dry-run
```

## 十二、防火墙

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

不要把 8080 或 6379 对公网开放。Node 和 Redis 都只监听本机。

## 十三、首次登录后台

1. 使用 `ADMIN_ACCOUNT` 对应的 QQ 邮箱注册用户。
2. 注册成功后访问 `https://blog.example.com/admin`。
3. 输入 `.env` 中的 `ADMIN_PASSWORD`。
4. 进入后台配置站点资料、文章和友情链接。

友情链接只填写可信的 HTTPS 地址。项目会拒绝危险协议、内网地址、localhost 和 `LINK_BLOCKLIST` 中的域名，前端链接也会使用 `nofollow noopener noreferrer`。

## 十四、外部资源和死链检查

图片、二维码和音乐最稳定的方式是放到本站：

```text
图片：/srv/leaf-blog/public/img/
音乐：/srv/leaf-blog/public/music/
```

后台填写：

```text
/img/my-background.jpg
/music/my-song.mp3
```

这样不依赖第三方站点，也不会因为对方换图、限速或删除文件而失效。外部 HTTPS 资源可以继续使用，但建议定期检查：

```bash
cd /srv/leaf-blog
sudo -u leaf npm run check-links
```

脚本只检查 HTTPS 外部地址，不跟随跳转，不检查本站路径；发现失败时应把资源下载到本站或更换地址。

每天自动检查可以使用 cron：

```bash
sudo nano /etc/cron.d/leaf-blog-links
```

填入：

```cron
15 4 * * * leaf cd /srv/leaf-blog && /usr/bin/npm run check-links >> /var/log/leaf-blog-links.log 2>&1
```

## 十五、备份和恢复

手动备份：

```bash
cd /srv/leaf-blog
sudo -u leaf npm run backup
```

自动备份由 `.env` 控制：

```dotenv
BACKUP_ENABLED=true
BACKUP_INTERVAL_HOURS=24
BACKUP_KEEP=7
BACKUP_DIR=/var/backups/leaf-blog
```

建议再把 `/var/backups/leaf-blog` 同步到另一台机器或对象存储。只保存在同一台服务器，服务器损坏时备份也会一起丢失。

恢复 SQLite：

```bash
sudo systemctl stop leaf-blog
sudo cp /var/backups/leaf-blog/某个备份/data/leaf-blog.db /var/lib/leaf-blog/leaf-blog.db
sudo chown leaf:leaf /var/lib/leaf-blog/leaf-blog.db
sudo rm -f /var/lib/leaf-blog/leaf-blog.db-wal /var/lib/leaf-blog/leaf-blog.db-shm
sudo systemctl start leaf-blog
```

恢复前先保留当前数据库副本。恢复后检查首页、文章、评论和后台登录。

## 十六、更新版本

上传新代码时不要覆盖 `.env`，也不要覆盖生产数据库：

```bash
sudo systemctl stop leaf-blog
cd /srv/leaf-blog
sudo -u leaf npm ci --omit=dev
sudo -u leaf npm run backup
sudo systemctl start leaf-blog
sudo systemctl status leaf-blog --no-pager
```

更新前后都执行：

```bash
curl http://127.0.0.1:8080/api/health
sudo nginx -t
```

## 十七、常见问题

### 页面显示 502

```bash
sudo systemctl status leaf-blog --no-pager
sudo journalctl -u leaf-blog -n 100 --no-pager
```

### 日志显示 SQLite 驱动不兼容

检查 Node.js 版本：

```bash
node --version
```

升级到 Node.js 22 或更高版本后重新执行：

```bash
cd /srv/leaf-blog
sudo -u leaf npm ci --omit=dev
```

### 日志显示单机内存

```bash
redis-cli ping
sudo systemctl status redis-server --no-pager
```

并确认 `.env` 中存在：

```dotenv
REDIS_URL=redis://127.0.0.1:6379
```

### 后台进不去

- 确认登录邮箱的 QQ 号与 `ADMIN_ACCOUNT` 一致。
- 确认已经先注册并登录普通用户。
- 确认 `.env` 中设置了 `ADMIN_PASSWORD`。
- 修改 `.env` 后执行 `sudo systemctl restart leaf-blog`。

### 注册验证码发不出去

检查 SMTP 主机、邮箱账号和 SMTP 授权码。QQ 邮箱需要使用 SMTP 授权码，不是网页登录密码。

## 十八、上线检查清单

- [ ] Node.js 22 或更高版本
- [ ] `npm ci --omit=dev` 成功
- [ ] SQLite 数据库能创建并可写
- [ ] Redis 返回 `PONG`
- [ ] 启动日志显示 `共享状态：Redis`
- [ ] `/api/health` 返回正常
- [ ] Nginx 只代理到 `127.0.0.1:8080`
- [ ] HTTPS 已启用
- [ ] 8080、6379 未对公网开放
- [ ] `.env` 权限为 600
- [ ] `data`、`.env`、`logs`、`backups` 访问被禁止
- [ ] 后台密码和 SMTP 授权码已更换为生产值
- [ ] 手动备份成功
- [ ] `npm run check-links` 已执行
- [ ] 备份已复制到另一台机器或对象存储
