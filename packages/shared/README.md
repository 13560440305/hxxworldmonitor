# @hxxworldmonitor/shared

Phase 3 Monorepo 脚手架（**源码尚未迁移**）。

| 计划归属 | 当前路径 |
|----------|----------|
| DB / 迁移 | `server/_shared/db.ts`, `deploy/init/` |
| 日志 | `server/_shared/platform-logger.ts` |
| 环境变量 | `server/_shared/load-env.ts` |

完整拆分后，consumer 与 producer 包将依赖此 shared 包。
