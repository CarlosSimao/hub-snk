/**
 * Prints da página Git AutoSync da wiki (`site/wiki/git-autosync.html`).
 *
 * O Git AutoSync não existe no runner, e aqui nada pode commitar nem dar push de verdade:
 * todas as rotas `/api/autosync` são respondidas por `simularAutosync`, com um Git AutoSync
 * instalado de mentira, no formato de `src/autosync/tiposDoAutosync.ts`. A simulação e
 * `mostrarRepositoriosEmCWorkspace` também servem ao roteiro de Repositórios Git, que
 * mostra a seção AutoSync na aba Git do cliente.
 */
import { createHash } from 'node:crypto';

const ESPERA_DOS_AVISOS_MS = 3500;

/**
 * Os clones de `preparar-dados.mjs` ficam em `C:\Workspace-demo-<instância>` (no CI,
 * `C:\Workspace-demo`); a tela mostra sempre `C:\Workspace\...`, para o print não mudar com a
 * instância e bater com os caminhos do Git AutoSync simulado.
 */
const PASTA_DOS_CLONES_NA_TELA = /^.*[\\/]Workspace(-demo(-\d+)?)?[\\/]/i;
const PASTA_DOS_CLONES = 'C:\\Workspace';
const PASTA_RAIZ = 'C:\\Projetos-internos';
const REPOSITORIOS_DA_RAIZ = [`${PASTA_RAIZ}\\rascunhos`, `${PASTA_RAIZ}\\scripts-sql`];
/** Os clones que `preparar-dados.mjs` cria; outro caminho é pasta que não existe. */
const CLONES_EXISTENTES = new Set(
  [
    'boavista-pesagem',
    'alfa-embalagens',
    'rotasul-fretes',
    'horizonte-obras',
    'valedocafe-cotas',
    'ferraco-producao',
  ].map((nome) => `${PASTA_DOS_CLONES}\\${nome}`.toLowerCase()),
);

const noWorkspace = (nome) => `${PASTA_DOS_CLONES}\\${nome}`;
const normalizar = (caminho) => caminho.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const pai = (caminho) => caminho.slice(0, caminho.replace(/[\\/]+$/, '').search(/[\\/][^\\/]*$/));

/** `AAAA-MM-DD HH:MM:SS` no horário local, como o Git AutoSync grava. */
function dataHora(data) {
  const dois = (numero) => String(numero).padStart(2, '0');
  return `${data.getFullYear()}-${dois(data.getMonth() + 1)}-${dois(data.getDate())} ${dois(data.getHours())}:${dois(data.getMinutes())}:${dois(data.getSeconds())}`;
}

/** Ontem, no horário pedido: a última rodada agendada, qualquer que seja a hora do print. */
function ontemAs(horario, segundos = 0) {
  const [hora, minuto] = horario.split(':').map(Number);
  const data = new Date();
  data.setDate(data.getDate() - 1);
  data.setHours(hora, minuto, segundos, 0);
  return dataHora(data);
}

/** Próxima vez que um dos horários chega, a partir de agora. */
function proximaExecucao(horarios) {
  const agora = new Date();
  const candidatas = [0, 1].flatMap((dias) =>
    horarios.map((horario) => {
      const [hora, minuto] = horario.split(':').map(Number);
      const data = new Date(agora);
      data.setDate(data.getDate() + dias);
      data.setHours(hora, minuto, 0, 0);
      return data;
    }),
  );
  return dataHora(candidatas.filter((data) => data > agora).sort((a, b) => a - b)[0]);
}

/** A saída de um `sync` com o push rejeitado, no formato do teste de `sugestoesDeCorrecao`. */
function saidaDoPushRejeitado(caminho, url) {
  const barras = caminho.replace(/\\/g, '/');
  return [
    `${dataHora(new Date())} [${barras}] AVISO: push falhou -> To ${url}`,
    ' ! [rejected]        HEAD -> main (fetch first)',
    `error: failed to push some refs to '${url}'`,
    'hint: Updates were rejected because the remote contains work that you do not',
    `[aviso] ${barras}: push falhou (o remoto tem commits que voce nao tem localmente). sugestao: git pull --rebase origin main  &&  git push origin HEAD:refs/heads/main`,
  ].join('\n');
}

