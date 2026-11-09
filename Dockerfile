FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js remote.js dispatcharr.js index.html ./
ENV PORT=7421 DATA_DIR=/data
VOLUME /data
EXPOSE 7421
CMD ["node", "server.js"]
