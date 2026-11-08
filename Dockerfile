# Dockerfile
FROM node:20-alpine

# Instalar dependências do sistema
RUN apk add --no-cache python3 py3-pip bash curl openssl

# Copiar arquivos
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Criar diretório de dados
RUN mkdir -p /app/data

# Expor porta
EXPOSE 8787

# Comando padrão
CMD ["npm", "start"]