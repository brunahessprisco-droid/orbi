# Orbi — Issues Backlog

> Auditoria de código. Trabalhar em ordem de severidade.

---

## CRÍTICO

### [x] 1. Logout não limpa `hub_user_id` — `index.html`
Em browsers compartilhados, dados de um usuário são escritos no namespace de outro.
**Fix:** `logout()` agora remove `hub_user_id` e `hub_user_nome` além do `AUTH_KEY`.

### [x] 2. Admin secret hardcoded — `backend/src/api.ts`
Fallback `"orbi-admin-2025"` expõe listagem de usuários se a env var não estiver configurada no Render.
**Fix:** Removido fallback. Endpoints `/admin/users` e `/admin/create-invite` exigem `ADMIN_SECRET` no env.

### [x] 3. Logout retorna 200 OK mesmo quando o token não foi deletado do banco — `api.ts`
`.catch(()=>null)` no delete da sessão. UI confirma logout, token ainda válido.
**Fix:** Removido `.catch(()=>null)`. Erro propaga e retorna 500.

---

## ALTO

### [x] 4. Todos os deletes de frontend são fire-and-forget silenciosos ✓ FIXED
Finanças, Casinha, Exercícios, Hábitos, Alimentação, Saúde — todos usam `.catch(()=>null)`.
Usuário pensa que deletou, banco mantém o registro.

### [ ] 5. Dados deletados ressurgem entre dispositivos
- Alimentação: `deletedMealIds` existe só no localStorage local
- Exercícios: `SK_DEL` existe só no localStorage local
- Saúde: `deletedState` existe só no localStorage local

Outro dispositivo não sabe que o item foi deletado.

### [ ] 6. Exercícios: dirty tracking pode recriar item deletado remotamente
Item editado em A (marcado dirty) + deletado em B → A abre app, restaura o dirty e re-sincroniza → item ressurge no banco.

### [ ] 7. Hábitos: backfill do localStorage pode reverter edições remotas
Campos `tipo`, `unit`, `startDate` são sobrescritos com valores do cache local sem verificar se foram atualizados em outro dispositivo.

### [x] 8. Bootstrap helper `h()` apaga cache válido quando API falha — `index.html`
Retornava `[]` em qualquer erro e gravava esse vazio no localStorage. Dados anteriores eram perdidos.
**Fix:** `h()` retorna `null` em falha. Cada `_lsSet` só executa se o resultado não for `null`.

### [x] 9. Saúde renderiza stale data antes da API carregar ✓ FIXED
`renderAll()` chamada com localStorage; `saudeBootstrap()` é async e roda depois.

---

## MÉDIO

### [x] 10. CORS sem whitelist de origem — `server.ts` ✓ FIXED
`app.use(cors())` permite qualquer origem.

### [x] 11. Rollback dos modais de controle de hábito está quebrado — `index.html` ✓ FIXED
`_clearControleModal` e `_saveControleModal` usam referência de objeto em vez de snapshot string.
Rollback pode não restaurar estado correto.

### [ ] 12. Google/Strava disconnect: revogação do token externo silenciada
Token deletado localmente, mas se revogação na API externa falha, o token continua válido lá.

### [x] 13. `saveProfile` e `changePassword` parseiam JSON antes de checar `r.ok` ✓ FIXED
Se a API retornar HTML de erro, `r.json()` lança exceção não tratada.

### [x] 14. `Promise.all` com 9 endpoints em Finanças ✓ FIXED
Se 1 endpoint falhar, bootstrap inteiro falha e usuário fica sem nenhum dado financeiro.

---

## BAIXO

### [ ] 15. Inicialização do hub sem await
`fetchFinancas()`, `hubBootstrap()`, `loadProfileData()` disparados em paralelo sem sincronização.

### [ ] 16. `checkGcalStatus` silencia erros completamente
`catch(e){}` vazio — falhas de rede passam sem log.

### [x] 17. Inconsistência de validação em `/saude/remedios` e `/saude/consumos` ✓ FIXED
Únicos endpoints que não incluem `usuario_id` no schema (funcionalmente seguro, mas inconsistente).
