FROM node:20-alpine
WORKDIR /app
COPY package.json server.js index.html ./
ENV PORT=7421
EXPOSE 7421
CMD ["node", "server.js"]
