# Orbi — Issues Backlog V2

> Auditoria de código — 2026-04-13. Continuação do ISSUES.md (itens 1–17 todos resolvidos).
> Trabalhar em ordem de severidade.

---

## CRÍTICO

### [x] 18. Peso (Saúde): endpoint DELETE inexistente no backend — dado nunca removido do banco ✓ FIXED
**Módulo:** `Saude.html` + `backend/src/api.ts`

O backend possui `GET /health/weights` e `POST /health/weights` mas **não possui `DELETE /health/weights/:id`**.

No frontend, `remove('weights', id, ...)` chama a função genérica `remove(collection, ...)`:
```javascript
// Saude.html — função remove()
let del;
if(collection==='doctors') del=deleteMedicoApi(item);
else if(collection==='exams') del=deleteExameApi(item);
else if(collection==='consults') del=deleteConsultaApi(item);
// SEM caso para 'weights' → del === undefined
if(del) del.catch(()=>{...rollback...});
// if(undefined) é falso → API nunca chamada, rollback nunca registrado
```

O peso é removido de `state.weights` e adicionado a `deletedState.weights` (localStorage local).
No banco, o registro permanece. Em qualquer outro dispositivo, `deletedState` está vazio e o peso retorna via `saudeBootstrap`.

**Impacto:** usuário deleta peso em A → peso reaparece permanentemente em B. Dado não pode ser removido do banco por nenhuma ação do usuário.

---

### [ ] 19. Finanças: transações perdidas silenciosamente em `syncTxsToApi`
**Módulo:** `financas.html`, linha 1510

O sync de transações usa um padrão delete-remoto + re-criar-local:
```javascript
// Passo 1: deleta remotos que não estão mais em local
await Promise.all(existentes
  .filter(t=>t.client_id&&!localIds.has(String(t.client_id)))
  .map(t=>apiReq(`/transacoes/${t.id}`,{method:'DELETE'})));

// Passo 2: re-cria TODOS os locais — com .catch(()=>null) por item
await Promise.all(txs.map(t=>apiReq('/transacoes',{method:'POST',...}).catch(()=>null)));
```

Se qualquer POST no passo 2 falha silenciosamente (`.catch(()=>null)`), aquela transação:
1. Foi processada sem erro (Promise.all não lança)
2. Não está no banco
3. Na próxima abertura do app, `bootstrapApi` executa `txs=apiTxs.map(txFromApi)` — substitui o estado local pelo banco
4. A transação desaparece permanentemente sem nenhum aviso

**Impacto:** transações criadas durante instabilidade de rede podem ser perdidas para sempre na próxima abertura do app.

---

### [ ] 20. Finanças: fechar aba antes de 200ms apaga transação recém-criada
**Módulo:** `financas.html`

`save()` chama `scheduleTxSync()`, que agenda a sincronização com debounce de 200ms. A variável `txs` (JS em memória) é atualizada imediatamente, mas **não é gravada em localStorage** — apenas o `hub_fin_cache` (cache de leitura do hub) é atualizado, e somente após o sync da API completar.

Se o usuário fecha a aba antes dos 200ms, o timer não dispara. Na próxima abertura, `bootstrapApi` executa `txs=apiTxs.map(txFromApi)` — o banco não tem a transação → ela desaparece.

**Impacto:** transação criada + fechar aba rapidamente = dado perdido sem aviso.

---

## ALTO

### [x] 21. Saúde: logout fire-and-forget — token pode continuar ativo no banco ✓ FIXED
**Módulo:** `Saude.html`, linha 675

```javascript
function saudeLogout(){
  try{if(authToken)apiReq('/auth/logout',{method:'POST'});}catch(_){}
  // SEM await — a Promise não é esperada
  authToken='';API_USER_ID=null;localStorage.removeItem(SK_AUTH);
  ...
}
```

Sem `await`, a requisição de logout é disparada mas não aguardada. O token pode não ser deletado do banco (especialmente em redes lentas ou ao fechar a janela logo após o logout). A sessão permanece válida no banco.

**Impacto:** token reutilizável até expirar; em cenário de dispositivo compartilhado, outro usuário pode continuar com a sessão ativa.

---

### [x] 22. Alimentação: criar/editar refeição é fire-and-forget — sem rollback ✓ FIXED
**Módulo:** `Alimentacao.html`, linhas 449–454 e 579

```javascript
async function syncRefeicao(m){
  if(!canUseApi())return;
  await apiReq('/alimentacao/refeicoes',{method:'POST',...}).catch(()=>null);
  // falha silenciosa — sem rollback, sem alerta
}

// No save:
saveMeals(); syncRefeicao(data).catch(()=>null); closeMealModal(); renderAll();
```

