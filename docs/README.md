# 文档索引

> **部署形态：仅 B/S**（浏览器访问仪表盘 + Platform API / Workers）。不再维护 Tauri 桌面打包；**桌面实现代码（`src-tauri/` 等）已从仓库移除**。  
> **完整清单（每个 md 是干什么的）：** [文档说明清单.md](./文档说明清单.md)

---

## 主文档（必读）

| 文档 | 回答什么 |
|------|----------|
| [系统目标与架构.md](./系统目标与架构.md) | 系统目标、整体架构、分层与各层职责 |
| [数据源说明.md](./数据源说明.md) | 全部数据源分类、配置方式、与订阅/采集的关系 |
| [功能清单.md](./功能清单.md) | 计划功能、已实现、未实现 |
| [文档说明清单.md](./文档说明清单.md) | **全库文档用途对照表**（含根目录 md） |

产品英文长文档（面板/图层细节）：[DOCUMENTATION.md](./DOCUMENTATION.md)（现状以中文主文档为准）  
运维快速开始：[deploy/README.md](../deploy/README.md)

---

## 文档原则

1. **一份真相**：同一主题只保留一份权威说明；过时或重复文直接删除。
2. **路径跟代码**：以 `apps/`、`packages/`、根 `package.json` 的 `platform:*` 为准。
3. **产品面（仅 B/S）**：
   - **仪表盘 OSINT**（`npm run dev`，`/api/*`）
   - **自托管 Platform**（`platform-api` + Workers，`/platform/v1/*`）
4. **数据源 ≠ 可订阅项**：见 [数据源说明.md](./数据源说明.md)。
5. **状态可核对**：以 [功能清单.md](./功能清单.md) + 代码为准。
6. **增删文档**：同步更新 [文档说明清单.md](./文档说明清单.md)。

---

## 专题文档（摘要）

完整说明见 [文档说明清单.md](./文档说明清单.md) 第二节。

| 文档 | 用途 |
|------|------|
| [MONOREPO.md](./MONOREPO.md) / [Platform-Monorepo拆分说明.md](./Platform-Monorepo拆分说明.md) | workspaces |
| [Platform消费生产端拆分设计.md](./Platform消费生产端拆分设计.md) | Job / Scheduler |
| [Platform后台启动与运行设计.md](./Platform后台启动与运行设计.md) | 多进程启动 |
| [订阅与可订阅项说明.md](./订阅与可订阅项说明.md) / [OPEN_API_SUBSCRIPTIONS.md](./OPEN_API_SUBSCRIPTIONS.md) | 邮件订阅 |
| [AIS-RSS-RELAY.md](./AIS-RSS-RELAY.md) / [RELAY_PARAMETERS.md](./RELAY_PARAMETERS.md) | Relay |
| [ADDING_ENDPOINTS.md](./ADDING_ENDPOINTS.md) | 新增 sebuf API |
