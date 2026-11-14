# Multi-stage build for the Next.js dashboard.
# The web tier holds no execution keys; secrets are injected at runtime.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages ./packages
COPY services ./services
RUN npm ci --workspaces --include-workspace-root

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm --workspace @ops/web run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S ops && adduser -S ops -G ops
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/node_modules ./node_modules
USER ops
EXPOSE 3000
CMD ["npm", "--workspace", "@ops/web", "run", "start"]
