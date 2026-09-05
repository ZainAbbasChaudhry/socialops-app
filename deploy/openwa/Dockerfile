# Baileys NOWEB needs no browser, so this stays a plain slim Node image -
# no chromium layer, no shared-library dance, ~150MB instead of ~1GB.
FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

# Paired session credentials live here and MUST be a persistent volume.
RUN mkdir -p /data/sessions && chown -R node:node /data /app
USER node

ENV NODE_ENV=production
ENV SESSIONS_DIR=/data/sessions
EXPOSE 3010

CMD ["node", "src/server.js"]
