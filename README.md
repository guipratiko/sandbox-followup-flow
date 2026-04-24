# Follow-up Flow

Microserviço **Docker** (EasyPanel) para sequências de mensagens de acompanhamento no **CRM** OnlyFlow.

- **API**: `GET/POST/PATCH/DELETE /api/followup-flow/...`
- **Banco**: mesmas tabelas Postgres do backend (`crm_followup_*`) — aplique a migration `045_crm_followup_flow.sql` no Postgres do OnlyFlow.
- **Auth**: header `Authorization: Bearer <JWT>` (mesmo token do OnlyFlow). O backend proxy envia também `x-effective-user-id` (titular CRM) para subusuários.
- **Envio**: Evolution API (`EVOLUTION_API_BASE_URL` + `EVOLUTION_API_KEY`). Instâncias **WhatsApp Cloud** não são suportadas nesta versão (criação retorna erro).

## Variáveis de ambiente

Ver `.env.example`.

## Integração OnlyFlow (backend)

No `.env` do backend:

```env
FOLLOWUP_FLOW_SERVICE_URL=https://seu-followup-flow.easypanel.host
```

O proxy expõe ` /api/followup-flow/*` com autenticação e módulo CRM.

## Build local

```bash
npm install
npm run build
npm start
```

## Worker

O processo executa um ciclo a cada **45 segundos** que busca etapas `pending` com `scheduled_at <= now()` e sequência `active`, envia pela Evolution e atualiza status.
