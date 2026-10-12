# Ocorrência de agenda no ERP — mapeamento do backend

Como lançar, listar e excluir **ocorrência de agenda** (ausência do consultor: férias,
folga, atestado, serviços gerais...) no Sankhya ERP corporativo (`skw.sankhya.com.br`),
para reimplementar em outro projeto.

Tudo aqui foi **capturado e testado ao vivo em 2026-10-01** (criação e exclusão reais em
02/10/2026, listagem e filtros validados). Implementação de referência no hub:
`desktop/src/ocorrencias.ts`.

---

## 1. Visão geral

| Operação         | Serviço Sankhya                                          | Mecanismo                                   |
| ---------------- | -------------------------------------------------------- | ------------------------------------------- |
| Quem está logado | `CRUDServiceProvider.loadRecords` (entidade `Usuario`)   | filtro `STP_GET_CODUSULOGADO`               |
| Listar           | `CRUDServiceProvider.loadRecords` (entidade `AD_OCOAGE`) | filtro + parâmetros tipados                 |
| Criar            | `ActionButtonsSP.executeSTP`                             | botão de ação **1459** "Criar ocorrência"   |
| Excluir          | `ActionButtonsSP.executeSTP`                             | botão de ação **1460** "Excluir ocorrência" |

Gravar **pelo botão de ação**, e não direto na tabela (`saveRecord`/`DatasetSP.save`), é
proposital: a procedure do botão aplica as validações da tela (sobreposição, permissão).

### Tabela `AD_OCOAGE`

| Campo        | Tipo          | Descrição                                |
| ------------ | ------------- | ---------------------------------------- |
| `SEQOCO`     | I             | Sequência (chave)                        |
| `CODUSU`     | I             | Usuário                                  |
| `DTINICIAL`  | H (data+hora) | Data inicial                             |
| `DTFINAL`    | H (data+hora) | Data final                               |
| `MOTIVO`     | S             | Motivo da ausência (código, ver §6)      |
| `OBSERVACAO` | S             | Observação (o botão de criar não recebe) |

### Botões (TSIBTA)

| IDBTNACAO | Descrição          | Tipo | Procedure                   |
| --------- | ------------------ | ---- | --------------------------- |
| 1459      | Criar ocorrência   | SP   | `STP_BTN_CRIA_OCOAGE_SNK`   |
| 1460      | Excluir ocorrência | SP   | `STP_BTN_EXCLUI_OCOAGE_SNK` |

> Os IDs são **do corporativo**. Se o botão for recriado, o ID muda. Para descobrir de
> novo: `SELECT IDBTNACAO, DESCRICAO FROM TSIBTA WHERE NOMEINSTANCIA = 'AD_OCOAGE'`.

---

## 2. Pré-requisito: de onde a chamada sai

**A chamada tem que sair de dentro de uma página do Sankhya já logada** (aba do navegador,
`WebContents` do Electron, tela HTML5/gadget dentro do ERP). Medido em 2026-09-24:

- sessão criada fora da página (`MobileLoginSP.login` via Node/HTTP) **loga, mas toma
  "Acesso negado ao serviço"** em tudo;
- a mesma chamada feita por `fetch` na página, com os cookies dela, passa.

Opções conforme o projeto:

| Projeto                                       | Como chamar                                                          |
| --------------------------------------------- | -------------------------------------------------------------------- |
| Tela HTML5 / gadget / dashboard dentro do ERP | `fetch` direto (mesma origem)                                        |
| Electron                                      | `webContents.executeJavaScript(...)` rodando o `fetch` na aba logada |
| Extensão de navegador                         | content script na aba do ERP                                         |
| Backend Node puro, sem página                 | **não funciona** no corporativo                                      |

---

## 3. Transporte comum

```
POST {origin}/mge/service.sbr?serviceName={SERVICO}&outputType=json&mgeSession={JSESSIONID}
Content-Type: application/json; charset=UTF-8
credentials: same-origin

{ "serviceName": "{SERVICO}", "requestBody": { ... } }
```