function criarEstado() {
  return {
    instalado: true,
    gitInstalado: true,
    versao: '1.9.0',
    horarios: ['17:30'],
    tarefaInstalada: true,
    bandeja: false,
    ia: { ligada: false, agente: 'auto' },
    alvos: [
      { path: noWorkspace('boavista-pesagem'), type: 'repo', enabled: true },
      { path: noWorkspace('valedocafe-cotas'), type: 'repo', enabled: true },
      { path: PASTA_RAIZ, type: 'root', enabled: true, exclude: [REPOSITORIOS_DA_RAIZ[0]] },
    ],
    status: {
      [noWorkspace('boavista-pesagem')]: {
        lastRun: ontemAs('17:30', 4),
        lastPush: ontemAs('17:30', 6),
        success: true,
        hadChanges: true,
        pushed: true,
        message: 'commit e push concluidos',
        state: 'synced',
      },
      [noWorkspace('valedocafe-cotas')]: {
        lastRun: ontemAs('17:30', 9),
        lastPush: ontemAs('11:02', 41),
        success: true,
        hadChanges: true,
        pushed: false,
        message: 'commit feito, push pendente',
        state: 'pending_push',
      },
      [REPOSITORIOS_DA_RAIZ[1]]: {
        lastRun: ontemAs('17:30', 12),
        lastPush: ontemAs('09:15', 20),
        success: true,
        hadChanges: false,
        pushed: false,
        message: 'sem alteracoes pendentes',
        state: 'synced',
      },
    },
    politicas: {
      [noWorkspace('boavista-pesagem')]: {
        exclude: ['*.log', '.env'],
        allowedBranches: ['main', 'feature/*'],
      },
    },
    /** Ação que falha na próxima vez, com a saída do CLI e as sugestões da tela. */
    falhas: new Map(),
  };
}

function montarVisao(estado, clientes) {
  const donos = new Map(
    clientes.flatMap((cliente) =>
      cliente.repositorios
        .filter((repositorio) => repositorio.caminhoLocal)
        .map((repositorio) => [normalizar(repositorio.caminhoLocal), cliente]),
    ),
  );
  const caminhos = new Map();
  for (const alvo of estado.alvos) {
    const doAlvo = alvo.type === 'repo' ? [alvo.path] : REPOSITORIOS_DA_RAIZ;
    for (const caminho of doAlvo) caminhos.set(normalizar(caminho), caminho);
  }
  for (const caminho of Object.keys(estado.status)) caminhos.set(normalizar(caminho), caminho);

  const repositorios = [...caminhos.values()]
    .map((caminho) => {
      const proprio = estado.alvos.find(
        (alvo) => alvo.type === 'repo' && normalizar(alvo.path) === normalizar(caminho),
      );
      const raiz = proprio ? undefined : raizQueCobre(estado, caminho);
      const ativo = proprio
        ? proprio.enabled !== false
        : Boolean(raiz) && !estaExcluido(raiz, caminho);
      const dono = donos.get(normalizar(caminho));
      return {
        caminho,
        alvo: proprio?.path ?? raiz?.path ?? '',
        alvoProprio: Boolean(proprio),
        ativo,
        politica: estado.politicas[caminho] ?? null,
        estado: estado.status[caminho] ?? null,
        ...(dono && { clienteId: dono.id, clienteNome: dono.nome }),
      };
    })
    .sort((a, b) => a.caminho.localeCompare(b.caminho, 'pt-BR'));

  return {
    instalado: estado.instalado,
    versao: estado.instalado ? estado.versao : null,
    horarios: estado.horarios,
    tarefas: estado.tarefaInstalada
      ? [
          {
            nome: 'GitAutoSync',
            estado: 'Ready',
            proximaExecucao: proximaExecucao(estado.horarios),
            ultimaExecucao: ontemAs('17:30'),
            ultimoResultado: 0,
          },
        ]
      : [],
    ultimaExecucao: Object.keys(estado.status).length > 0 ? ontemAs('17:30', 2) : null,
    bandeja: estado.bandeja,
    ia: estado.ia,
    agenteDaTarefa: null,
    ramoDoMr: 'main',
    alvos: estado.alvos,
    repositorios,
  };
}

