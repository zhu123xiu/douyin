# 抖音云 API 服务

该服务对应迁移方案中的 `api` 容器，使用 `@cloudbase/node-sdk` 直连现有 CloudBase 数据库。小程序通过 `tt.createCloud({ envID, serviceID }).callContainer()` 调用 `/api/*` 路由。

业务接口不再维护手写简化版本：`server/functions/` 中的五个模块来自项目根目录对应的微信云函数，除第一行改为引用 `../wx-compat` 外，其余源码保持一致。`server/wx-compat.js` 负责请求级 openid、`doc().get()` 返回值以及写入参数格式的兼容。

支付是唯一的例外。下单和回调继续使用抖音 ecpay，但订单使用微信侧统一字段 `item_type`、`item_id` 和小写状态；购买记录与会员状态由 `functions/payServiceRead.js` 读取。

部署前将 `.env.example` 中的变量配置到抖音云配置中心，密钥不进入仓库、不写入前端。

修改微信业务逻辑后，应重新同步对应云函数并只替换第一行 require，避免两端再次分叉。提交或部署前运行 `pnpm test`。
