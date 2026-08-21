FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install all dependencies including devDependencies to build frontend assets
COPY package*.json ./
RUN npm install

# Bundle app source
COPY . .

# Build dashboard client static bundle
RUN npm run build

# Prune devDependencies to keep image light
RUN npm prune --production

# Expose the port
EXPOSE 3000

# Start the unified bot + dashboard process
CMD [ "npm", "start" ]
