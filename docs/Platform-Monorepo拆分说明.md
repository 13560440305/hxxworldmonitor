# Platform Monorepo 拆分说明

> **状态：** 已落地（npm workspaces）  
> **关联：** [MONOREPO.md](./MONOREPO.md) · [Platform消费生产端拆分设计.md](./Platform消费生产端拆分设计.md) · [deploy/README.md](../deploy/README.md)

---

## 1. 拆分目标

将原先混在单仓根目录的 Platform 后端、生产端 Worker、管理后台拆成 **独立子工程**，实现：

| 目标 | 说明 |
|------|------|
| **进程隔离** | API、Scheduler、Executor、Ingest 等各自独立进程与依赖，互不阻塞 event loop |
| **配置隔离** | 每个 `apps/*` 可有独立 `.env.local`，改 API 端口不影响 Worker |
| **代码隔离** | 业务逻辑集中在 `packages/`，改 Scheduler 不必动 Admin 前端 |
| **部署隔离** | 消费端（HTTP）与生产端（无 HTTP）可分开扩缩容 |

---

## 2. 拆分前后对比

| 拆分前 | 拆分后 |
|--------|--------|
| `server/_shared/` | `packages/shared/src/` |
| `server/platform/` | `packages/platform-core/src/` |
| `scripts/platform-api-server.ts` | `apps/platform-api/src/main.ts` |
| `scripts/platform-scheduler-worker.ts` | `apps/platform-scheduler/src/main.ts` |
| `scripts/platform-executor-worker.ts` | `apps/platform-executor/src/main.ts` |
| `src/platform-admin-main.ts` + `admin.html` | `apps/admin/`（独立 Vite 工程，:3001） |
| 根目录单一 `package.json` | 根目录 **workspaces** + 各 app 独立 `package.json` |