- `mgeSession` = valor do cookie `JSESSIONID` **sem o sufixo de nó** (tudo antes do
  primeiro `.`). Em `/mge` costuma funcionar sem ele, mas mande sempre: outros contextos
  (`/mgeos`) respondem status 3 sem ele.
- **Charset**: o Sankhya costuma responder em ISO-8859-1. Decodifique pelo `charset` do
  `Content-Type` (`TextDecoder(cs).decode(await r.arrayBuffer())`), não com `r.text()`,
  senão os acentos quebram.
- HTTP 200 **não** significa sucesso: olhe o campo `status` do JSON.

### Códigos de `status`

| status | Significado                                                | Tratamento              |
| ------ | ---------------------------------------------------------- | ----------------------- |
| `1`    | Sucesso (consultas)                                        | ler `responseBody`      |
| `2`    | Sucesso com mensagem (botões)                              | mostrar `statusMessage` |
| `0`    | Erro                                                       | mostrar `statusMessage` |
| `3`    | Não autorizado / sessão caída                              | pedir novo login        |
| `4`    | Concorrência **ou** pedido de confirmação (`clientEvents`) | ver §5.1                |

- Resposta em **HTML** (começa com `<`) ou vazia = sessão expirou (caiu no `login.jsp`).
- `statusMessage` às vezes vem em **base64** (latin1). Decodifique se for base64 válido e
  der texto legível.
- Duas chamadas simultâneas na mesma sessão podem voltar `status 4` "cancelado por
  concorrência". **Serialize** as chamadas por sessão e repita uma vez após ~700 ms.

---

## 4. Usuário logado

O CODUSU **nunca** vem do pedido do cliente: é lido da sessão com a função do Sankhya
`STP_GET_CODUSULOGADO`.

```json
{
  "serviceName": "CRUDServiceProvider.loadRecords",
  "requestBody": {
    "dataSet": {
      "rootEntity": "Usuario",
      "includePresentationFields": "N",
      "offsetPage": "0",
      "criteria": { "expression": { "$": "this.CODUSU = STP_GET_CODUSULOGADO" } },
      "entity": { "fieldset": { "list": "CODUSU,NOMEUSU" } }
    }
  }
}
```

Resposta (validada):

```json
{
  "status": "1",
  "responseBody": {
    "entities": {
      "metadata": { "fields": { "field": [{ "name": "CODUSU" }, { "name": "NOMEUSU" }] } },
      "entity": { "f0": { "$": "12229" }, "f1": { "$": "FLAVIANO.SANTOS" } }
    }
  }
}
```

> `loadRecords` devolve os campos como `f0, f1, ...` na ordem de `metadata.fields`, e
> **objeto em vez de array** quando há um registro só. Campo vazio vem como `{}`.

Alternativa equivalente (também validada): `ExecQuerySP.execQuery` com
`SELECT STP_GET_CODUSULOGADO AS CODUSU FROM DUAL`. Preferir o `loadRecords`: não exige SQL
livre.

---

## 5. Criar ocorrência — botão 1459

```json
{
  "serviceName": "ActionButtonsSP.executeSTP",
  "requestBody": {
    "stpCall": {
      "actionID": "1459",
      "procName": "STP_BTN_CRIA_OCOAGE_SNK",
      "rootEntity": "AD_OCOAGE",
      "refreshType": "ALL",
      "params": {
        "param": [
          { "type": "S", "paramName": "CODUSU", "$": "12229" },
          { "type": "D", "paramName": "DTINICIAL", "$": "02/10/2026 09:00:00" },
          { "type": "D", "paramName": "DTFINAL", "$": "02/10/2026 18:00:00" },
          { "type": "S", "paramName": "MOTIVO", "$": "15" },
          { "type": "S", "sequence": "1", "paramName": "__ESCOLHA_SIMNAO__", "$": "S" }
        ]
      }
    },
    "clientEventList": { "clientEvent": [{ "$": "br.com.sankhya.actionbutton.clientconfirm" }] }
  }
}
```

Resposta de sucesso (validada):

```json
{
  "serviceName": "ActionButtonsSP.executeSTP",
  "status": "2",
  "statusMessage": "Ocorrência criada com sucesso!",
  "responseBody": {}
}
```

Regras:

