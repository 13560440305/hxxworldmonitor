# Producer 部署（示意）

生产端进程清单，与消费端 **分开扩缩容**。

```powershell
# 必选：调度 + 执行
npm run platform:scheduler
npm run platform:executor

# 或使用单终端 dev 组合
npm run platform:producer

# 可选 Tier1/2（也可用 job_definitions 代替常驻 Worker）
npm run platform:ingest:fast
npm run platform:ingest
npm run platform:embed
```

环境变量与 `deploy/README.md` 相同；无需暴露 `PLATFORM_API_PORT` 给公网。

Monorepo 包入口：`packages/producer/`。
