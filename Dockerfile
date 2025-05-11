# Imagen base oficial de Node.js
FROM node:18

# Establecer el directorio de trabajo dentro del contenedor
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar las dependencias de la app
RUN npm install --omit=dev

# Copiar el resto de los archivos del proyecto
COPY . .

# Variables de entorno (puedes comentarlas si prefieres usar .env)
ENV NODE_ENV=production \
    PORT=3000

# Puerto que usará la aplicación
EXPOSE 3000

# Comando por defecto al ejecutar el contenedor
CMD ["node", "server.js"]
