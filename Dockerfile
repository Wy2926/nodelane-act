# Reproducible source build for MCP directory introspection.
# Real website operations require the companion extension on the user's computer;
# this image does not provide a hosted browser or a public MCP endpoint.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
COPY sites ./sites
COPY extension ./extension
RUN npm run build

FROM node:22-bookworm-slim
LABEL org.opencontainers.image.title="NodeLane Act" \
      org.opencontainers.image.source="https://github.com/Wy2926/nodelane-act" \
      org.opencontainers.image.licenses="MIT" \
      io.modelcontextprotocol.server.name="io.github.Wy2926/nodelane-act"
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/dist/server ./dist/server
COPY --from=build --chown=node:node /app/dist/licenses ./dist/licenses
COPY --chown=node:node LICENSE ./LICENSE
USER node
ENTRYPOINT ["node", "dist/server/index.js"]
