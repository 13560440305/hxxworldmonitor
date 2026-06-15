# @hxxworldmonitor/platform-core

Platform 业务逻辑（**源码目录**）。

| 模块 | 路径 |
|------|------|
| Job 调度 | `src/jobs/` |
| RSS / 股票 / 财报 | `src/rss-ingest.ts`, `src/equity-ingest.ts` |
| Admin / 用户 API | `src/admin-api.ts`, `src/user-auth-api.ts` |
| 订阅 | `src/subscription-*.ts` |

依赖 `@hxxworldmonitor/shared`；RSS 解析仍引用仓库根 `server/worldmonitor/news/`（后续抽包）。

`server/platform/**` 为兼容 shim。
