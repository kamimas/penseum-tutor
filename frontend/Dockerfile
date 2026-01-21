FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# For POC we run dev mode
CMD ["npm", "run", "dev"]
