FROM node:20-alpine

WORKDIR /app
COPY AppAgent.html /app/AppAgent.html
COPY assets /app/assets
COPY server.js /app/server.js

EXPOSE 8080
CMD ["node", "server.js"]
