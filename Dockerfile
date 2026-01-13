FROM node:20

# Instala LibreOffice y dependencias del sistema
RUN apt-get update && \
    apt-get install -y libreoffice && \
    apt-get clean

# Establece la variable de entorno LIBREOFFICE_PATH para el contenedor
ENV LIBREOFFICE_PATH=/usr/bin/soffice

WORKDIR /app
COPY . .

RUN npm install

CMD ["npm", "start"]
