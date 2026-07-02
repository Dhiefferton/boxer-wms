# Deploy do WMS Boxer

Mesmo padrão do Boxer Requisições: **Railway** para backend + banco,
**Render** para os dois frontends.

## 1. Banco de dados (Railway)

1. No Railway, crie um projeto novo (ex: `wms-boxer`)
2. Add a plugin/service → **PostgreSQL**
3. Assim que o banco subir, abra a aba **Connect** e copie a `DATABASE_URL`
4. Rode o schema contra esse banco (só uma vez):
   ```
   psql "COLE_A_DATABASE_URL_AQUI" -f wms-schema.sql
   psql "COLE_A_DATABASE_URL_AQUI" -f wms_motor_alocacao.sql
   ```
   Se não tiver `psql` instalado localmente, dá pra rodar isso de dentro
   do próprio Railway (aba **Data** → **Query**), colando o conteúdo dos
   dois arquivos `.sql` na ordem.

## 2. API (Railway)

1. No mesmo projeto do Railway, **New Service → GitHub Repo** apontando
   pra pasta `wms-api` (se for monorepo, defina o **Root Directory**
   como `wms-api` nas configurações do serviço)
2. Variáveis de ambiente do serviço:
   - `DATABASE_URL` → a mesma do passo 1 (o Railway consegue linkar
     automaticamente se o banco estiver no mesmo projeto - procure a
     opção "Add Reference")
   - `PORT` → o Railway já injeta essa variável sozinho, não precisa setar
3. Deploy. Depois, copie a URL pública gerada (algo como
   `https://wms-api-production.up.railway.app`) - vai precisar dela no
   passo 4.

## 3. Serviço de polling do ZenERP (Railway)

1. **New Service** de novo, apontando pra pasta `wms-zenerp-poller`
2. Variáveis de ambiente (copie de `.env.example` e preencha de verdade):
   - `DATABASE_URL` (mesma do banco)
   - `ZENERP_BASE_URL`, `ZENERP_PEDIDOS_PATH`, `ZENERP_BEARER_TOKEN`, `ZENERP_TENANT_KEY`
   - `POLL_INTERVAL_MINUTES=3`
3. Esse serviço não precisa de domínio público (é um processo rodando
   em loop, não um servidor web) - o Railway trata isso normalmente
   como "Worker", sem gerar URL.

## 4. Dashboard web (Render)

1. No Render: **New → Static Site**, conecte o repositório, aponte
   **Root Directory** para `wms-dashboard`
2. Build Command: `npm install && npm run build`
3. Publish Directory: `dist`
4. Environment Variables:
   - `VITE_API_URL` → a URL da API que você copiou no passo 2
     (ex: `https://wms-api-production.up.railway.app`)
5. Deploy.

## 5. App do coletor (Render)

Igual ao passo 4, mudando só o Root Directory pra `wms-coletor`.
Esse é o endereço que você vai abrir no navegador do próprio coletor
Zebra/Honeywell.

## Depois do primeiro deploy

- **CORS**: hoje a API aceita chamadas de qualquer origem (`cors()`
  sem restrição). Funciona, mas quando tudo estiver no ar de verdade,
  vale restringir só aos domínios do Render (dashboard e coletor) -
  é uma linha só pra mudar em `wms-api/index.js`.
- **Cadastro inicial**: depois do primeiro deploy, o banco está vazio.
  Antes de operar de verdade, cadastre pelo menos: os produtos (tela
  Produtos), uma área do flutuante (tela Áreas do flutuante) e os
  endereços do vertical (tela Cadastro de endereços, que gera todas
  as combinações de prédio × andar × posição de uma vez).
