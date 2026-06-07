# Self-hosted platform — 环境、编译与运行

完整方案说明见 [docs/自托管数据平台改造方案.md](../docs/自托管数据平台改造方案.md#环境配置编译与运行)。

---

## 快速开始（无 Docker，推荐）

本机已安装 **PostgreSQL** 即可开发 Phase 1，**不需要 Docker**。若执行 `npm run platform:up` 出现 `'docker' 不是内部或外部命令`，说明未装 Docker — 忽略该命令，按下面步骤即可。

### 步骤 1：安装依赖

```powershell
cd d:\curProject\h2x\hxxworldmonitor
npm install
```

### 步骤 2：配置环境变量

```powershell
copy .env.example .env.local
```

在 `.env.local` 中至少配置：

```env
DATABASE_URL=postgresql://postgres:你的密码@localhost:5432/hxxworldmonitor
PLATFORM_USE_PG_DIGEST=true
PLATFORM_DEFAULT_WORKSPACE_ID=00000000-0000-0000-0000-000000000001
VITE_PLATFORM_API_URL=http://localhost:8787
```

`VITE_PLATFORM_API_URL` 让前端新闻 digest **优先请求** Platform API。开发时 Vite 会把 `/platform/*` 代理到 8787（同源，不触发 CSP）；8787 不可用时回退 Vite `/api`。设为 `false` 可关闭。

密码含 `#` 等特殊字符时需 URL 编码，例如 `ABC123###` → `ABC123%23%23%23`。

完整 Platform 变量说明见 [`.env.platform.example`](./.env.platform.example)。

| 组件 | Phase 1 是否必须 |
|------|-----------------|
| PostgreSQL | **是** |
| pgvector | 否（Phase 2 语义检索再装） |
| Redis | 否 |
| OSS / MinIO | 否 |
| Docker | 否 |

### 步骤 3：创建数据库

用 `psql`、pgAdmin 等连接本机 PostgreSQL，执行：

```sql
CREATE DATABASE hxxworldmonitor;

\c hxxworldmonitor
CREATE EXTENSION IF NOT EXISTS pgcrypto;
GRANT ALL ON SCHEMA public TO postgres;
```

（若使用非 `postgres` 用户，将 `GRANT` 中的用户名改为实际用户。）

### 步骤 4：数据库结构（自动迁移）

**推荐**：只创建空库（步骤 3），之后**无需手动跑 migrate**——启动任意 Platform 后台进程时会自动检测并应用新迁移：

```powershell
npm run platform:api   # 或 platform:ingest / platform:subscription 等
```

日志示例：`checking database schema (auto-migrate on startup)…` → `applied new database migrations` 或 `database schema up to date`。

`npm run platform:db:migrate` 仅用于 CI/调试，与启动时逻辑相同。

关闭自动迁移：`.env.local` 设置 `PLATFORM_DB_AUTO_MIGRATE=false`

若未安装 **pgvector**，会输出警告并跳过向量表，**Phase 1 可正常使用**。见下方 [可选：安装 pgvector](#可选安装-pgvectorwindows)。

### 步骤 5：采集新闻（首次）

```powershell
npm run platform:ingest:once
```

将 RSS 写入 PostgreSQL。后续可改用 `npm run platform:ingest` 每 10 分钟定时采集。

### 步骤 6：启动服务

**需要两个终端：**

```powershell
# 终端 1 — Platform API (:8787)
npm run platform:api

# 终端 2 — 前端 (:3000)
npm run dev
```

验证 API：`http://localhost:8787/platform/v1/health`

配置 `VITE_PLATFORM_API_URL=http://localhost:8787` 后，前端打开新闻面板会向 8787 发 `GET /platform/v1/news/digest`（终端会打印请求日志）；失败时回退 Vite `/api`。

### 命令速查

| 命令 | 说明 |
|------|------|
| `npm run platform:db:init` | 初始化 schema（首次） |
| `npm run platform:db:migrate` | 手动触发迁移（可选；平时重启 `platform:api` 即可自动应用） |
| `npm run platform:ingest:once` | 采集一轮 RSS |
| `npm run platform:ingest` | 定时采集（10 分钟） |
| `npm run platform:api` | REST API (:8787) |
| `npm run dev` | 前端开发服务器 (:3000) |
| `npm run platform:up` / `platform:down` | **需 Docker Desktop**，见下方 |

---

## 1. 安装依赖

```powershell
cd d:\curProject\h2x\hxxworldmonitor
npm install
```

## 2. 环境变量

见 [快速开始 — 步骤 2](#步骤-2配置环境变量)。

## 3. 数据库（二选一）

### A. 本机 PostgreSQL（推荐，无 Docker）

见 [快速开始 — 步骤 3～4](#步骤-3创建数据库)。

#### 可选：安装 pgvector（Windows）

PostgreSQL 默认不带 `vector` 扩展。Phase 1 **不需要**；Phase 2 语义检索再装即可。

若 init 时提示 `extension "vector" is not available`：

1. 打开 [pgvector 安装说明](https://github.com/pgvector/pgvector#installation)，下载与 **PostgreSQL 大版本一致** 的 Windows 构建，或自行编译  
2. 将 `vector.dll` 放到 `PostgreSQL安装目录/lib`，`vector.control` 等放到 `.../share/extension`  
3. 在库中执行：`CREATE EXTENSION vector;`  
4. 再执行：`npm run platform:db:init`（会补上 `news_embeddings` 表）

### B. Docker（可选）

**前提：** 已安装并启动 [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/)。未安装时 `npm run platform:up` 会报错，请改用上方 [本机 PostgreSQL](#a-本机-postgresql推荐无-docker)。

```powershell
npm run platform:up
npm run platform:db:init
npm run platform:ingest:once
npm run platform:api
```

---

## 4. 编译

```powershell
# 类型检查
npm run typecheck:all

# 生产前端构建 → dist/
npm run build
npm run build:full    # full 变体

# 桌面版
npm run build:sidecar-sebuf
npm run build:desktop
```

日常开发 Platform 服务**不需要编译**，`tsx` 直接运行。

---

## 5. 运行（开发）

完整顺序见 [快速开始](#快速开始无-docker推荐)。

**两个终端（db:init 与 ingest 已完成的前提下）：**

```powershell
# 终端 1 — Platform API (:8787)
npm run platform:api

# 终端 2 — 前端 (:3000)
npm run dev
```

首次开发或清空库后，需先执行：

```powershell
npm run platform:db:init
npm run platform:ingest:once
```

---

## 6. 运行（生产预览）

```powershell
npm run build
npm run preview
```

---

## 7. Platform API

| 方法 | 路径 |
|------|------|
| GET | `/platform/v1/health` |
| GET | `/platform/v1/news/digest?variant=full&lang=en` | 新闻 digest（前端优先调用） |
| GET | `/platform/v1/news?variant=full&lang=en` |
| GET | `/platform/v1/aggregate/by-category` |
| POST | `/platform/v1/ingest/run` |
| POST | `/platform/v1/cold-tier/run`（需 OSS） |

### Phase 1 — AI Brief & 邮件订阅

前置：`.env.local` 配置 `HXXBOT_SITE_URL` + `HXXBOT_API_KEY`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/platform/v1/briefs/generate` | 生成 AI 简报写入 `briefs` |
| GET | `/platform/v1/briefs/latest` | 最新简报 |
| POST | `/platform/v1/briefs/email` | 生成并邮件发送简报 |
| POST | `/platform/v1/users` | 注册用户（email） |
| GET | `/platform/v1/users?email=` | 查询用户 |
| POST | `/platform/v1/subscriptions` | 创建订阅 |
| GET | `/platform/v1/subscriptions` | 订阅列表 |
| POST | `/platform/v1/subscriptions/{id}/match` | 匹配新闻 |
| POST | `/platform/v1/subscriptions/{id}/deliver` | 发送订阅邮件 |
| POST | `/platform/v1/subscriptions/deliver-all` | 全部启用订阅发信 |

订阅 worker：`npm run platform:subscription:once`（匹配 + 发信）

### 管理后台

1. 启动 `npm run platform:api`（自动迁移 + 建表；含用户角色 `admin` / `user`）
2. `.env.local` 配置管理员账号：
   ```env
   PLATFORM_ADMIN_EMAIL=admin@localhost
   PLATFORM_ADMIN_PASSWORD=你的强密码
   PLATFORM_JWT_SECRET=随机长字符串
   ```
3. 创建管理员（每个工作区仅一名）：`npm run platform:admin:init`
4. 启动：`npm run platform:api` 与 `npm run dev`
5. 浏览器打开：**http://localhost:3000/admin**，使用上述邮箱密码登录

重置管理员密码：`npm run platform:admin:init -- --reset-password`（需已存在管理员）

角色说明：`users.role` 仅两种 — **`admin`**（唯一，可登录后台）与 **`user`**（订阅用户，无密码）。

Admin API（登录后 Header `Authorization: Bearer {session_token}`）：

| 方法 | 路径 |
|------|------|
| POST | `/platform/v1/admin/login`（公开，body: `{ email, password }`） |
| GET | `/platform/v1/admin/stats` |
| GET | `/platform/v1/admin/meta` |
| GET/POST/PATCH/DELETE | `/platform/v1/admin/presets` |
| GET/POST | `/platform/v1/admin/users` |
| GET/POST/PATCH/DELETE | `/platform/v1/admin/subscriptions` |
| POST | `/platform/v1/admin/run/match-all` |
| POST | `/platform/v1/admin/run/deliver-all` |
| GET | `/platform/v1/admin/logs`（日志索引或 tail，`?service=&date=&lines=`） |
| GET | `/platform/v1/catalog`（公开，启用中的预设） |

### 文件日志

Platform 各进程将日志写入 **`logs/{服务名}/{YYYY-MM-DD}.log`**（项目根目录，可通过 `PLATFORM_LOG_DIR` 修改）：

| 服务名 | 进程 |
|--------|------|
| `platform-api` | `npm run platform:api` |
| `platform-ingest` | `npm run platform:ingest` / `platform:ingest:once` |
| `platform-embed` | `npm run platform:embed` / `platform:embed:once` |
| `platform-subscription` | `npm run platform:subscription` / `:once` |
| `platform-db-migrate` | `npm run platform:db:migrate` |

环境变量（`.env.local`）：

```env
# PLATFORM_LOG_DIR=logs          # 绝对或相对项目根
# PLATFORM_LOG_LEVEL=info      # debug | info | warn | error
# PLATFORM_LOG_TO_FILE=true
# PLATFORM_LOG_TO_CONSOLE=true
```

管理后台「系统日志」页可在线查看最近 300 行；排查错误时也可直接打开日志文件。

创建每日 AI 简报订阅示例：

```json
{
  "email": "you@example.com",
  "name": "每日世界简报",
  "rulesJson": {
    "mode": "daily_brief",
    "variant": "full",
    "lang": "zh"
  }
}
```

关键词订阅示例（含订阅语言与数据源语言）：

```json
{
  "email": "you@example.com",
  "name": "乌克兰局势",
  "rulesJson": {
    "keywords": ["ukraine", "乌克兰"],
    "categories": ["conflict"],
    "variant": "full",
    "contentLangs": ["en"],
    "deliveryLang": "zh",
    "hours": 24
  }
}
```

当 `deliveryLang` 与新闻 `lang` 不一致时，发信前调用 HXXBOT 翻译，结果写入 `content_translations` 表；若 OSS 已配置则归档到 `translations/{category}/{targetLang}/news_item/{id}.json.gz`。发信优先级：数据库内联标题 → OSS 文件 → 临时翻译并回写。

旧版 `lang` 字段仍兼容（同时作为内容过滤与订阅语言）。

### Phase 2 — AI Research API

前置：重启 `platform:api` 或 `platform:ingest` 以自动迁移 → `npm run platform:embed:once`（需 pgvector + 新闻已入库）

| 方法 | 路径 |
|------|------|
| POST | `/platform/v1/embedding/run` | 生成向量（body 可选 `{"batchSize":32}`） |
| GET | `/platform/v1/research/monitors` | 监控配置列表 |
| POST | `/platform/v1/research/monitors` | 创建监控（body 见下） |
| GET | `/platform/v1/research/monitors/{id}/report` | 语义检索报告 |
| POST | `/platform/v1/research/search` | 语义搜索（body: `{"query":"..."}`） |
| POST | `/platform/v1/research/entities/compare` | 实体声量对比 |

创建监控示例：

```json
{
  "monitorType": "competitor",
  "name": "OpenAI",
  "configJson": {
    "watchTerms": ["OpenAI", "ChatGPT"],
    "variant": "tech",
    "lang": "en"
  }
}
```

Phase 2 终端（可选第四个）：

```powershell
npm run platform:embed
```