function raizQueCobre(estado, caminho) {
  return estado.alvos.find(
    (alvo) => alvo.type === 'root' && normalizar(alvo.path) === normalizar(pai(caminho)),
  );
}

function estaExcluido(raiz, caminho) {
  return (raiz.exclude ?? []).some((excluido) => normalizar(excluido) === normalizar(caminho));
}

/** Mesma regra de `sincronizacaoComClientes.ts`, com os clones de `preparar-dados.mjs` como as pastas que existem. */
function repositoriosDosClientes(estado, clientes) {
  const visao = montarVisao(estado, clientes);
  const repositorios = clientes.flatMap((cliente) =>
    cliente.repositorios
      .filter((repositorio) => repositorio.caminhoLocal)
      .map((repositorio) => {
        const caminho = repositorio.caminhoLocal;
        let situacao = 'fora';
        let raiz = null;
        const proprio = estado.alvos.find(
          (alvo) => alvo.type === 'repo' && normalizar(alvo.path) === normalizar(caminho),
        );
        const cobertura = raizQueCobre(estado, caminho);
        if (!CLONES_EXISTENTES.has(caminho.toLowerCase())) situacao = 'pasta-ausente';
        else if (proprio) situacao = proprio.enabled === false ? 'desligado' : 'ativo';
        else if (cobertura) {
          raiz = cobertura.path;
          situacao = estaExcluido(cobertura, caminho) ? 'excluido' : 'ativo';
        }
        return {
          clienteId: cliente.id,
          clienteNome: cliente.nome,
          repositorioId: repositorio.id,
          url: repositorio.url,
          caminho,
          situacao,
          raiz,
          repositorio:
            visao.repositorios.find((item) => normalizar(item.caminho) === normalizar(caminho)) ??
            null,
        };
      }),
  );

  const porPasta = new Map();
  for (const { caminho, situacao } of repositorios) {
    if (situacao !== 'fora') continue;
    const pasta = pai(caminho);
    porPasta.set(pasta, (porPasta.get(pasta) ?? 0) + 1);
  }
  const sugestoesDeRaiz = [...porPasta]
    .filter(([, quantidade]) => quantidade >= 3)
    .map(([pasta, quantidade]) => ({ pasta, quantidade }));
  return { repositorios, sugestoesDeRaiz };
}

function adicionar(estado, caminho, tipo) {
  if (tipo === 'root') {
    estado.alvos.push({ path: caminho, type: 'root', enabled: true, exclude: [] });
    return;
  }
  const raiz = raizQueCobre(estado, caminho);
  if (raiz && estaExcluido(raiz, caminho)) {
    raiz.exclude = raiz.exclude.filter((excluido) => normalizar(excluido) !== normalizar(caminho));
    return;
  }
  estado.alvos.push({ path: caminho, type: 'repo', enabled: true });
}

function retirar(estado, caminho) {
  const proprio = estado.alvos.findIndex((alvo) => normalizar(alvo.path) === normalizar(caminho));
  if (proprio !== -1) {
    estado.alvos.splice(proprio, 1);
    return;
  }
  raizQueCobre(estado, caminho)?.exclude.push(caminho);
}

const HISTORICO = [
  ['9f3c2e1a7b6d', 2, 'feat(pesagem): agrupa as pesagens do lote na mesma nota'],
  ['4b8e1d0c3a92', 3, 'fix(pesagem): arredonda o peso médio para duas casas'],
  ['c27a9f4e8d15', 6, 'chore: auto-commit'],
  ['e5d1b3a0f7c4', 9, 'feat(balanca): lê o peso direto da balança da mangueira'],
  ['17f0a8c2d9e3', 14, 'feat: estrutura inicial'],
];

