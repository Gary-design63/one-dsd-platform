FROM node:20-slim
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY . .
EXPOSE 5000
ENV NODE_ENV=production
CMD ["node", "server.js"]
