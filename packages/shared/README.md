# @hxxworldmonitor/shared

公共基础设施包（**源码目录**）。

| 模块 | 路径 |
|------|------|
| 数据库 | `src/db.ts` |
| 环境变量 | `src/load-env.ts`（优先 `apps/*/.env.local`，回退根目录） |
| 日志 | `src/platform-logger.ts` |
| 对象存储 | `src/blob-store.ts` |
| 鉴权 | `src/admin-auth.ts`, `src/platform-session.ts` |

`server/_shared/*.ts` 为兼容 shim，修改请编辑本目录后运行 `node scripts/generate-monorepo-shims.mjs`。
