FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY deployment/remote/npm-shrinkwrap.json ./npm-shrinkwrap.json
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN ./node_modules/.bin/tsc && npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production LOCALSBNB_REMOTE_BIND_HOST=0.0.0.0
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY deployment/remote/migrations ./deployment/remote/migrations
USER node
EXPOSE 8787
CMD ["node", "dist/remote/runtimeIndex.js"]