- `CODUSU` vai como tipo **S** (é o que a tela manda), com o valor do §4.
- Datas tipo **D**, formato **`dd/MM/yyyy HH:mm:ss`**.
- `MOTIVO` é o **código** (§6), não o rótulo.
- O botão **não** recebe `OBSERVACAO`.

### 5.1 Confirmação ("Confirma...?")

A tela do Sankhya faz **duas chamadas**:

1. Sem `__ESCOLHA_SIMNAO__` → volta `status 4` com
   `clientEvents[0].id = "br.com.sankhya.actionbutton.clientconfirm"`, título
   "Confirmação" e a mensagem em HTML.
2. Repete o mesmo corpo **acrescentando** o parâmetro
   `{ "type": "S", "sequence": "1", "paramName": "__ESCOLHA_SIMNAO__", "$": "S" }`.

Mandar o `__ESCOLHA_SIMNAO__ = S` **já na primeira chamada** pula a pergunta (testado). Se
fizer isso, **a confirmação tem que ser feita na sua tela** antes de chamar.

---

## 6. Motivos (`AD_OCOAGE.MOTIVO`, TDDOPC)

| Código | Rótulo                        | Código | Rótulo                |
| ------ | ----------------------------- | ------ | --------------------- |
| 0      | Férias                        | 10     | Day Off               |
| 1      | Treinamento                   | 11     | Compensação Bco Horas |
| 2      | Workshop                      | 12     | Licença Paternidade   |
| 3      | Atestado Médico               | 13     | Licença Maternidade   |
| 4      | Exame Médico                  | 14     | Traslado              |
| 5      | Atrasos                       | 15     | Serviços Gerais       |
| 6      | Finalização Antecipada Agenda | 16     | Licença Luto          |
| 7      | Saída Antecipada              | 17     | Licença Casamento     |
| 8      | Folga                         | 18     | Feriado               |
| 9      | Folga Eleitoral               |        |                       |

Lido do dicionário em 2026-10-01. Para atualizar:
`SELECT O.VALOR, O.OPCAO FROM TDDOPC O JOIN TDDCAM C ON C.NUCAMPO = O.NUCAMPO WHERE C.NOMETAB = 'AD_OCOAGE' AND C.NOMECAMPO = 'MOTIVO'`.

---

## 7. Listar ocorrências do usuário logado

```json
{
  "serviceName": "CRUDServiceProvider.loadRecords",
  "requestBody": {
    "dataSet": {
      "rootEntity": "AD_OCOAGE",
      "includePresentationFields": "N",
      "offsetPage": "0",
      "criteria": {
        "expression": {
          "$": "this.CODUSU = STP_GET_CODUSULOGADO AND this.DTINICIAL >= ? AND this.DTINICIAL < ?"
        },
        "parameter": [
          { "$": "01/09/2026", "type": "D" },
          { "$": "01/10/2026", "type": "D" }
        ]
      },
      "entity": { "fieldset": { "list": "SEQOCO,CODUSU,DTINICIAL,DTFINAL,MOTIVO,OBSERVACAO" } }
    }
  }
}
```

- Período **meio aberto** `[de, antesDe)`: para incluir o último dia inteiro, mande o
  **dia seguinte** como `antesDe`.
- Use `?` + `parameter` tipado em vez de data literal no SQL (`TO_DATE` é só Oracle).
- Datas voltam em `dd/MM/yyyy HH:mm:ss`; a ordem **não** é garantida — ordene no cliente.

Resposta (validada, set/2026):

```json
"entity": [
  { "f0": {"$":"13799"}, "f1": {"$":"12229"}, "f2": {"$":"24/09/2026 09:00:00"},
    "f3": {"$":"24/09/2026 12:00:00"}, "f4": {"$":"15"}, "f5": {} },
  ...
]
```

---

## 8. Excluir ocorrência — botão 1460

**Antes**, confira que a ocorrência é do usuário logado (a procedure de exclusão não foi
lida; não conte com ela):

```json
"criteria": {
  "expression": { "$": "this.CODUSU = STP_GET_CODUSULOGADO AND this.SEQOCO = ?" },
  "parameter": [ { "$": "13803", "type": "I" } ]
}
```

