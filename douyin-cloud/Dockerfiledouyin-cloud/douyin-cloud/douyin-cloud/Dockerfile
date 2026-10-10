# 抖音云 Node 基础镜像（平台内部源，可正常拉取）
FROM public-cn-beijing.cr.volces.com/public/dycloud-node:18-alpine

# 项目根目录
WORKDIR /opt/application/

# 仓库根目录为构建上下文：把 douyin-cloud 子目录内容作为应用根
COPY douyin-cloud/ ./

USER root

# 安装依赖
RUN npm install --registry=https://registry.npmmirror.com

# 写入启动脚本（package.json 的 start 即 node server/index.js）
RUN echo -e '#!/usr/bin/env bash\ncd /opt/application/ && npm start' > /opt/application/run.sh
RUN chmod a+x /opt/application/run.sh

EXPOSE 8000
