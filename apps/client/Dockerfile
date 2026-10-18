FROM node:22.22.0-bookworm-slim AS dependencies
ENV NODE_ENV=production
WORKDIR /app

COPY package.json npm-shrinkwrap.json ./
COPY apps/client/package.json apps/client/package.json
COPY site/package.json site/package.json
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22.22.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules /app/node_modules
COPY --chown=node:node package.json /app/package.json
COPY --chown=node:node apps/client/package.json /app/apps/client/package.json
COPY --chown=node:node apps/client/dist /app/apps/client/dist
COPY --chown=node:node deploy /app/deploy
WORKDIR /app/apps/client
USER node
EXPOSE 3333 3334
CMD ["node", "dist/server/server.js"]