Nenhum registro → recusar. Validado: ocorrência existente de outro usuário volta 0 linhas
com esse filtro.

Depois, o botão:

```json
{
  "serviceName": "ActionButtonsSP.executeSTP",
  "requestBody": {
    "stpCall": {
      "actionID": "1460",
      "procName": "STP_BTN_EXCLUI_OCOAGE_SNK",
      "rootEntity": "AD_OCOAGE",
      "refreshType": "ALL",
      "rows": { "row": [{ "field": [{ "fieldName": "SEQOCO", "$": "13803" }] }] },
      "params": {
        "param": [{ "type": "S", "sequence": "1", "paramName": "__ESCOLHA_SIMNAO__", "$": "S" }]
      }
    },
    "clientEventList": { "clientEvent": [{ "$": "br.com.sankhya.actionbutton.clientconfirm" }] }
  }
}
```

Resposta: `status "2"`, `"Ocorrência excluída com sucesso!"`.

- `rows` leva o **registro selecionado**. A tela manda também `DTINICIAL`, `DTFINAL`,
  `MOTIVO`, `OBSERVACAO`, mas **só `SEQOCO` basta** (testado).
- Mesma regra de confirmação do §5.1.

---

## 9. Regras de segurança (obrigatórias)

1. **CODUSU só da sessão** (§4). Nenhuma rota/função do seu projeto deve aceitar usuário do
   cliente — senão qualquer um lança/apaga ausência de outro consultor.
2. **Listagem e exclusão filtradas por `STP_GET_CODUSULOGADO`.**
3. **Botões e procedures fixos no código.** Nunca aceite `actionID`, `procName` ou SQL
   vindos do cliente.
4. **Validar entrada** antes de chamar: datas no formato, fim > início, motivo na lista,
   `SEQOCO` inteiro positivo.
5. **Confirmar na sua tela** antes de criar/excluir (o `__ESCOLHA_SIMNAO__` pula a do ERP).
6. **Origem**: só execute se a página estiver no domínio do ERP esperado.
7. **Sem SQL livre** (`ExecQuerySP`/`DbExplorerSP`) para este fluxo. `ExecQuerySP` aceita
   SQL arbitrário com o usuário comum — não exponha.
8. **Log** sem dados sensíveis: ação, motivo, status. Nunca o cookie/`mgeSession`.

Sobre a biblioteca SankhyaJX (`JX`): serve de referência, mas `acionarBotao` não manda
`rows` nem tipo `D`, e carregá-la de CDN `@main` em página logada é risco de cadeia de
suprimentos. Se usar, vendorize uma cópia revisada (tag `v1.3.0`).

---

## 10. Implementação de referência (TypeScript, sem framework)

`chamar` é o único ponto que muda entre projetos: na tela HTML5 é um `fetch` direto; no
Electron, o mesmo `fetch` dentro de `webContents.executeJavaScript`.

