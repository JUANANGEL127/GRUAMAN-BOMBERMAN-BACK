FROM node:20

# Instala LibreOffice y dependencias del sistema
RUN apt-get update && \
    apt-get install -y libreoffice && \
    apt-get clean

WORKDIR /app
COPY . .

RUN npm install

CMD ["npm", "start"]