Se a API falha ao criar/editar uma refeição, o dado existe em localStorage mas **não no banco**. Outro dispositivo não vê a refeição.

Contraste: o delete de refeição tem rollback correto (`deleteRefeicaoApi(m).catch(()=>{rollback})`). O create/update não tem.

**Impacto:** UI confirma salvamento, banco não atualizou.

---

### [x] 23. Hábitos: toggle de log é fire-and-forget — sem rollback em falha ✓ FIXED
**Módulo:** `habitos.html`, linhas 1456–1457 e 1467–1468

```javascript
// toggleLog (linha 1456-1457)
save();
syncHabito(h).catch(()=>null);  // sem rollback
renderAll();

// setControlLog (linha 1467-1468)
save();
syncHabito(h).catch(()=>null);  // sem rollback
```

Contraste com o Hub (`index.html`), que implementa rollback completo para o mesmo toggle:
```javascript
// hub — hubToggleHabito — com rollback
}catch(err){
  _lsSet('habitos_app_v5',snapshot);
  rendTodaySummary(); rendCal();
}
```

No módulo `habitos.html`, se a API falha ao sincronizar o toggle, o log é salvo em localStorage mas não no banco. Em outro dispositivo, o hábito aparece como não feito naquela data.

**Impacto:** divergência silenciosa entre dispositivos. O usuário pensa que o hábito foi marcado.

---

### [x] 24. Casinha: creates e updates de tarefas/rotinas são fire-and-forget ✓ FIXED
**Módulo:** `casinha.html`, múltiplas linhas (1102, 1107, 1122, 1180, 1190, 1274, 1319, 1572, 1576, 1592, 1594, 1663, 1671, 1673, 1713, 1714)

Exemplos representativos:
```javascript
syncTarefa(t).catch(()=>null);              // linha 1102 — update de tarefa
ns.forEach(n=>syncTarefa(n).catch(()=>null)); // linha 1107 — ocorrências de rotina
syncRotina(r).catch(()=>null);              // linha 1275 — update de rotina
syncAmbiente(a).catch(()=>null);            // linha 1714 — create de ambiente
```

O delete tem rollback (`deleteTarefaApi(t).catch(()=>{rollback})`), mas create e update não têm. Se a API falha, o item existe em localStorage mas não no banco.

**Impacto:** tarefas criadas ou editadas podem não chegar ao banco; outro dispositivo não as vê.

---

### [x] 25. Saúde: todos os sync de create/update são fire-and-forget ✓ FIXED
**Módulo:** `Saude.html`, linhas 682–744

```javascript
async function syncWeight(w){
  ...
  await apiReqRetry('/health/weights',{...}).catch(()=>null);  // 687
}
async function syncMedico(d){ ... ).catch(()=>null); }   // 695
async function syncExame(e){  ... ).catch(()=>null); }   // 708
async function syncConsulta(c){ ... ).catch(()=>null); } // 721
async function syncRemedio(r){ ... ).catch(()=>null); }  // 733
async function syncConsumo(c){ ... ).catch(()=>null); }  // 744
```

Todos os sync de criação/edição na Saúde silenciam falhas. O dado fica em localStorage mas pode não chegar ao banco.

**Impacto:** exames, consultas, pesos, médicos, remédios e consumos criados/editados podem não persistir no banco sem nenhum aviso ao usuário.

---

### [x] 26. Rota `DELETE /alimentacao/water/date/:date` inacessível — sobreposta por `/:id` ✓ FIXED
**Módulo:** `backend/src/api.ts`, linhas 1110–1121

As rotas estão registradas nesta ordem:
```typescript
apiRouter.delete("/alimentacao/water/:id", ...);        // linha 1110 — registrada PRIMEIRO
apiRouter.delete("/alimentacao/water/date/:date", ...); // linha 1116 — nunca alcançada
```

Express avalia na ordem de registro. Uma chamada a `/alimentacao/water/date/2024-01-15` casa com `/:id` onde `id="date"`. O handler executa:
```typescript
await prisma.alimentacaoWater.deleteMany({ where: { userId, OR: [{ id: "date" }, { clientId: "date" }] } });
// → 0 registros deletados → responde 204
```

A rota `/date/:date` nunca é alcançada. Não é possível deletar entradas de água por data via esse endpoint.

**Impacto:** funcionalidade de "limpar água do dia" silenciosamente não funciona; resposta 204 engana o frontend.

---

## MÉDIO

### [x] 27. Saúde: bootstrap com falha de rede deixa tela vazia para usuários autenticados ✓ FIXED
**Módulo:** `Saude.html`, linhas 877–881

