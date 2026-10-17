FROM node:22.22.0-bookworm-slim AS build
WORKDIR /src

COPY package.json package-lock.json ./
COPY apps/client/package.json apps/client/package.json
COPY site/package.json site/package.json
RUN npm ci

COPY apps/client apps/client
RUN npm run build --workspace @in-three/client && npm prune --omit=dev

FROM node:22.22.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /src /app
WORKDIR /app/apps/client
USER node
EXPOSE 3333 3334
CMD ["node", "dist/server/server.js"]
