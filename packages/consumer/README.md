# @hxxworldmonitor/consumer

消费端：**提供 HTTP**，不跑批处理 Worker。

| 组件 | 当前路径 / 命令 |
|------|-----------------|
| 前端 SPA + Admin | `src/`, `npm run dev` → `/admin` |
| Sebuf `/api/*` | `vite.config.ts` middleware |
| Platform API | `scripts/platform-api-server.ts` → `npm run platform:api` |

部署示意见 `deploy/consumer/`（待补充 compose 片段）。
