# Platform Admin（独立前端）

与主仪表盘分离的 **管理后台**，单独端口、单独配置。

## 开发

```powershell
# 终端 1 — Platform API
npm run platform:api

# 终端 2 — Admin（默认 :3001）
cd apps/admin
cp .env.example .env.local   # 或沿用仓库根 .env.local 中的 VITE_PLATFORM_API_URL
npm run dev
```

打开 http://localhost:3001

## 配置

| 文件 | 说明 |
|------|------|
| `apps/admin/.env.local` | 本应用专用（优先于根目录 `.env.local`） |
| 根目录 `.env.local` | 共享 fallback（`loadEnvLocal` 逻辑在 API/Worker 侧） |

| 变量 | 说明 |
|------|------|
| `VITE_PLATFORM_API_URL` | Platform API 地址，dev 下走 Vite 代理 `/platform` |
| `ADMIN_DEV_PORT` | 开发端口，默认 `3001` |

## 源码

- `src/main.ts` — 自 `src/platform-admin-main.ts` 迁出
- `src/services/platform-admin-api.ts` — Admin REST 客户端

根目录 `admin.html` / `src/platform-admin-main.ts` 仍保留作兼容，新开发请用本包。
