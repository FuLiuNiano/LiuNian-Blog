# Leaf Blog

一个基于 Node.js + SQLite + Redis + Nginx 的个人博客。

项目包含：

- Node.js REST API 后端
- SPA 前端和后台管理页面
- SQLite 数据库存储
- Redis 共享 Session、限流、冷却时间和验证码状态
- Nginx 反向代理
- systemd 常驻运行
- 自动备份、阅读量去重、外部链接检查
- Ubuntu / Debian Bash 一键部署脚本

## 一键部署

推荐在全新的 Ubuntu 22.04 / 24.04 服务器上执行。服务器需要有公网 IP，并将域名 A/AAAA 记录解析到服务器。

### 1. 下载项目

~~~bash
sudo mkdir -p /tmp/leaf-blog
sudo chown "$USER":"$USER" /tmp/leaf-blog
git clone https://github.com/FuLiuNiano/LiuNian-Blog.git /tmp/leaf-blog
cd /tmp/leaf-blog
~~~

如果项目已经上传到服务器，可以直接进入项目目录：

~~~bash
cd /tmp/leaf-blog
~~~

### 2. 执行一键部署

~~~bash
chmod +x deploy.sh
sudo bash deploy.sh --domain blog.example.com
~~~

把 blog.example.com 替换成你自己的域名。

首次运行时脚本会询问：

- 后台管理员 QQ 账号
- 后台密码
- QQ 邮箱 SMTP 配置，可留空
- 外部链接黑名单，可留空

脚本会自动生成 SQLite、Redis、systemd 和 Nginx 配置。已有 .env 不会被覆盖，已有数据库和备份也不会删除。

### 3. 同时启用 HTTPS

确保域名已经解析成功，并且服务器的 80、443 端口可以从公网访问：

~~~bash
sudo bash deploy.sh \
  --domain blog.example.com \
  --https \
  --https-email admin@example.com
~~~

HTTPS 证书由 Certbot 申请和续期。没有域名时不要使用 --https。

## 部署脚本会做什么

deploy.sh 只支持 Ubuntu / Debian，并且需要 root 或 sudo 权限。它会：

1. 检查 Node.js 22、npm、SQLite CLI、Redis、Nginx、Git、编译工具和基础工具。
2. 缺少依赖时自动安装，已经安装的依赖跳过。
3. 创建低权限运行用户 leaf。
4. 将代码同步到 /srv/leaf-blog。
5. 将 SQLite 数据库放到 /var/lib/leaf-blog/leaf-blog.db。
6. 将备份放到 /var/backups/leaf-blog。
7. 启动 Redis，并检查是否返回 PONG。
8. 创建并启动 leaf-blog.service。
9. 配置 Nginx 反向代理，并禁止访问 .env、数据库、日志、备份和依赖目录。
10. 检查 /api/health，并检查外部图片、音乐和友情链接。

外部资源检查失败只会给出警告，不会阻止博客启动；部署完成后应替换失效链接。

## 可选参数

~~~bash
sudo bash deploy.sh --help
~~~

常用参数：

~~~bash
# 修改项目正式目录
sudo bash deploy.sh --domain blog.example.com --app-dir /srv/leaf-blog

# 修改运行用户
sudo bash deploy.sh --domain blog.example.com --user leaf

# 修改 Node 本机端口，默认 8080
sudo bash deploy.sh --domain blog.example.com --port 8080

# 自动申请 HTTPS
sudo bash deploy.sh --domain blog.example.com --https --https-email admin@example.com
~~~

Node 服务默认只监听 127.0.0.1:8080，外部访问统一经过 Nginx。不要把 8080 或 Redis 的 6379 端口开放到公网。

## 部署后管理

查看服务状态：

~~~bash
sudo systemctl status leaf-blog --no-pager
sudo systemctl status redis-server --no-pager
~~~

查看实时日志：

~~~bash
sudo journalctl -u leaf-blog -f
~~~

重启博客：

~~~bash
sudo systemctl restart leaf-blog
~~~

健康检查：

~~~bash
curl http://127.0.0.1:8080/api/health
~~~

正常情况下会看到 healthy: true，并且日志中显示共享状态为 Redis。

## 更新博客

在服务器上执行：

~~~bash
cd /tmp/leaf-blog
git pull --ff-only
sudo bash deploy.sh --domain blog.example.com
~~~

更新脚本不会覆盖服务器上的 .env、SQLite 数据库、用户数据和备份。更新后如果需要立即重启：

~~~bash
sudo systemctl restart leaf-blog
~~~

## 数据和配置

生产环境主要使用以下路径：

~~~
代码目录：/srv/leaf-blog
SQLite：/var/lib/leaf-blog/leaf-blog.db
备份：/var/backups/leaf-blog
配置：/srv/leaf-blog/.env
日志：journalctl -u leaf-blog
~~~

SQLite 不需要单独运行数据库服务。Node.js 的 better-sqlite3 负责读写 SQLite 数据库；脚本安装的 sqlite3 命令行工具主要用于维护和排查。

Redis 用于共享：

- 后台和用户登录 Session
- IP、账号和接口限流
- 验证码状态
- 异常行为冷却时间

如果 Redis 连接失败，程序会退回单机内存状态。正式部署必须确认 .env 中存在：

~~~dotenv
REDIS_URL=redis://127.0.0.1:6379
~~~

## 安全注意事项

不要把以下内容上传到公开 GitHub 仓库：

- .env
- SQLite 数据库、WAL 和 SHM 文件
- data/users.json
- data/comments.json
- data/guestbook.json
- data/journals.json
- data/state.json
- data/site.json
- backups/
- logs/
- public/uploads/

项目的 .gitignore 已经默认排除这些文件。不要使用下面的命令强制添加隐私文件：

~~~bash
git add -f .env
~~~

上传前检查：

~~~bash
git status --short
git ls-files -- .env data/leaf-blog.db data/leaf-blog.db-wal data/leaf-blog.db-shm data/users.json data/comments.json data/guestbook.json data/journals.json data/state.json data/site.json backups logs public/uploads
~~~

第二条命令没有输出，才表示这些隐私路径没有被 Git 跟踪。

如果密码、SMTP 授权码或其他密钥曾经提交到公开仓库，应立即更换，并清理 Git 历史。.env 文件权限建议保持为仅运行用户可读：

~~~bash
sudo chmod 600 /srv/leaf-blog/.env
sudo chown leaf:leaf /srv/leaf-blog/.env
~~~

## 本地运行

需要 Node.js 22 或更高版本：

~~~bash
npm ci
npm start
~~~

默认访问地址：

~~~
http://127.0.0.1:3000
~~~

本地开发可以使用项目根目录的 .env.example 作为配置参考。不要把真实密码、SMTP 授权码或数据库文件复制到 GitHub。

## 相关文档

- [完整服务器部署教程](./DEPLOY.md)
- [一键部署脚本](./deploy.sh)
- [环境变量示例](./.env.example)

## License

MIT
