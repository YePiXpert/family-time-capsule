# 自托管快速开始（1.3）

本文对应 `scripts/ops/` 中的实际工具，所有命令都已在仓库测试中执行过。
前提：一台 VPS（已验证平台：Debian 12/13、Ubuntu 22.04/24.04 的 x86_64）、
一个已解析到该机器的域名、80/443 端口在云防火墙放行。

## 1. 安装 Docker（如已有可跳过）

按官方文档安装 Docker Engine 与 Compose v2：
<https://docs.docker.com/engine/install/ubuntu/>（Debian 同站）。
`ftc` 不会替你安装 Docker、不修改 daemon.json、不添加镜像加速源。

## 2. 一键安装

```bash
sudo bash scripts/ops/ftc install
```

交互内容：选择网络模式（`caddy` 新机器自动 HTTPS / `loopback` 已有反代）、
填写域名、确认镜像。非交互示例：

```bash
sudo bash scripts/ops/ftc install \
  --mode caddy --domain capsule.example.com \
  --image ghcr.io/yepixpert/family-time-capsule:1.3.0-alpha.1 --yes
```

安装器会：

- 检查环境（系统、磁盘、Docker/Compose、数据卷冲突——检测到未确认归属的
  同名卷会拒绝安装，绝不覆盖）；
- 生成 `AUTH_SECRET` 与一次性初始化令牌（保存在 `config/`，权限 0600；
  重跑安装不会重置密钥）；
- 校验最终 Compose 配置（app 绝不公开绑定 0.0.0.0:3000）；
- 启动并做容器/API/HTTPS 冒烟——HTTPS 未就绪只报“部分完成”，不宣称成功。

`loopback` 模式会生成 `releases/<id>/nginx-ftc.conf` 片段供你人工并入现有
反代（不自动修改你的 Nginx/Caddy）。

## 3. 查看初始化令牌并完成 App 端初始化

```bash
sudo bash scripts/ops/ftc setup-info   # 仅本机交互查看，不进日志
```

手机 App 选择「创建我的家庭」，填入 `https://capsule.example.com`，
按提示输入初始化令牌、称呼、邮箱、密码，然后在 App 内建立家庭。
管理员建立后，将 `config/env` 中 `INITIAL_SETUP_TOKEN` 置空并删除
`config/initial-setup-token`。

## 4. 邀请家人

App「更多 → 邀请家人加入」（管理员）生成二维码或一次性链接；家人在 App
「加入家人的家庭」扫码/粘贴即可用自己的账号注册加入。

## 日常命令

```bash
sudo bash scripts/ops/ftc status    # 版本/容器/健康/磁盘/最近备份
sudo bash scripts/ops/ftc doctor    # 深度诊断（端口审计、HTTPS、worker 探针）
sudo bash scripts/ops/ftc backup    # 一致性快照（详见 BACKUP_RESTORE.md）
sudo bash scripts/ops/ftc upgrade --check
```

详见 `docs/OPERATIONS.md`、`docs/UPGRADE.md`、`docs/BACKUP_RESTORE.md`。
