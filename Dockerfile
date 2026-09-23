FROM node:20-alpine

# node:20-alpine has no git binary by default — the "Nexus Code" repo-editing feature
# (dashboard/server/services/repoEditService.js) shells out to real git via simple-git to clone,
# commit, and push to a user's repo, which fails outright without this.
# ffmpeg: VC music transcodes any non-Opus YouTube audio (see src/services/vcMusicPlayer.js).
RUN apk add --no-cache git ffmpeg

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
