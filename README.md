# The Money App (local)

Tudo local por enquanto:
- Postgres via Docker Compose
- Backend Node.js + TypeScript + Prisma
- Conexão no DBeaver direto no Postgres

## Requisitos

- Docker Desktop (com Docker Compose)
- Node.js (já instalado)
- DBeaver

## 1) Subir o Postgres

### Opção A: Docker (recomendado)

Na raiz `The_Money_App`:

```powershell
docker compose up -d
```

### Opção B: Postgres instalado localmente (sem Docker)

- Instale o PostgreSQL (ex: 16.x) e garanta que o serviço esteja rodando.
- Crie usuário e database usando `The_Money_App/db/create_user_and_db.sql` (via psql ou DBeaver). (Dica: deixe Auto-commit ligado; `CREATE DATABASE` não roda dentro de transação.)
- Ajuste `DATABASE_URL` em `The_Money_App/backend/.env` se você usar host/porta/usuário/senha diferentes.

## 2) Rodar migrations e seed

```powershell
cd .\backend
Copy-Item .\.env.example .\.env
npm.cmd run db:deploy
npm.cmd run db:seed
```

## 3) Subir a API

```powershell
cd .\backend
npm.cmd run dev
```

API em `http://localhost:3333`.

## 3.1) Abrir a tela (HTML)

Abra `The_Money_App/The_Money_App HTML.html` no navegador.

- Em **API (avançado)**, use `http://localhost:3333/api`
- Faça **Register** (cria usuário local no Postgres) e depois **Login**

## 4) Conectar no DBeaver

Crie uma conexão PostgreSQL:
- Host: `localhost`
- Port: `5432`
- Database: `the_money`
- Username: `the_money`
- Password: `the_money`

## Endpoints (MVP)

- `GET /health`
- `GET /accounts` | `GET /accounts/:id` | `POST /accounts` | `DELETE /accounts/:id`
- `GET /categories` | `GET /categories/:id` | `POST /categories` | `DELETE /categories/:id`
- `GET /transactions` | `GET /transactions/:id` | `POST /transactions` | `DELETE /transactions/:id`