`server/_shared/`、`server/platform/` 保留为 **兼容 shim**（转发到 packages），旧 import 路径仍可用；**新代码请只改 packages/**。

---

## 3. 目录结构

```
hxxworldmonitor/
├── apps/                          # 可执行应用（各自 package.json + .env.example）
│   ├── platform-api/              # 消费端 HTTP（platform:api，:8787）
│   ├── platform-scheduler/        # 生产端调度（platform:scheduler）
│   ├── platform-executor/       # 生产端执行（platform:executor）
│   ├── platform-ingest/           # Tier2 全量 RSS
│   ├── platform-ingest-fast/      # Tier1 快讯 RSS
│   ├── platform-embed/            # 向量化 Worker
│   ├── platform-subscription/     # 订阅 Worker（可选，推荐 scheduler 任务）
│   ├── platform-admin-init/       # 创建管理员
│   ├── platform-db-init/          # DB 初始化 CLI
│   ├── platform-db-migrate/       # DB 迁移 CLI
│   └── admin/                     # 管理后台 SPA（admin:dev，:3001）
├── packages/                      # 共享库
│   ├── shared/                    # DB、日志、存储、鉴权、load-env
│   └── platform-core/             # 业务逻辑、Job 调度、RSS/订阅/Admin API
├── server/
│   ├── _shared/                   # shim → @hxxworldmonitor/shared
│   ├── platform/                  # shim → @hxxworldmonitor/platform-core
│   └── worldmonitor/              # sebuf /api/*（仍与根 Vite 耦合，待抽包）
├── src/                           # 主仪表盘前端（仍在此，待迁入 apps/frontend）
├── deploy/init/                   # SQL 迁移（23 个文件）
└── .env.local                     # 根目录共享环境变量（各 app 可覆盖）
```

---

## 4. 消费端 vs 生产端

| 子系统 | apps 包 | HTTP | 职责 |
|--------|---------|------|------|
| **消费端** | `platform-api` | 是 (:8787) | Platform REST、`/platform/v1/*`、Admin/User API |
| **消费端** | `admin` | 是 (:3001) | 管理后台 SPA |
| **消费端** | 根 `npm run dev` | 是 (:3000) | 主仪表盘 + Vite `/api/*` sebuf |
| **生产端** | `platform-scheduler` | 否 | 扫描 `job_definitions`，入队 `job_runs` |
| **生产端** | `platform-executor` | 否 | claim 并执行 Job Handler |
| **生产端** | `platform-ingest*` / `embed` / `subscription` | 否 | 可选常驻 Worker（也可用 scheduler 任务代替） |

集成点：**PostgreSQL**（主）、**Redis**（可选）、**OSS**（冷归档）。

---

## 5. 环境变量与独立配置

加载顺序（`packages/shared/src/load-env.ts`）：

1. **当前工作目录**下的 `.env.local`（例如 `apps/platform-api/.env.local`）
2. **Monorepo 根目录** `.env.local`（fallback）

示例：

```powershell
# 根目录 — 共享数据库等
copy .env.example .env.local

# API 专用（可选，覆盖端口等）
copy apps\platform-api\.env.example apps\platform-api\.env.local

# Admin 专用（可选）
copy apps\admin\.env.example apps\admin\.env.local
```

| 变量 | 用途 |
|------|------|
| `DATABASE_URL` | 所有 Platform 进程必需 |
| `VITE_PLATFORM_API_URL` | 前端/Admin 指向 API（如 `http://localhost:8787`） |
| `PLATFORM_API_PORT` | API 监听端口，默认 8787 |
| `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` | `platform:admin:init` |
| `PLATFORM_ALLOW_SYNC_JOBS` | 调试：API 内同步跑 Job（默认 false，202 入队） |
| `PLATFORM_KG_DAG_ENABLED` | stock/earnings 成功后自动入队知识图谱 |

完整列表见 [`.env.example`](../.env.example) 与 [deploy/README.md](../deploy/README.md)。

---

## 6. 修改代码指南

| 改什么 | 编辑目录 |
|--------|----------|
| 数据库连接、日志、OSS、JWT | `packages/shared/src/` |
| 订阅、Job、RSS、Admin API、向量化 | `packages/platform-core/src/` |
| 仅 API  HTTP 路由组装 | `apps/platform-api/src/main.ts` |
| 管理后台 UI | `apps/admin/src/` |
| 主仪表盘 UI | 仍 `src/`（后续迁入 `apps/frontend`） |
| SQL 迁移 | `deploy/init/` + 注册到 `platform-db-bootstrap.ts` |

修改 `packages/` 后，若需刷新 shim：

```powershell
node scripts/generate-monorepo-shims.mjs
```

**不要**直接编辑 `server/_shared`、`server/platform` 下的 shim 文件。

---

## 7. npm 包名对照

| 根命令 | Workspace 包 |
|--------|----------------|
| `npm run platform:api` | `@hxxworldmonitor/platform-api` |
| `npm run platform:scheduler` | `@hxxworldmonitor/platform-scheduler` |
| `npm run platform:executor` | `@hxxworldmonitor/platform-executor` |
| `npm run admin:dev` | `@hxxworldmonitor/admin` |
| `npm run platform:ingest` | `@hxxworldmonitor/platform-ingest` |
| … | 见根 `package.json` 的 `platform:*` 脚本 |

在子工程目录内也可直接运行，例如：

```powershell
cd apps/platform-api
npm run start
```

---

## 8. 兼容层说明

为不破坏现有 Vite（`vite.config.ts` 仍 `import` `server/_shared/load-env`）与 sebuf 中间件，`server/_shared/*.ts` 与 `server/platform/**/*.ts` 均为单行 re-export：

```typescript
export * from '@hxxworldmonitor/shared/db.js';
```

长期计划：主前端与 sebuf 迁出后删除 shim。见 [MONOREPO.md](./MONOREPO.md)「后续迁移」。

---

## 9. 尚未迁移（已知限制）

| 项 | 现状 |
|----|------|
| 主仪表盘 `src/` | 仍在仓库根，通过根 `npm run dev` 启动 |
| sebuf `/api/*` | 仍在根 `vite.config.ts` + `server/worldmonitor/` |
| RSS 解析 | `platform-core` 引用根 `server/worldmonitor/news/` |
| 根 `/admin` 路由 | 仍可用；**推荐**改用 `npm run admin:dev` (:3001) |
| `shared` ↔ `platform-core` | `hxxbot-config` 存在循环依赖（与原单仓相同，运行时可用） |

---

## 10. 相关文档

- [MONOREPO.md](./MONOREPO.md) — 简明速查
- [Platform消费生产端拆分设计.md](./Platform消费生产端拆分设计.md) — 消费/生产架构与 Job 调度
- [Platform后台启动与运行设计.md](./Platform后台启动与运行设计.md) — 启动流程与 Worker 说明
- [deploy/README.md](../deploy/README.md) — 自托管快速开始
