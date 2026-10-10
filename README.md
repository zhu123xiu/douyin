# 亲子沟通百宝箱抖音小程序

本项目在保留微信版业务代码的基础上，增加了抖音小程序运行适配：

- `miniprogram/utils/cloud.js` 在抖音运行时通过 `tt.createCloud` 调用抖音云容器 `api` 服务；微信运行时仍保留原云函数兼容路径。
- 页面模板已切换为抖音的 `tt:` 条件与列表指令，旧页面脚本通过启动时平台 API 兼容映射复用。
- `miniprogram/config/payment.js` 和购买流程改为抖音 `tt.pay`，iOS 端只保留激活码入口。
- `douyin-cloud/` 是可部署到抖音云的 Express 服务，直连既有 CloudBase 数据库；密钥只通过配置中心环境变量注入。

部署抖音云服务前，请复制 `douyin-cloud/.env.example` 到配置中心并填写密钥、商户号、支付 SALT 与回调地址。