# Monorepo 结构说明

> 完整拆分背景、目录对照与修改指南见 **[Platform-Monorepo拆分说明.md](./Platform-Monorepo拆分说明.md)**。

Platform 与前端已拆为 **npm workspaces** 独立子工程，共享代码在 `packages/`，可执行应用在 `apps/`。

## 目录

```
apps/
  platform-api/          # 消费端 HTTP（原 platform:api）
  platform-scheduler/    # 生产端调度
  platform-executor/     # 生产端执行
  platform-ingest*/      # RSS Worker
  platform-embed/        # 向量化 Worker
  platform-subscription/ # 订阅 Worker（可选，推荐 scheduler）
  admin/                 # 管理后台 SPA（:3001）
  frontend/              # 主仪表盘配置占位（源码仍在根 src/）
packages/
  shared/                # DB、日志、存储、鉴权（原 server/_shared）
  platform-core/           # 业务逻辑（原 server/platform）
server/
  _shared/               # 兼容 shim → @hxxworldmonitor/shared
  platform/              # 兼容 shim → @hxxworldmonitor/platform-core
  worldmonitor/          # sebuf /api/*（仍与根 Vite 耦合）
```

## 独立配置

每个 `apps/*` 子工程可有自己的 `.env.local`（**优先**），其次回退到**仓库根** `.env.local`：

```powershell
copy apps\platform-api\.env.example apps\platform-api\.env.local
copy apps\admin\.env.example apps\admin\.env.local
```

## 常用命令（根目录）

| 命令 | 子工程 |
|------|--------|
| `npm run platform:api` | `@hxxworldmonitor/platform-api` |
| `npm run platform:scheduler` | `@hxxworldmonitor/platform-scheduler` |
| `npm run platform:executor` | `@hxxworldmonitor/platform-executor` |
| `npm run admin:dev` | `@hxxworldmonitor/admin` → http://localhost:3001 |
| `npm run dev` | 根 Vite 主仪表盘（:3000，含旧 `/admin` 路由） |
| `npm run frontend:dev` | 同上，经 `@hxxworldmonitor/frontend` workspace 启动 |

## 修改代码应去哪

| 改什么 | 改哪里 |
|--------|--------|
| DB / 日志 / 存储 | `packages/shared/src/` |
| 订阅 / 任务 / RSS 业务 | `packages/platform-core/src/` |
| 仅 API 启动逻辑 | `apps/platform-api/src/main.ts` |
| 仅 Admin UI | `apps/admin/src/` |
| 主仪表盘 UI | 仍 `src/`（后续迁入 `apps/frontend`） |

**不要**再直接改 `server/_shared` 或 `server/platform` 下的 shim 文件；改 `packages/` 后运行：

```powershell
node scripts/generate-monorepo-shims.mjs
```

## 后续迁移

1. 将 `src/` 迁入 `apps/frontend` 并独立 `vite.config`（**进行中**：`npm run frontend:dev` 已可用，仍指向根 `src/`）
2. 将 `server/worldmonitor` 抽为 `packages/sebuf-api`
3. 删除 `server/_shared` / `server/platform` shim 层