function historico() {
  return HISTORICO.map(([hash, dias, message]) => {
    const data = new Date();
    data.setDate(data.getDate() - dias);
    data.setHours(17, 30, 4, 0);
    const mensagem =
      message === 'chore: auto-commit'
        ? `chore: auto-commit ${dataHora(data).slice(0, 16)}`
        : message;
    return { hash: `${hash}${'0'.repeat(28)}`, date: data.toISOString(), message: mensagem };
  });
}

function linhasDoLog(estado) {
  const barras = (caminho) => caminho.replace(/\\/g, '/');
  return [
    `${ontemAs('17:30', 0)} [agendado] inicio da rodada (3 repositorios)`,
    `${ontemAs('17:30', 4)} [${barras(noWorkspace('boavista-pesagem'))}] commit e push concluidos`,
    `${ontemAs('17:30', 9)} [${barras(noWorkspace('valedocafe-cotas'))}] AVISO: push falhou, remoto inacessivel`,
    `${ontemAs('17:30', 12)} [${barras(REPOSITORIOS_DA_RAIZ[1])}] sem alteracoes pendentes`,
    `${ontemAs('17:30', 12)} [agendado] fim da rodada: 1 enviado, 1 pendente, 1 sem alteracoes`,
    ...(estado.extrasDoLog ?? []),
  ];
}

/**
 * Responde todas as rotas do Git AutoSync com o estado em memória. Devolve o estado, para o
 * roteiro mudar o cenário (desinstalar, tirar o Git, fazer uma ação falhar).
 */
