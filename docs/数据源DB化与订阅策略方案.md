# 数据源从 .env.local 迁到数据库 + 管理后台

## 范围

| 纳入 DB + 后台 | 继续保留 `.env.local`（启动/bootstrap） |
|----------------|----------------------------------------|
| 外部 API Key、HXXBOT、AI 模型（`integration_providers`） | `DATABASE_URL`、`PLATFORM_JWT_SECRET`、`PLATFORM_API_PORT`、`PLATFORM_DB_AUTO_MIGRATE` |
| RSS 源目录（代码 catalog） | **OSS** 全套、`REDIS_URL`/`REDIS_RESP`、**Upstash**、**全部 `VITE_*`** |
| Platform 日志级别/路径（可选） | 采集间隔、digest 窗口等 **运行参数**（非密钥） |

---

## Phase 0（优先）— 订阅开关 + 可订阅目录 + 用户自助订阅/取消

> **状态：已实现**（migration `012`，见下方 API/UI 说明）

控制「信息量」与「可订阅数量」，前端从后端拉取可订阅列表并完成订阅/取消。

### 新增配置项（Admin「系统设置」）

| 字段 | 类型 | 说明 |
|------|------|------|
| `self_service_subscriptions_enabled` | BOOLEAN DEFAULT true | 总开关：关闭后 API 拒绝 POST/DELETE |
| `max_subscriptions_per_user` | INT DEFAULT 0 | 订阅上限；0 = 不限制 |

单项启用/禁用：继续用 `subscription_presets.enabled`（Admin「可订阅项」）。

### 用户 API

| 端点 | 说明 |
|------|------|
| `GET /platform/v1/auth/catalog` | enabled 预设 + 已订状态 + 上限信息 |
| `POST /platform/v1/auth/subscriptions` | `{ presetId }` 订阅 |
| `DELETE /platform/v1/auth/subscriptions/:id` | 取消自己的订阅 |

### 验收

1. Admin 关闭自助订阅 → 前端无订阅按钮，API 403
2. Admin 设上限 2 → 第 3 次订阅被拒绝
3. Admin 禁用可订阅项 → catalog 不再出现
4. 用户可订阅/取消，刷新后状态一致

---

## Phase 1 — 第三方数据源凭证 DB 化（base_url + api_key）

> **状态：已实现（HXXBOT 已接入；其余 provider 种子已入库，handler 改造见 Phase 2）**

### 设计原则

- **数据库只存两项**：`base_url` + 加密 `api_key`（及 `enabled` 开关）。
- **具体 API 路径写死在代码里**（如 `/v1/tools/...`、`/series/observations`），不在后台配置。
- **启动时自动检测**：`platform:api` 启动 → `runPlatformDbBootstrap()` 执行 migration `013` 建表 → `runPlatformSeedBootstrap()` 按 catalog 插入缺失行。

### 表结构

Migration：`deploy/init/013_schema_integration_providers.sql` → `integration_providers`

| 字段 | 说明 |
|------|------|
| `slug` | 内置标识（如 `hxxbot`、`groq`、`fred`） |
| `base_url` | API 根地址，可覆盖 catalog 默认值 |
| `api_key_enc` | AES 加密密钥 |
| `enabled` | 是否启用 |

Catalog 定义：`server/platform/integration-provider-catalog.ts`（~18 个 provider，含默认 Base URL 与 env 回退名）。

### Admin API / UI

| 端点 | 说明 |
|------|------|
| `GET /platform/v1/admin/integrations` | 外部数据源列表（不含 AI） |
| `PATCH /platform/v1/admin/integrations/:slug` | 更新 data 类 base_url / api_key / enabled |
| `GET /platform/v1/admin/ai-models` | AI 模型列表（Groq / OpenRouter / OpenAI 兼容） |
| `PATCH /platform/v1/admin/ai-models/:slug` | 更新 AI 类 base_url / model_name / api_key / enabled |
| `POST /platform/v1/admin/ai-models/:slug/test` | 测试连接（可用表单草稿，Key 留空则用已存配置） |

管理后台侧栏分两项：
- **AI 模型** — 摘要 LLM（含模型名）
- **数据源配置** — HXXBOT、行情、宏观、Relay 等（仅 Base URL + API Key）

### 运行时解析

- `getIntegrationProvider(slug)` / `getIntegrationProviderCached(slug)`：DB → `.env.local` 回退。
- HXXBOT：`server/_shared/hxxbot-config.ts` 启动时 `refreshHxxbotConfigCache()`；Admin 保存后刷新缓存。

### 验收

1. 全新库启动 `npm run platform:api` → 自动建表 + 插入全部 provider 行
2. Admin「数据源配置」可见 catalog 列表，可编辑 HXXBOT
3. 清空 DB Key 后功能不可用，须在 Admin 填写（不再回退 .env.local）
4. 禁用 provider → 对应功能不可用

---

## Phase 2 — 外部 API Key handler 改造

**之前表述容易误解**：「40+」指的是代码里 **约 40 个文件** 直接读 `process.env`，**不是** 40 多个互不相关的外部 API Key。

