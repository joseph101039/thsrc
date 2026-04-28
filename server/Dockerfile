FROM node:24-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
ENV PORT=8081
ENV DB_PATH=/app/data/thsrc.db
EXPOSE 8081
CMD ["node", "--experimental-sqlite", "src/api.js"]