export async function simularAutosync(painel) {
  const estado = criarEstado();
  const lerClientes = () => painel.evaluate(() => fetch('/api/clientes').then((r) => r.json()));
  const vazio = { saida: '' };

  await painel.route(
    (url) => url.pathname.startsWith('/api/autosync'),
    async (rota) => {
      const pedido = rota.request();
      const url = new URL(pedido.url());
      const caminho = url.pathname.replace('/api/autosync', '') || '/';
      const corpo = pedido.postDataJSON?.() ?? {};
      const metodo = pedido.method();
      const responder = (json) => rota.fulfill({ json });

      if (caminho === '/' && metodo === 'GET') {
        // Sem o Git AutoSync não há config nem status: a prévia sai vazia.
        const visao = estado.instalado
          ? montarVisao(estado, await lerClientes())
          : montarVisao(
              {
                ...estado,
                alvos: [],
                status: {},
                horarios: [],
                tarefaInstalada: false,
                bandeja: false,
                ia: { ligada: false, agente: 'auto' },
              },
              [],
            );
        return responder(visao);
      }
      if (caminho === '/clientes')
        return responder(repositoriosDosClientes(estado, await lerClientes()));
      if (caminho === '/git') {
        return responder({
          instalado: estado.gitInstalado,
          versao: estado.gitInstalado ? '2.47.1.windows.1' : null,
        });
      }
      if (caminho === '/instalar') {
        // Instalação nova: nenhum repositório ainda, só o horário e a bandeja escolhidos.
        Object.assign(estado, {
          instalado: true,
          horarios: corpo.horario ? [corpo.horario] : [],
          tarefaInstalada: Boolean(corpo.horario),
          bandeja: Boolean(corpo.bandeja),
          ia: { ligada: false, agente: 'auto' },
          alvos: [],
          status: {},
          politicas: {},
        });
        return responder(vazio);
      }
      if (caminho === '/repositorios' && metodo === 'POST') {
        adicionar(estado, corpo.caminho, corpo.tipo);
        return responder(vazio);
      }
      if (caminho === '/repositorios' && metodo === 'DELETE') {
        retirar(estado, corpo.caminho);
        return responder(vazio);
      }
      if (caminho === '/repositorios/lote') {
        const { repositorios } = repositoriosDosClientes(estado, await lerClientes());
        const resultado = { adicionados: [], jaEstavam: [], ignorados: [], falhas: [] };
        for (const item of repositorios) {
          if (item.situacao === 'fora') {
            adicionar(estado, item.caminho, 'repo');
            resultado.adicionados.push(item.caminho);
          } else if (item.situacao === 'ativo') resultado.jaEstavam.push(item.caminho);
          else resultado.ignorados.push({ caminho: item.caminho, motivo: 'A pasta não existe.' });
        }
        return responder(resultado);
      }
      if (caminho === '/agendamento') {
        estado.horarios = [...corpo.horarios].sort();
        estado.tarefaInstalada = true;
        return responder(vazio);
      }
      if (caminho === '/agendamento/instalar') {
        estado.tarefaInstalada = true;
        return responder(vazio);
      }
      if (caminho === '/agendamento/desinstalar') {
        estado.tarefaInstalada = false;
        estado.bandeja = false;
        return responder(vazio);
      }
      if (caminho === '/bandeja') {
        estado.bandeja = corpo.ligada;
        return responder(vazio);
      }
      if (caminho === '/ia') {
        estado.ia = { ligada: corpo.ligada, agente: corpo.agente ?? estado.ia.agente };
        return responder(vazio);
      }
      if (caminho === '/politica') {
        const atual = { ...(estado.politicas[corpo.caminho] ?? {}) };
        if (corpo.include) atual.include = corpo.include;
        if (corpo.exclude) atual.exclude = corpo.exclude;
        if (corpo.ramos) atual.allowedBranches = corpo.ramos;
        if (corpo.maxBytes) atual.maxFileBytes = corpo.maxBytes;
        if (corpo.ia) atual.aiEnabled = corpo.ia === 'on';
        estado.politicas[corpo.caminho] = atual;
        return responder(atual);
      }
      if (caminho === '/previa') {
        return responder({
          caminho: url.searchParams.get('caminho'),
          mensagem: 'fix(embalagens): corrige o cálculo do peso da caixa no romaneio',
        });
      }
      if (['/commit', '/push', '/sincronizar', '/merge-request'].includes(caminho)) {
        const falha = estado.falhas.get(normalizar(corpo.caminho ?? ''));
        if (falha) {
          estado.falhas.delete(normalizar(corpo.caminho));
          return rota.fulfill({ status: 502, json: falha });
        }
        if (corpo.caminho && caminho !== '/merge-request') {
          estado.status[corpo.caminho] = {
            lastRun: dataHora(new Date()),
            lastPush: caminho === '/commit' ? undefined : dataHora(new Date()),
            success: true,
            hadChanges: caminho !== '/push',
            pushed: caminho !== '/commit',
            message:
              caminho === '/commit' ? 'commit feito, push pendente' : 'commit e push concluidos',
            state: caminho === '/commit' ? 'pending_push' : 'synced',
          };
        }
        return responder(vazio);
      }
      if (caminho === '/historico') return responder({ commits: historico() });
      if (caminho === '/log') return responder({ linhas: linhasDoLog(estado) });
      if (caminho === '/gitlab') {
        return responder({ host: 'gitlab.consultoria-demo.example', tokenDefinido: true });
      }
      // Terminal e qualquer outra coisa: nada roda na máquina.
      return rota.fulfill({ status: 204 });
    },
  );
  return estado;
}

/** Mostra os clones de `preparar-dados.mjs` como `C:\Workspace\<nome>`, qualquer que seja a instância. */
export async function mostrarRepositoriosEmCWorkspace(painel) {
  const ehListaOuCliente = (url) => /^\/api\/clientes(\/[0-9a-f-]{36})?$/.test(url.pathname);
  const reescrever = (cliente) => ({
    ...cliente,
    repositorios: cliente.repositorios.map((repositorio) => ({
      ...repositorio,
      ...(repositorio.caminhoLocal && {
        caminhoLocal: repositorio.caminhoLocal.replace(
          PASTA_DOS_CLONES_NA_TELA,
          `${PASTA_DOS_CLONES}\\`,
        ),
      }),
    })),
  });

  await painel.route(ehListaOuCliente, async (rota) => {
    if (rota.request().method() !== 'GET') return rota.fallback();
    const resposta = await rota.fetch();
    const dados = await resposta.json();
    const json = Array.isArray(dados) ? dados.map(reescrever) : reescrever(dados);
    return rota.fulfill({ response: resposta, json });
  });
}

