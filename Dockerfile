# ---- Build stage: compile TypeScript ----
FROM node:20-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage: production deps + compiled output only ----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY public ./public

# Cloud Run sets PORT itself (defaults to 8080); src/config/env.ts already
# reads process.env.PORT, so no code changes are needed.
EXPOSE 8080

CMD ["node", "dist/server.js"]
