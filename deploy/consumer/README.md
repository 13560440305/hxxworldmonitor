# Consumer 部署（示意）

消费端：**对外 HTTP**（静态资源 + Platform API + Vite dev 代理）。

```powershell
npm run platform:api    # :8787 Platform REST
npm run dev               # :3000 前端 + /admin + /api 代理
```

生产环境通常：

- 静态文件由 CDN / Nginx 提供 `dist/`
- `platform:api` 多副本 behind load balancer
- **不**部署 ingest / scheduler / executor

Monorepo 包入口：`packages/consumer/`。