```ts
type Resposta = { status?: string; statusMessage?: string; responseBody?: any };
type Chamar = (servico: string, requestBody: unknown) => Promise<Resposta>;

// --- transporte para rodar DENTRO da página logada do ERP ---
let fila: Promise<unknown> = Promise.resolve();
export const chamarNaPagina: Chamar = (servico, requestBody) => {
  const tarefa = async (): Promise<Resposta> => {
    const sessao = (/(?:^|;\s*)JSESSIONID=([^;.]+)/.exec(document.cookie) ?? [])[1] ?? '';
    const url = `/mge/service.sbr?serviceName=${servico}&outputType=json&mgeSession=${encodeURIComponent(sessao)}`;
    for (let tentativa = 0; ; tentativa++) {
      const r = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ serviceName: servico, requestBody }),
      });
      const cs = (/charset=([^;]+)/i.exec(r.headers.get('content-type') ?? '') ?? [])[1] ?? 'utf-8';
      const texto = new TextDecoder(cs.trim()).decode(await r.arrayBuffer());
      if (!texto || texto.trimStart().startsWith('<'))
        throw new Error('Sessão do Sankhya expirou — faça login.');
      const j = JSON.parse(texto) as Resposta;
      // status 4 sem clientEvents = concorrência: uma nova tentativa.
      if (j.status === '4' && tentativa === 0 && !(j as any).clientEvents) {
        await new Promise((ok) => setTimeout(ok, 700));
        continue;
      }
      return j;
    }
  };
  const execucao = fila.then(tarefa); // uma chamada por vez na sessão
  fila = execucao.catch(() => undefined);
  return execucao;
};

// --- regras de negócio ---
const BOTAO_CRIAR = { actionID: '1459', procName: 'STP_BTN_CRIA_OCOAGE_SNK' };
const BOTAO_EXCLUIR = { actionID: '1460', procName: 'STP_BTN_EXCLUI_OCOAGE_SNK' };
const CONFIRMA = { type: 'S', sequence: '1', paramName: '__ESCOLHA_SIMNAO__', $: 'S' };
const DO_LOGADO = 'this.CODUSU = STP_GET_CODUSULOGADO';
const DATA_HORA = /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/;
const DATA = /^\d{2}\/\d{2}\/\d{4}$/;
export const MOTIVOS = [
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
];

function exigirSucesso(r: Resposta): Resposta {
  if (r.status === '1' || r.status === '2') return r;
  if (r.status === '3') throw new Error('Sessão do Sankhya expirou — faça login.');
  throw new Error(r.statusMessage || `Falha no Sankhya (status ${r.status})`);
}

/** `loadRecords` -> objetos `{CAMPO: valor}` (f0..fn na ordem dos campos pedidos). */
async function carregar(
  chamar: Chamar,
  entidade: string,
  campos: string[],
  expressao: string,
  parametros: unknown[] = [],
) {
  const r = exigirSucesso(
    await chamar('CRUDServiceProvider.loadRecords', {
      dataSet: {
        rootEntity: entidade,
        includePresentationFields: 'N',
        offsetPage: '0',
        criteria: {
          expression: { $: expressao },
          ...(parametros.length ? { parameter: parametros } : {}),
        },
        entity: { fieldset: { list: campos.join(',') } },
      },
    }),
  );
  const bruto = r.responseBody?.entities?.entity;
  const regs: any[] = Array.isArray(bruto) ? bruto : bruto ? [bruto] : [];
  return regs.map((reg) =>
    Object.fromEntries(campos.map((c, i) => [c, String(reg[`f${i}`]?.$ ?? '')])),
  );
}

async function executarBotao(
  chamar: Chamar,
  botao: typeof BOTAO_CRIAR,
  extra: { params?: unknown[]; rows?: unknown },
) {
  const r = exigirSucesso(
    await chamar('ActionButtonsSP.executeSTP', {
      stpCall: {
        ...botao,
        rootEntity: 'AD_OCOAGE',
        refreshType: 'ALL',
        params: { param: [...(extra.params ?? []), CONFIRMA] },
        ...(extra.rows ? { rows: extra.rows } : {}),
      },
      clientEventList: { clientEvent: [{ $: 'br.com.sankhya.actionbutton.clientconfirm' }] },
    }),
  );
  return r.statusMessage ?? '';
}

export async function usuarioLogado(chamar: Chamar) {
  const [u] = await carregar(chamar, 'Usuario', ['CODUSU', 'NOMEUSU'], DO_LOGADO);
  if (!u?.CODUSU) throw new Error('Não consegui identificar o usuário logado.');
  return { codusu: Number(u.CODUSU), nomeusu: u.NOMEUSU };
}

/** Período `[de, antesDe)` em `dd/MM/yyyy`. */
export async function listarOcorrencias(chamar: Chamar, de: string, antesDe: string) {
  if (!DATA.test(de) || !DATA.test(antesDe)) throw new Error('Período no formato dd/MM/yyyy.');
  return carregar(
    chamar,
    'AD_OCOAGE',
    ['SEQOCO', 'CODUSU', 'DTINICIAL', 'DTFINAL', 'MOTIVO', 'OBSERVACAO'],
    `${DO_LOGADO} AND this.DTINICIAL >= ? AND this.DTINICIAL < ?`,
    [
      { $: de, type: 'D' },
      { $: antesDe, type: 'D' },
    ],
  );
}

/** Datas `dd/MM/yyyy HH:mm:ss`. Confirme com o usuário ANTES de chamar. */
export async function criarOcorrencia(
  chamar: Chamar,
  dtInicial: string,
  dtFinal: string,
  motivo: string,
) {
  if (!DATA_HORA.test(dtInicial) || !DATA_HORA.test(dtFinal))
    throw new Error('Datas no formato dd/MM/yyyy HH:mm:ss.');
  if (!MOTIVOS.includes(motivo)) throw new Error('Motivo desconhecido.');
  const { codusu } = await usuarioLogado(chamar);
  return executarBotao(chamar, BOTAO_CRIAR, {
    params: [
      { type: 'S', paramName: 'CODUSU', $: String(codusu) },
      { type: 'D', paramName: 'DTINICIAL', $: dtInicial },
      { type: 'D', paramName: 'DTFINAL', $: dtFinal },
      { type: 'S', paramName: 'MOTIVO', $: motivo },
    ],
  });
}

/** Confirme com o usuário ANTES de chamar. */
export async function excluirOcorrencia(chamar: Chamar, seqoco: number) {
  if (!Number.isInteger(seqoco) || seqoco <= 0) throw new Error('Ocorrência inválida.');
  const dona = await carregar(chamar, 'AD_OCOAGE', ['SEQOCO'], `${DO_LOGADO} AND this.SEQOCO = ?`, [
    { $: String(seqoco), type: 'I' },
  ]);
  if (!dona.length) throw new Error('Ocorrência não encontrada para o usuário logado.');
  return executarBotao(chamar, BOTAO_EXCLUIR, {
    rows: { row: [{ field: [{ fieldName: 'SEQOCO', $: String(seqoco) }] }] },
  });
}
```

