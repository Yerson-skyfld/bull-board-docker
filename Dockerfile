# Multi-stage build for optimization
FROM node:24-alpine AS builder

WORKDIR /app
COPY . .
COPY package*.json ./
RUN npm ci --only=production --no-audit --no-fund

FROM node:24-alpine AS production

ENV NODE_ENV=production

ARG PORT=3000
ENV PORT=$PORT
EXPOSE $PORT

# Install dumb-init
RUN apk add --no-cache dumb-init

# Run as non-root user
USER node
WORKDIR /home/node/

# Copy node_modules from builder stage
COPY --from=builder --chown=node:node /app/node_modules ./node_modules

COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/src ./src

ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "start"]
