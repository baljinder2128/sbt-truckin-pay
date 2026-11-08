FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production DATA_DIR=/data TZ=Australia/Melbourne
EXPOSE 3000 8080
# Run node directly so it gets the stop signal and can finish saving to the online copy before Render sleeps it.
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
