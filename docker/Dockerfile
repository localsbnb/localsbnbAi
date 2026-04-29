FROM node:18-alpine AS builder

WORKDIR /app

# 复制依赖文件
COPY package*.json ./
RUN npm ci

# 复制源代码
COPY . .

# 构建项目
RUN npm run build

# 生产环境镜像
FROM node:18-alpine

WORKDIR /app

# 复制依赖文件并安装生产依赖
COPY package*.json ./
RUN npm ci --production

# 从构建阶段复制编译后的代码
COPY --from=builder /app/dist ./dist

# 创建日志目录
RUN mkdir -p logs

# 暴露端口（如果需要HTTP传输）
EXPOSE 3000

# 启动命令
CMD ["node", "dist/index.js"]
