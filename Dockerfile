FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

COPY . .

RUN mkdir -p /app/data && chown -R node:node /app

USER node

CMD ["node", "index.js"]