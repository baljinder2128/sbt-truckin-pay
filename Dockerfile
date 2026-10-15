FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production DATA_DIR=/data TZ=Australia/Melbourne PORT=3000
VOLUME /data
EXPOSE 3000
CMD ["npm", "start"]
