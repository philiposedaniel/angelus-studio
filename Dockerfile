# Production image. Requires `output: 'standalone'` in next.config.ts (already set).
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The build never connects to the database; placeholders satisfy config validation.
ARG NEXT_PUBLIC_SERVER_URL
ENV NEXT_PUBLIC_SERVER_URL=$NEXT_PUBLIC_SERVER_URL \
    DATABASE_URL=postgres://build:build@localhost:5432/build \
    PAYLOAD_SECRET=build-only-placeholder
RUN pnpm run build

# Throwaway preview with demo data (docker-compose.preview.yml). Keeps the full source so it can
# run migrations and `pnpm seed:demo`; never use it for the real site. Stays above `runner` so a
# build without a target still produces the production image.
FROM builder AS preview
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN mkdir -p /app/media /app/private-media
EXPOSE 3000
# `next start` warns that it does not suit standalone output; it still serves this full build.
CMD ["sh", "docker/preview-start.sh"]

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# The embedded PDF font (src/lib/pdfFonts.ts); file tracing includes it too, this keeps it certain.
COPY --from=builder /app/src/assets/fonts ./src/assets/fonts
# Upload folders; mount volumes here (see docker-compose.prod.yml).
RUN mkdir -p /app/media /app/private-media && chown nextjs:nodejs /app/media /app/private-media
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
