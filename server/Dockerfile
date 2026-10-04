# Self-hosted Pigma: built static assets + the collaboration relay.
#
#   docker build -f server/Dockerfile -t pigma .
#   docker run --rm -p 8080:8080 -v pigma-data:/app/data pigma
#
# Optional room token:  docker run ... -e PIGMA_ROOM_TOKEN=choose-a-token pigma
#
# Two stages: the first builds the app, the second serves it. The relay itself
# uses only Node built-ins; vite-node is present only to run the TypeScript
# entry, so the runtime stage reuses the build stage's modules instead of
# installing again.

# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.app.json tsconfig.node.json* ./
COPY vite.config.ts index.html ./
COPY src ./src
COPY server ./server
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    STATIC_DIR=/app/dist \
    DATA_DIR=/app/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# vite-node resolves the tsconfig project references, so all of them are needed.
COPY --from=build /app/tsconfig.json /app/tsconfig.app.json /app/tsconfig.node.json ./
COPY src ./src
COPY server ./server
RUN mkdir -p /app/data
VOLUME /app/data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["npx", "vite-node", "server/index.ts"]
