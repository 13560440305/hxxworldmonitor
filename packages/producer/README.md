# @hxxworldmonitor/producer

生产端：**无 HTTP**，写 PostgreSQL / OSS。

| Tier | 命令 |
|------|------|
| 调度 + 执行 | `npm run platform:producer`（或分别 scheduler / executor） |
| Tier1 快讯 | `npm run platform:ingest:fast` |
| Tier2 全量 | `npm run platform:ingest` |
| Tier2 向量 | `npm run platform:embed` |

Job 定义与 Handler：`server/platform/jobs/`。

部署示意见 `deploy/producer/`。