/** O id de `preparar-dados.mjs`, para achar os clientes pelo apelido. */
export function idFicticio(apelido) {
  const h = createHash('md5').update(apelido).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function roteiro({ painel, print }) {
  await mostrarRepositoriosEmCWorkspace(painel);
  const estado = await simularAutosync(painel);
  const esperarAvisos = () => painel.waitForTimeout(ESPERA_DOS_AVISOS_MS);
  const tela = painel.locator('#mount-autosync');
  const secao = (titulo) =>
    tela.locator('.secao-recursos', { has: painel.locator('h3', { hasText: titulo }) });
  const linha = (local, texto) => local.locator('.linha-recurso', { hasText: texto });
  const botao = (local, rotulo) => local.getByRole('button', { name: rotulo, exact: true }).first();
  const valeDoCafe = linha(secao('Repositórios'), 'valedocafe-cotas');
  const boaVista = linha(secao('Repositórios'), 'boavista-pesagem');

  // Aba Git AutoSync
  await print('visao-geral-01-aba', { destacando: ['#btn-visualizacao-autosync'] });
  await painel.click('#btn-visualizacao-autosync');
  await secao('Estado').waitFor();
  await print('visao-geral-02-tela', {
    destacando: ['#ultima-atualizacao-autosync', '#btn-atualizar-autosync'],
  });
  await painel.click('#btn-sobre-autosync');
  await print('visao-geral-03-sobre', {
    destacando: [painel.locator('#modal-autosync-sobre a', { hasText: 'Abrir o repositório' })],
  });
  await painel.click('#btn-fechar-autosync-sobre');

  // Estado e bandeja
  await print('estado-e-bandeja-01-estado', { destacando: [secao('Estado')] });
  await botao(secao('Estado'), 'Ligar bandeja').click();
  await print('estado-e-bandeja-02-confirmar', {
    destacando: ['#btn-confirmar-autosync-confirmacao'],
  });
  await painel.click('#btn-confirmar-autosync-confirmacao');
  await botao(secao('Estado'), 'Desligar bandeja').waitFor();
  await print('estado-e-bandeja-03-ligada', {
    destacando: [botao(secao('Estado'), 'Desligar bandeja')],
  });
  await esperarAvisos();

  // Horários e agendamento
  const agendamento = secao('Quando roda');
  await agendamento.locator('input[type="time"]').fill('12:30');
  await botao(agendamento, 'Incluir').click();
  await print('horarios-e-agendamento-01-incluir', {
    destacando: [agendamento.locator('.edicao-de-horarios-do-autosync')],
  });
  await botao(agendamento, 'Salvar horários').click();
  await painel.locator('.aviso').first().waitFor();
  await print('horarios-e-agendamento-02-salvar', {
    destacando: [
      botao(agendamento, 'Salvar horários'),
      secao('Estado').locator('.selos-do-autosync'),
    ],
  });
  await esperarAvisos();
  await botao(agendamento, 'Desativar agendamento').click();
  await print('horarios-e-agendamento-03-desativar', {
    destacando: ['#btn-confirmar-autosync-confirmacao'],
  });
  await painel.click('#btn-cancelar-autosync-confirmacao');

  // Rodar agora
  await botao(agendamento, 'Rodar agora').click();
  await print('rodar-agora-01-confirmar', { destacando: ['#btn-confirmar-autosync-confirmacao'] });
  await painel.click('#btn-confirmar-autosync-confirmacao');
  await painel.locator('.aviso').first().waitFor();
  await print('rodar-agora-02-concluido', { destacando: ['.aviso'] });
  await esperarAvisos();

  // Mensagem do commit com IA
  const mensagem = secao('Mensagem do commit');
  await mensagem.locator('input[type="checkbox"]').click();
  await print('mensagem-com-ia-01-confirmar', {
    destacando: ['#btn-confirmar-autosync-confirmacao'],
  });
  await painel.click('#btn-confirmar-autosync-confirmacao');
  await mensagem.locator('select:not([disabled])').waitFor();
  await esperarAvisos();
  await print('mensagem-com-ia-02-agente', { destacando: [mensagem.locator('select')] });

  // Repositórios e pastas-raiz
  const repositorios = secao('Repositórios');
  await repositorios.scrollIntoViewIfNeeded();
  await repositorios.locator('.secao-cabecalho').scrollIntoViewIfNeeded();
  await painel.evaluate(() =>
    document
      .querySelector('#mount-autosync .sugestao-do-autosync')
      ?.closest('.secao-recursos')
      .scrollIntoView({ block: 'start' }),
  );
  await print('repositorios-e-pastas-01-lista', {
    destacando: [
      botao(repositorios, 'Adicionar todos os repositórios dos clientes (4)'),
      repositorios.locator('.sugestao-do-autosync'),
    ],
  });
  const linhaDaRaiz = linha(repositorios, 'Pasta-raiz');
  await print('repositorios-e-pastas-02-raiz', {
    destacando: [linhaDaRaiz.locator('.recurso-info'), botao(linhaDaRaiz, 'Tirar a pasta')],
  });
  await boaVista.scrollIntoViewIfNeeded();
  await print('repositorios-e-pastas-03-linha', {
    destacando: [boaVista.locator('.selos-do-autosync'), boaVista.locator('.recurso-acoes-extras')],
  });

  // Histórico de commits
  await boaVista.locator('[aria-label="Histórico de commits"]').click();
  await painel.locator('#mount-autosync-historico .historico-do-autosync').waitFor();
  await print('historico-01-lista', { destacando: ['#mount-autosync-historico'] });
  await painel.click('#btn-fechar-autosync-historico');

  // Política do repositório
  await boaVista.locator('[aria-label="Política do repositório"]').click();
  await painel.fill('#campo-autosync-max-bytes', '2097152');
  await print('politica-01-formulario', {
    destacando: ['#formulario-autosync-politica .modal-corpo'],
  });
  await painel.click('#btn-salvar-autosync-politica');
  await painel.locator('.aviso', { hasText: 'Política gravada.' }).waitFor();
  await esperarAvisos();

  // Como resolver: o push do Vale do Café é rejeitado
  const caminhoDoValeDoCafe = noWorkspace('valedocafe-cotas');
  const saida = saidaDoPushRejeitado(
    caminhoDoValeDoCafe,
    'https://github.com/consultoria-demo/valedocafe-cotas.git',
  );
  estado.falhas.set(normalizar(caminhoDoValeDoCafe), {
    mensagem: saida,
    sugestoes: [
      {
        explicacao: 'O remoto tem commits que você não tem: traga-os antes de enviar.',
        comandos: ['git pull --rebase origin main', 'git push origin HEAD:refs/heads/main'],
      },
    ],
  });
  await valeDoCafe.scrollIntoViewIfNeeded();
  await botao(valeDoCafe, 'Push').click();
  const correcao = valeDoCafe.locator('.correcao-do-autosync');
  await correcao.waitFor();
  await correcao.scrollIntoViewIfNeeded();
  await print('como-resolver-01-bloco', { destacando: [correcao] });
  await esperarAvisos();
  await correcao.locator('summary').click();
  await correcao.locator('.saida-do-autosync').scrollIntoViewIfNeeded();
  await print('como-resolver-02-saida', {
    destacando: [correcao.locator('.saida-do-autosync'), botao(correcao, 'Dispensar')],
  });
  await botao(correcao, 'Dispensar').click();

  // Merge Request e token do GitLab
  await botao(valeDoCafe, 'Merge Request').click();
  await painel.fill('#campo-autosync-mr-titulo', 'Cotas por produtor');
  await print('merge-request-01-formulario', {
    destacando: ['#formulario-autosync-mr .modal-corpo'],
  });
  await painel.click('#btn-cancelar-autosync-mr');
  await painel.locator('#visualizacao-autosync .detalhe-cabecalho').scrollIntoViewIfNeeded();
  await print('merge-request-02-engrenagem', { destacando: ['#btn-configuracao-autosync'] });
  await painel.click('#btn-configuracao-autosync');
  await print('merge-request-03-token', {
    destacando: ['#formulario-autosync-configuracao .grupo-de-acessos'],
  });
  await painel.click('#btn-cancelar-autosync-configuracao');

  // Log
  const log = tela.locator('details.grupo-recolhivel');
  await log.locator('summary').click();
  await log.locator('pre', { hasText: 'fim da rodada' }).waitFor();
  await log.scrollIntoViewIfNeeded();
  await print('log-01-linhas', { destacando: [log] });

  // AutoSync na aba Git do cliente; dali saem também o commit, o push e o sincronizar.
  await painel.click('#btn-visualizacao-clientes');
  await painel.locator('.item-cliente', { hasText: 'Indústria Alfa' }).click();
  await painel.locator('.detalhe-abas button', { hasText: 'Git' }).click();
  const doCliente = painel.locator('.detalhe .secao-recursos', {
    has: painel.locator('h3', { hasText: 'AutoSync' }),
  });
  const alfa = doCliente.locator('.linha-recurso');
  await botao(alfa, 'Adicionar ao Git AutoSync').waitFor();
  await doCliente.scrollIntoViewIfNeeded();
  await print('aba-git-do-cliente-01-secao', {
    destacando: [botao(alfa, 'Adicionar ao Git AutoSync')],
  });
  await botao(alfa, 'Adicionar ao Git AutoSync').click();
  await botao(alfa, 'Tirar do Git AutoSync').waitFor();
  await print('aba-git-do-cliente-02-adicionado', {
    destacando: [alfa.locator('.selos-do-autosync')],
  });
  await esperarAvisos();

  await print('commit-push-e-sincronizar-01-botoes', {
    destacando: [alfa.locator('.recurso-acoes-linha').first()],
  });
  await botao(alfa, 'Commit').click();
  await painel.click('#btn-autosync-previa');
  await painel.waitForFunction(
    () => document.querySelector('#campo-autosync-mensagem').value !== '',
  );
  await print('commit-push-e-sincronizar-02-previa', {
    destacando: ['#btn-autosync-previa', '#campo-autosync-mensagem'],
  });
  await painel.click('#btn-confirmar-autosync-commit');
  await painel.locator('.aviso').first().waitFor();
  await alfa.locator('.selo-situacao.atencao', { hasText: 'push pendente' }).waitFor();
  await print('commit-push-e-sincronizar-03-commit', {
    destacando: [alfa.locator('.selos-do-autosync'), '.aviso'],
  });
  await esperarAvisos();
  await botao(alfa, 'Sincronizar').click();
  await print('commit-push-e-sincronizar-04-sincronizar', {
    destacando: ['#formulario-autosync-commit .modal-corpo'],
  });
  await painel.click('#btn-cancelar-autosync-commit');

  // Instalar: o mesmo painel, agora numa máquina sem o Git AutoSync e, no começo, sem o Git.
  estado.instalado = false;
  estado.gitInstalado = false;
  await painel.click('#btn-visualizacao-autosync');
  await painel.locator('#btn-instalar-autosync:not([hidden])').waitFor();
  await painel.locator('#visualizacao-autosync .detalhe-cabecalho').scrollIntoViewIfNeeded();
  await print('instalar-01-previa', { destacando: ['#btn-instalar-autosync'] });
  await painel.click('#btn-instalar-autosync');
  await painel.waitForSelector('#modal-autosync-sem-git[open]');
  await print('instalar-02-sem-git', { destacando: ['#btn-verificar-git-autosync'] });
  estado.gitInstalado = true;
  await painel.click('#btn-verificar-git-autosync');
  await painel.waitForSelector('#modal-autosync-instalacao[open]');
  await print('instalar-03-opcoes', {
    destacando: ['#formulario-autosync-instalacao .modal-corpo'],
  });
  await painel.click('#btn-confirmar-autosync-instalacao');
  await secao('Estado').waitFor();
  await painel.locator('.aviso', { hasText: 'Git AutoSync instalado.' }).waitFor();
  await print('instalar-04-instalado', { destacando: ['.aviso'] });
}