### 实际有多少个「外部 API Key」？

按 **独立第三方凭证** 统计（不含 OSS/Redis/VITE/Platform 启动项），约 **20 个 env 名**，归并成 **12 个业务分组**：

| 分组 | env 变量 | 用途 | 代码引用次数（约） |
|------|----------|------|-------------------|
| AI 摘要 | `GROQ_API_KEY`、`OPENROUTER_API_KEY`、`OLLAMA_*` | 同一套摘要链路，Groq 主 / OpenRouter 备 / Ollama 本地 | 4–6 处 |
| 股票行情 | `FINNHUB_API_KEY` | 市场面板 | 2 处 |
| 宏观数据 | `FRED_API_KEY` | 经济雷达、供应链运价等 | 3 处 |
| 能源 | `EIA_API_KEY` | 油价/产能 | 3 处 |
| 贸易 | `WTO_API_KEY` | 贸易面板 | 1 处 |
| 冲突抗议 | `ACLED_ACCESS_TOKEN` | 冲突层 | 1 处（共享模块） |
| 网络中断 | `CLOUDFLARE_API_TOKEN` | Radar outage | 1 处 |
| 山火 | `NASA_FIRMS_API_KEY` | 卫星热点 | 1 处 |
| 飞机增强 | `WINGBITS_API_KEY` | ADS-B  enrich | 4 处 |
| 航空 | `AVIATIONSTACK_API`、`ICAO_API_KEY` | 机场延误/NOTAM | 2 处 |
| 网络威胁 | `URLHAUS_AUTH_KEY`、`OTX_API_KEY`、`ABUSEIPDB_API_KEY` | **同一 cyber 面板** 三个源 | 1 个 `_shared.ts` |
| Relay 中继 | `WS_RELAY_URL`、`RELAY_SHARED_SECRET`、`AISSTREAM_*`、`OPENSKY_*` | 船舶/飞机/RSS 代理 **共用 Relay** | 15+ 处（同一 Secret 重复读） |
| Telegram | `TELEGRAM_API_ID/HASH/SESSION` | Relay 侧 OSINT | 独立脚本 |
| HXXBOT | `HXXBOT_SITE_URL`、`HXXBOT_API_KEY` | 订阅发信/翻译 | 1 个 config 模块 |
| 订阅 Platform | `HXXBOT_*` + 采集参数 | 与仪表盘部分重叠 | 见 Phase 1 |

**结论**：
- 后台 UI 不必做 40 个输入框，按 **12 个分组 Tab** 即可（每组 1–3 个 Key）。
- Phase 2 工作量大，是因为要把 **多处重复的 `process.env` 调用** 改成统一的 `getIntegrationSetting()`，而不是因为 Key 特别多、互不相干。
- 大量 **RSS / 公开 API（UCDP、UNHCR、Open-Meteo 等）根本不要 Key**，不在此列。

### Phase 2 实施方式

- 使用 Phase 1 的 `integration_providers`（每组 slug 一行，仅 base_url + api_key）
- 改造 **约 25–30 个 handler/模块** 改为 `getIntegrationProvider('groq')` 等
- Admin UI 已在 Phase 1 统一为「数据源配置」列表，Phase 2 只需逐个接入 handler

---

## `.env.local` 变量统计（纳入迁移，不含 OSS/Redis/VITE）

| 类别 | 数量 | 说明 |
|------|------|------|
| **外部 API Key（独立凭证）** | **~20 个 env 名** | 上表 12 组，非 40+ 个无关 API |
| Relay / Telegram 连接项 | ~10 | URL、Secret、OpenSky 等，多文件重复读 |
| Platform 运行参数（非密钥） | ~15 | 采集间隔、digest 窗口等 |
| HXXBOT | 2–3 | 与订阅链路相关 |
| RSS 源 | 0 个 env | 硬编码 ~150 条，Phase 3 进 DB |

**合计 env 名约 45–50**，但其中 **真正需要管理员填写的第三方 Key 只有 ~20 个**，且 **高度分组、有共享**。

## 必须留在 env 的项

`DATABASE_URL`、`PLATFORM_JWT_SECRET`、`PLATFORM_API_PORT`、`PLATFORM_DB_AUTO_MIGRATE`、Redis/OSS/VITE_*、Platform **运行参数**（采集间隔等）

**勿再写入 .env.local：** `GROQ_*`、`OPENROUTER_*`、`OLLAMA_*`、`HXXBOT_*`、`FINNHUB_*`、`FRED_*` 等已迁入 `integration_providers` 的密钥 — 统一在 `/admin` 配置。

## 工作量粗估（修正）

| 阶段 | 人天 | 说明 |
|------|------|------|
| Phase 0 | 3–5 | 已实现 |
| Phase 1 | 4–6 | **已实现**：integration_providers + Admin 数据源配置 + HXXBOT |
| Phase 2 | **8–12** | 12 组 Key + ~25 文件改读 settings（非 40 个 Key） |
| Phase 3 | 6–10 | Relay/Telegram + RSS |
| **合计** | **21–33** |
