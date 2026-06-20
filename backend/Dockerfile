FROM node:22-alpine
WORKDIR /app
COPY package.json .
RUN npm install
# Le code source est monté en volume — pas de COPY src/
CMD ["node", "--watch", "src/index.js"]
