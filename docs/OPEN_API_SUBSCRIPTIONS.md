# 开放 API — 订阅管理

供第三方程序通过 **用户 API Key** 管理订阅，无需 JWT 登录。

## 获取 API Key

### 方式 A：用户在「我的账户」自助（推荐）

1. 登录 World Monitor
2. 打开 **我的账户** → **API Key** 区块
3. 点击 **创建 API Key** → **复制**
4. 粘贴到第三方应用的配置项

深链（未配置 Key 时引导用户）：

```
https://<monitor-host>/?account=apiKey
```

### 方式 B：服务端自动开通（Integration Secret）

需配置 `PLATFORM_INTEGRATION_SECRET`，仅第三方**后端**使用。

```bash
curl -X POST "http://localhost:8787/platform/v1/open/users" \
  -H "Authorization: Bearer $PLATFORM_INTEGRATION_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","permanent":true}'
```

## 鉴权

| 场景 | Header |
|------|--------|
| 订阅操作 | `Authorization: Bearer wmuk_...` |
| 按邮箱开通用户/Key | `Authorization: Bearer <INTEGRATION_SECRET>` 或 `X-Integration-Key` |

## 接口列表

Base URL：`http://localhost:8787/platform/v1/open`（生产替换为实际域名）

### 用户 API Key 鉴权

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/catalog` | 可订阅项列表 |
| GET | `/subscriptions` | 当前用户订阅 |
| POST | `/subscriptions` | Body: `{ "presetId": "uuid" }` 添加订阅 |
| DELETE | `/subscriptions/{id}` | 取消订阅 |

### Integration Secret 鉴权

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/users/key?email=` | 按邮箱获取/生成 Key |
| POST | `/users` | 创建用户并确保有 Key |
| POST | `/users/key/rotate` | 轮换指定用户 Key |

## 示例

```bash
# 查询可订阅项
curl "http://localhost:8787/platform/v1/open/catalog" \
  -H "Authorization: Bearer wmuk_xxxxxxxx"

# 订阅
curl -X POST "http://localhost:8787/platform/v1/open/subscriptions" \
  -H "Authorization: Bearer wmuk_xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"presetId":"<preset-uuid>"}'

# 取消订阅
curl -X DELETE "http://localhost:8787/platform/v1/open/subscriptions/<subscription-id>" \
  -H "Authorization: Bearer wmuk_xxxxxxxx"
```

## 用户自助 API（JWT，供前端账户页）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/platform/v1/auth/api-key` | 查询 Key（含明文，供复制） |
| POST | `/platform/v1/auth/api-key` | 创建 |
| POST | `/platform/v1/auth/api-key/rotate` | 重新生成 |
| DELETE | `/platform/v1/auth/api-key` | 删除 |

## 错误码

| code | HTTP | 说明 |
|------|------|------|
| `invalid_api_key` | 401 | Key 无效或已吊销 |
| `api_key_expired` | 401 | Key 已过期（响应体含 `expiresAt`） |
| `missing_api_key` | 401 | 未提供 Key |
| `account_unavailable` | 403 | 用户账号已禁用或已删除 |
| `api_key_already_exists` | 409 | 已有 Key（JWT 创建接口） |
| `self_service_disabled` | 403 | 管理员关闭自助订阅 |
| `subscription_limit_reached` | 403 | 订阅数量达上限 |
| `already_subscribed` | 403 | 已订阅该预设 |
| `preset_not_found` | 404 | 预设不存在 |

## 配置

`.env.local`：

```env
PLATFORM_INTEGRATION_SECRET=your-long-random-secret
PLATFORM_USER_API_KEY_TTL_DAYS=0
```

`PLATFORM_USER_API_KEY_TTL_DAYS=0` 表示默认 **永久有效**。

重启 `npm run platform:api` 后自动应用 migration `019`（users 表 api_key 字段）。