Uso numa tela dentro do ERP:

```ts
await criarOcorrencia(chamarNaPagina, '02/10/2026 09:00:00', '02/10/2026 18:00:00', '15');
const lista = await listarOcorrencias(chamarNaPagina, '01/10/2026', '01/11/2026');
await excluirOcorrencia(chamarNaPagina, Number(lista[0].SEQOCO));
```

No Electron (como o hub faz): rode o corpo de `chamarNaPagina` via
`webContents.executeJavaScript(\`(async () => { ... })()\`, true)`passando`servico`e`requestBody`serializados com`JSON.stringify`, e mantenha a fila no processo principal,
uma por `WebContents`.

---

## 11. Se o outro projeto tiver backend próprio (API REST)

Contrato usado no hub — o backend só valida e repassa ao executor que roda na página:

| Rota                                                       | Corpo / query                                 | Faz                                 |
| ---------------------------------------------------------- | --------------------------------------------- | ----------------------------------- |
| `GET /api/agenda/ocorrencias/usuario`                      | —                                             | §4                                  |
| `GET /api/agenda/ocorrencias/motivos`                      | —                                             | lista do §6                         |
| `GET /api/agenda/ocorrencias?de=YYYY-MM-DD&ate=YYYY-MM-DD` | —                                             | §7 com `antesDe = ate + 1 dia`      |
| `POST /api/agenda/ocorrencias`                             | `{ inicio: "YYYY-MM-DDTHH:mm", fim, motivo }` | §5 (converte datas; **sem** codusu) |
| `DELETE /api/agenda/ocorrencias/:seqoco`                   | —                                             | §8                                  |

Erros: 400 validação · 409 falha do ERP (com `expirou: true` se sessão caiu) · 503 sem
executor/página logada.

---

## 12. Checklist de implementação

- [ ] Executor rodando **dentro da página logada** (§2)
- [ ] `mgeSession`, charset, fila por sessão e retry no status 4 (§3)
- [ ] Usuário pela sessão, nunca do cliente (§4, §9.1)
- [ ] Criar com confirmação na sua tela + `__ESCOLHA_SIMNAO__` (§5)
- [ ] Listar com período meio aberto e ordenar por data (§7)
- [ ] Excluir só após conferir dona (§8)
- [ ] Tratar sessão expirada (HTML/vazio/status 3) pedindo login
- [ ] Testar: criar → listar → excluir → listar vazio, num dia livre
