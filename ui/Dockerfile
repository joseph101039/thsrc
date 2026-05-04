FROM node:24-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev 2>/dev/null || true
COPY . .
EXPOSE 8082
CMD ["node", "serve.js"]
