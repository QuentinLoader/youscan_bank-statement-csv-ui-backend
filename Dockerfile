# Use the Node version shown in your logs
FROM node:22.22.0-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package files first to take advantage of Docker's layer caching
COPY package*.json ./

# Install dependencies inside the container environment
RUN npm install

# Copy the rest of your application code
COPY . .

# Match the "start" script in your package.json
CMD ["npm", "start"]