```javascript
checkAuthSaude().then(async ok=>{
  if(!ok){renderAll(); document.getElementById('auth-overlay').classList.add('open'); return;}
  applyUserIsolation(API_USER_ID);
  await saudeBootstrap(); // renderAll() é chamado DENTRO do bootstrap
  // Se saudeBootstrap() lança, renderAll() não é chamado
});
```

`state = loadState()` (linha 853) carrega os dados do localStorage antes desse bloco. Mas para usuários autenticados, `renderAll()` não é chamado antes de `saudeBootstrap()`. Se o bootstrap falha (rede offline, servidor caído), o catch em `saudeBootstrap` (linha 832) loga o erro mas não chama `renderAll()`. O usuário autenticado vê tela vazia com dados em localStorage que poderiam ser exibidos.

**Impacto:** qualquer falha de rede na abertura do módulo Saúde = tela vazia, mesmo com dados locais disponíveis.

---

### [x] 28. Exercícios: IDs de locais e tipos não são UUIDs — inconsistente com CLAUDE.md ✓ FIXED
**Módulo:** `exercicios.html`, linhas 1786, 1843, 1870

```javascript
id: editTreinoId || Date.now().toString()  // linha 1786 — treino sem id existente
id: editLocalId  || ('l'+Date.now())       // linha 1843 — local
id: editTipoId   || ('tp'+Date.now())      // linha 1870 — tipo
```

CLAUDE.md define: *"`client_id` fields are frontend-generated UUIDs"*.

Todos os outros módulos usam `crypto.randomUUID()`. Exercícios usa `Date.now()` para locais e tipos. Colisão possível se dois itens forem criados no mesmo milissegundo. O unique constraint `@@unique([userId, client_id])` no Prisma pode falhar ou fazer upsert indevido.

**Impacto:** potencial conflito de `client_id`; inconsistência documentada.

---

### [ ] 29. Casinha: campo `tipoMembro` não existe no schema Prisma — não sincroniza
**Módulo:** `casinha.html`, linha 1897; `backend/prisma/schema.prisma`

```javascript
// casinha.html:1897 — lido do localStorage, NÃO enviado para a API
const lp=_localPessData.find(x=>x.id===r.client_id)||{};
return{id:r.client_id,_dbId:r.id,nome:r.nome,cor:r.cor,tipoMembro:lp.tipoMembro||'adulto'};
```

O payload de `POST /casinha/pessoas` não inclui `tipoMembro`. O schema `CasinhaPessoa` no Prisma não tem esse campo. O valor existe apenas no localStorage do dispositivo que o definiu.

**Impacto:** trocar de dispositivo = perder o tipo de membro de todas as pessoas. O campo não tem nenhuma indicação visual de que é local-only.

---

### [x] 30. `GET /api/health` público expõe metadados de infraestrutura ✓ FIXED
**Módulo:** `backend/src/api.ts`, linhas 92–98

```typescript
apiRouter.get("/health", async (_req, res) => {
  const rows = await prisma.$queryRaw<...>`SELECT current_database() as db, current_schema() as schema`;
  res.json({ ok: true, db: { name: first.db, schema: first.schema } });
});
```

Sem `requireAuth` nem verificação de secret. Qualquer request anônimo recebe o nome do banco e do schema PostgreSQL em uso.

**Impacto:** exposição de metadados de infraestrutura; facilita reconhecimento em caso de ataque.

---

## BAIXO

### [ ] 31. Exercícios: migração de itens locais no bootstrap é fire-and-forget
**Módulo:** `exercicios.html`, linhas 912–916

```javascript
const naoSincronizados=localCache.filter(t=>!apiIds.has(t.id)&&!deleted.has(t._dbId)&&!t._dbId);
for(const t of naoSincronizados){
  treinos.push(t);
  syncTreino(t).catch(()=>null);  // sem retry, sem rollback
}
```

Se `syncTreino` falha durante a migração de bootstrap, o treino continua em localStorage (sem `_dbId`) e será tentado novamente no próximo bootstrap — desde que o item ainda esteja em localStorage. Sem feedback ao usuário.

**Impacto:** treinos antigos podem nunca chegar ao banco se a rede falhar repetidamente; sem indicação de pendência.

---

### [ ] 32. Exercícios: dirty sync no bootstrap usa `.catch(()=>null)` — sem retry garantido
**Módulo:** `exercicios.html`, linha 925

```javascript
syncTreino(local).then(()=>clearDirty(local.id)).catch(()=>null);
```

Se o sync do dirty falha, `clearDirty` não é chamado — o item permanece marcado dirty e será retentado no próximo bootstrap. Esse comportamento é correto, mas a falha é silenciosa. Sem log, sem contador de tentativas, o dirty pode acumular indefinidamente.

**Impacto:** baixo — o retry funciona, mas sem visibilidade do estado pendente.
