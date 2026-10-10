# 抖音云 API 服务

该服务对应迁移方案中的 `api` 容器，使用 `@cloudbase/node-sdk` 直连现有 CloudBase 数据库。小程序通过 `tt.createCloud({ envID, serviceID }).callContainer()` 调用 `/api/*` 路由。

部署前将 `.env.example` 中的变量配置到抖音云配置中心，密钥不进入仓库、不写入前端。