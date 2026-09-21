# PoC — Sankhya Hub Desktop (Electron)

PoC isolada da Fase 1 de `docs/specs/sankhya-hub-desktop-especificacao.md`. Não faz
parte do app principal, tem dependências e perfil próprios, e não é apagada/alterada
nenhuma parte do `sankhya-hub` original.

## O que testa de verdade

- Duas `WebContentsView` (ERP e Experience) numa partição persistente própria
  (`persist:sankhya-hub-desktop-poc`), separada do perfil pessoal do Chrome/Edge e do
  perfil que `scripts/hub-helper.ps1` usa hoje.
- Captura de cookies do ERP (inclusive `HttpOnly`) via `session.cookies`, sem nunca
  expor o valor à interface — só metadados (contagem, domínios, flags).
- **Agenda de Recursos**: o mesmo `fetch` same-origin que `hub-helper.ps1` faz hoje
  (`AgendaRecursosSP.carregarAgendas`), só que executado dentro da `WebContentsView`
  do Electron em vez de via CDP externo. O resultado é entregue à rota **real e já
  existente** do backend, `POST /api/agenda/importar` (precisa do container
  `sankhya-hub` no ar em `http://localhost:4000`).
- **Experience**: captura do JWT do `localStorage` da aba (mesma chave `token` que
  `hub-helper.ps1` usa) e chamada real às mesmas rotas de
  `src/sankhya/experience.ts` (`/tasks/filtering/...`), com o token capturado.
- Isolamento: verifica em runtime que as abas remotas não enxergam `window.hub`,
  `ipcRenderer` nem `require` — a bridge só existe na UI local (`index.html`).

## O que NÃO faz (fora do escopo da Fase 1 / requer confirmação)

- Não cria, aceita nem envia e-mail de OS — isso exige confirmação explícita de
  ambiente de homologação, que não foi dada nesta rodada (ver relatório).
- Não implementa o canal `backendBridge` (WebSocket) da Seção 7 da especificação —
  isso é Fase 2. Aqui a Agenda vai direto ao endpoint HTTP já existente do backend;
  a Experience é chamada direto da API real (o backend hoje só sabe pegar token pelo
  helper DPAPI, que é o provedor antigo, não o desktop).
- Não reaproveita a UI React do Hub — a aba "Hub" carrega o app real em
  `http://localhost:4000`; o shell de controle é HTML mínimo.

## Pré-requisitos

- Node 22+ (usado: `node --version` = ver ambiente).
- Backend do Hub no ar em `http://localhost:4000` (container Docker `sankhya-hub`)
  para o teste de Agenda conseguir importar de verdade.
- Um Chrome/Edge instalado (o Electron traz o próprio Chromium; não usa o navegador
  pessoal em nenhum momento).

## Como rodar

```powershell
cd poc-desktop
npm install
npm start
```

## Roteiro de teste manual

1. Abra a aba **ERP**, faça login normalmente (usuário decide MFA/SSO).
2. Clique **Diagnosticar cookies ERP** — espera-se `total > 0` e pelo menos um
   `httpOnly`.
3. Preencha `de`/`ate` (formato `YYYY-MM-DD`, ex.: um período recente com eventos
   conhecidos) e clique **Buscar agenda + importar no backend real**.
4. Abra a aba **Experience**, faça login.
5. Clique **Capturar token Experience** — espera presença + `exp` decodificado.
6. Preencha `projetoId`/`personId` de um projeto real e clique **Buscar tarefas**.
7. Clique **Verificar isolamento** (deve dar PASS sempre, é estrutural).
8. Feche o app (`Alt+F4` ou fechar a janela) e rode `npm start` de novo; repita o
   passo 2 sem logar de novo — cookies devem continuar lá (teste de persistência).
9. Clique **Limpar sessão Experience capturada** e repita os passos 5–6 (teste de
   recaptura).

Cada clique grava um resultado técnico em `report/resultados.json` e um log em
`report/eventos.log` (ambos sem cookie/token — só metadados). Esses arquivos são a
evidência usada no relatório final em `docs/specs/`.

## Segurança aplicada

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`,
  `webSecurity: true` em todas as `WebContentsView` e na janela principal.
- Nenhuma aba remota recebe `preload` — só a janela local (`index.html`) tem acesso a
  `window.hub`, e mesmo essa bridge só expõe operações fixas e tipadas (sem `eval`
  genérico, sem `ipcRenderer` cru).
- `agenda.fetch` confere a origem da aba ERP antes de rodar o script fixo.
- Pop-ups só são permitidos para uma lista fechada de domínios (`DOMINIOS_POPUP_PERMITIDOS`
  em `src/main.js`); qualquer outro é recusado (`action: 'deny'`).
- Nada é logado com cookie/token — `src/report.js` redige qualquer chave que bata com
  `/cookie|token|senha|password|authorization|jwt/i` antes de gravar em disco.
