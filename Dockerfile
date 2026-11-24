# MyTV-Time — see docs/INSTALL.md
# ---- build stage --------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder
# better-sqlite3 downloads a prebuilt binary; these tools are only used if none matches.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage ------------------------------------------------------------------------
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
	DB_PATH=/data/tracker.db \
	PORT=3000 \
	TZ=Europe/Paris
# Full node_modules (incl. tsx) plus src/ and scripts/ so that
# `docker compose exec app npm run import -- …` and `npm run backup -- …` work in the container.
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
VOLUME /data
EXPOSE 3000
CMD ["node", "build"]
