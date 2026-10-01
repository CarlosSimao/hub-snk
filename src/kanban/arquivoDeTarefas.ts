/**
 * Arquivo de tarefas compartilhado com agentes de IA que editam arquivo.
 *
 * Um JSON por kanban, na subpasta `Tarefas` da pasta escolhida (em geral o repositório do
 * cliente, onde o Claude, o Codex ou o Copilot já trabalham). O HUB SNK reescreve o
 * arquivo a cada mudança no quadro e vigia o arquivo: quando outro processo altera
 * `estado` ou `notas` de uma tarefa, a mudança entra no banco e o quadro acompanha.
 *
 * Arquivo e não servidor: qualquer modelo que sabe editar arquivo participa, sem
 * configurar MCP, e funciona com o HUB SNK fechado — o que mudou nesse meio-tempo é
 * importado quando ele volta. Só `estado` e `notas` voltam do arquivo: título,
 * estimativa e o resto são o escopo combinado com o cliente.
 *
 * O nome do arquivo é o do projeto. Com mais de um kanban do mesmo projeto na mesma
 * pasta, o segundo leva também o nome do kanban. A pasta `Tarefas` entra no
 * `.gitignore` quando está dentro de um repositório Git — muda a cada cartão movido e
 * não deve virar commit, nem do Git AutoSync. Fora de repositório, ou sem Git na
 * máquina, ela só é criada.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unwatchFile,
  watchFile,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import {
  ehEstadoDeTarefa,
  type KanbanDosProjetos,
  type MudancaNoKanban,
} from './kanbanDosProjetos.ts';
import {
  ESTADOS_DE_TAREFA,
  type DemandaDoKanban,
  type EstadoDeTarefa,
  type SituacaoDoArquivoDeTarefas,
  type TarefaDoKanban,
} from './tiposDoKanban.ts';

export const PASTA_TAREFAS = 'Tarefas';

/** `watchFile` e não `watch`: editor e agente salvam trocando o arquivo, e o `watch` do Windows perde isso. */
const INTERVALO_DA_VIGIA_MS = 1500;
const MARCA = 'hub-snk';
const TAMANHO_MAXIMO_DO_NOME = 80;

/** Os nomes que o arquivo mostra; o cadastro dos clientes é lido à parte, sem bloquear. */
export type NomesDoKanban = (
  clienteId: string,
  projetoId: string,
) => Promise<{ cliente: string; projeto: string }>;

interface Vigia {
  demandaId: number;
  /** A pasta como o usuário escolheu: mudar ela é mudar de arquivo. */
  pastaEscolhida: string;
  caminho: string;
  /** O texto que o HUB SNK gravou por último: o arquivo igual a ele é eco da própria escrita. */
  escrito: string;
  /** `estado` e `notas` como o HUB SNK os deixou no arquivo: a edição de fora é o que difere disto. */
  base: Map<number, { estado: EstadoDeTarefa; notas: string; feitos: boolean[] }>;
  situacao: SituacaoDoArquivoDeTarefas;
}

/** "Portal de Pedidos" vira "portal-de-pedidos". */
export function slugDoNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, TAMANHO_MAXIMO_DO_NOME);
}

const APELIDOS: Record<string, EstadoDeTarefa> = {
  todo: 'a_fazer',
  fazer: 'a_fazer',
  doing: 'em_andamento',
  andamento: 'em_andamento',
  in_progress: 'em_andamento',
  revisao: 'em_revisao',
  review: 'em_revisao',
  done: 'concluido',
  feito: 'concluido',
  feita: 'concluido',
  concluida: 'concluido',
};

/** O modelo escreve o rótulo ("Em andamento", "Concluído") tanto quanto o código: os dois valem. */
export function estadoDoTexto(valor: string): EstadoDeTarefa | undefined {
  const normalizado = valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return ehEstadoDeTarefa(normalizado) ? normalizado : APELIDOS[normalizado];
}

/** A pasta `Tarefas` da escolhida, sem repetir quando a escolhida já é ela. */
export function pastaDasTarefas(pastaEscolhida: string): string {
  return basename(pastaEscolhida).toLowerCase() === PASTA_TAREFAS.toLowerCase()
    ? pastaEscolhida
    : join(pastaEscolhida, PASTA_TAREFAS);
}

/** Sobe da pasta até achar o `.git` (pasta, ou arquivo em worktree e submódulo). */
function raizDoRepositorio(pasta: string): string | undefined {
  let atual = resolve(pasta);
  for (;;) {
    if (existsSync(join(atual, '.git'))) {
      return atual;
    }
    const pai = dirname(atual);
    if (pai === atual) {
      return undefined;
    }
    atual = pai;
  }
}

/**
 * Põe a pasta `Tarefas` no `.gitignore` do repositório em que ela caiu. Não precisa do
 * Git instalado: só lê e grava o arquivo. Fora de repositório, não faz nada e devolve ''.
 */
export function ignorarNoGit(pasta: string): string {
  const raiz = raizDoRepositorio(pasta);
  if (!raiz) {
    return '';
  }
  const entrada = `/${relative(raiz, resolve(pasta)).split(sep).join('/')}/`;
  const gitignore = join(raiz, '.gitignore');
  const atual = existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : '';
  const normal = (linha: string) => linha.trim().replace(/^\//, '').replace(/\/$/, '');
  if (atual.split(/\r?\n/).some((linha) => normal(linha) === normal(entrada))) {
    return gitignore;
  }
  const quebra = atual.includes('\r\n') ? '\r\n' : '\n';
  const separador = atual && !atual.endsWith('\n') ? quebra : '';
  const bloco = `${atual ? quebra : ''}# HUB SNK: tarefas compartilhadas com IA${quebra}${entrada}${quebra}`;
  writeFileSync(gitignore, `${atual}${separador}${bloco}`);
  return gitignore;
}

/**
 * O arquivo pode ser (re)usado por este kanban? Sim se não existe ou se é o JSON que o
 * HUB SNK gerou para ele. Outro arquivo é de alguém: sobrescrever apagaria o conteúdo.
 */
export function arquivoLivrePara(caminho: string, demandaId: number): boolean {
  if (!existsSync(caminho)) {
    return true;
  }
  try {
    const dados = JSON.parse(readFileSync(caminho, 'utf8').replace(/^﻿/, '')) as Record<
      string,
      unknown
    >;
    return dados['geradoPor'] === MARCA && dados['documentoId'] === demandaId;
  } catch {
    return false;
  }
}

/** O que veio do HUB SNK: a edição de fora é o que difere disto. */
function baseDaTarefa(tarefa: TarefaDoKanban) {
  return {
    estado: tarefa.estado,
    notas: tarefa.notas,
    feitos: tarefa.checklist.map((item) => item.feito),
  };
}

function ordenadas(tarefas: TarefaDoKanban[]): TarefaDoKanban[] {
  const coluna = (estado: EstadoDeTarefa) => ESTADOS_DE_TAREFA.indexOf(estado);
  return [...tarefas].sort(
    (uma, outra) =>
      coluna(uma.estado) - coluna(outra.estado) || uma.ordem - outra.ordem || uma.id - outra.id,
  );
}

export class ArquivoDeTarefas {
  readonly #kanban: KanbanDosProjetos;
  readonly #nomes: NomesDoKanban;
  readonly #vigias = new Map<number, Vigia>();
  /** Uma sincronização por kanban de cada vez: a vigia e o quadro disparam juntos. */
  readonly #filas = new Map<number, Promise<void>>();
  readonly #pararDeOuvir: () => void;
  #fechado = false;

  constructor(kanban: KanbanDosProjetos, nomes: NomesDoKanban) {
    this.#kanban = kanban;
    this.#nomes = nomes;
    this.#pararDeOuvir = kanban.aoMudar((mudanca) => this.#enfileirar(mudanca));
  }

  /** Volta a vigiar os arquivos ligados, importando o que mudou com o HUB SNK fechado. */
  iniciar(): Promise<void> {
    return Promise.all(
      this.#kanban.demandasComPasta().map((demanda) =>
        this.#enfileirar({
          demandaId: demanda.id,
          clienteId: demanda.clienteId,
          removida: false,
        }),
      ),
    ).then(() => undefined);
  }

  situacao(demandaId: number): SituacaoDoArquivoDeTarefas | undefined {
    const situacao = this.#vigias.get(demandaId)?.situacao;
    return situacao ? { ...situacao } : undefined;
  }

  /** Espera a sincronização em andamento do kanban: a rota responde com o arquivo já gravado. */
  aguardar(demandaId: number): Promise<void> {
    return this.#filas.get(demandaId) ?? Promise.resolve();
  }

  fechar(): void {
    this.#fechado = true;
    this.#pararDeOuvir();
    for (const demandaId of [...this.#vigias.keys()]) {
      this.#parar(demandaId, false);
    }
  }

  #enfileirar(mudanca: MudancaNoKanban): Promise<void> {
    const anterior = this.#filas.get(mudanca.demandaId) ?? Promise.resolve();
    const proxima = anterior
      .then(() => this.#reconciliar(mudanca))
      .catch(() => {
        // Falha de um kanban não pode travar a fila dele para sempre; o erro já está na situação.
      });
    this.#filas.set(mudanca.demandaId, proxima);
    void proxima.finally(() => {
      if (this.#filas.get(mudanca.demandaId) === proxima) {
        this.#filas.delete(mudanca.demandaId);
      }
    });
    return proxima;
  }

  /** Liga, troca, desliga ou só regrava, conforme a pasta do kanban agora. */
  async #reconciliar({ demandaId, removida }: MudancaNoKanban): Promise<void> {
    if (this.#fechado) {
      return;
    }
    if (removida) {
      this.#parar(demandaId, true);
      return;
    }

    let demanda: DemandaDoKanban;
    try {
      demanda = this.#kanban.demanda(demandaId);
    } catch {
      this.#parar(demandaId, true);
      return;
    }

    const vigia = this.#vigias.get(demandaId);
    if (!demanda.pasta) {
      // Desligar apaga o arquivo: deixá-lo faria um religar futuro importar estados velhos.
      if (vigia) {
        this.#parar(demandaId, true);
        this.#kanban.definirNomeDoArquivo(demandaId, '');
      }
      return;
    }
    if (vigia && vigia.pastaEscolhida === demanda.pasta) {
      await this.#sincronizar(vigia, demanda);
      return;
    }

    // Pasta nova (ou primeira): o arquivo antigo ficaria para trás parecendo vivo.
    this.#parar(demandaId, true);
    await this.#ligar(demanda);
  }

  async #ligar(demanda: DemandaDoKanban): Promise<void> {
    const pasta = pastaDasTarefas(demanda.pasta);
    const vigia: Vigia = {
      demandaId: demanda.id,
      pastaEscolhida: demanda.pasta,
      caminho: '',
      escrito: '',
      base: this.#baseAtual(demanda.id),
      situacao: {
        caminho: '',
        sincronizadoEm: '',
        importadoEm: '',
        mudancasImportadas: 0,
        gitignore: '',
        erro: '',
      },
    };
    this.#vigias.set(demanda.id, vigia);

    // A pasta escolhida tem de existir: criá-la espalharia pastas por erro de digitação.
    if (!existsSync(demanda.pasta) || !statSync(demanda.pasta).isDirectory()) {
      vigia.situacao.erro = `A pasta não existe mais: ${demanda.pasta}`;
      return;
    }
    try {
      mkdirSync(pasta, { recursive: true });
    } catch (erro) {
      vigia.situacao.erro = `Não foi possível criar ${pasta}: ${(erro as Error).message}`;
      return;
    }
    try {
      vigia.situacao.gitignore = ignorarNoGit(pasta);
    } catch {
      // `.gitignore` é conveniência: sem ele o arquivo só aparece como mudança no Git.
    }

    const nome = await this.#escolherNome(demanda, pasta);
    vigia.caminho = join(pasta, nome);
    vigia.situacao.caminho = vigia.caminho;
    if (nome !== demanda.arquivoNome) {
      this.#kanban.definirNomeDoArquivo(demanda.id, nome);
    }

    await this.#sincronizar(vigia, demanda);
    watchFile(vigia.caminho, { interval: INTERVALO_DA_VIGIA_MS, persistent: false }, () => {
      void this.#enfileirar({
        demandaId: demanda.id,
        clienteId: demanda.clienteId,
        removida: false,
      });
    });
  }

  /** O nome do projeto; se outro kanban já o usa nesta pasta, junta o nome do kanban. */
  async #escolherNome(demanda: DemandaDoKanban, pasta: string): Promise<string> {
    const { projeto } = await this.#nomes(demanda.clienteId, demanda.projetoId);
    const doKanban = slugDoNome(demanda.nome) || 'kanban';
    const base = slugDoNome(projeto) || doKanban;
    const candidatos = [
      demanda.arquivoNome,
      `${base}.json`,
      `${base}-${doKanban}.json`,
      `${base}-${demanda.id}.json`,
    ].filter(Boolean);

    for (const candidato of candidatos) {
      const caminho = join(pasta, candidato);
      if (!this.#outroUsa(caminho, demanda.id) && arquivoLivrePara(caminho, demanda.id)) {
        return candidato;
      }
    }
    return `${base}-${demanda.id}-${Date.now()}.json`;
  }

  #outroUsa(caminho: string, demandaId: number): boolean {
    const alvo = resolve(caminho).toLowerCase();
    for (const vigia of this.#vigias.values()) {
      if (
        vigia.demandaId !== demandaId &&
        vigia.caminho &&
        resolve(vigia.caminho).toLowerCase() === alvo
      ) {
        return true;
      }
    }
    return false;
  }

  #parar(demandaId: number, apagar: boolean): void {
    const vigia = this.#vigias.get(demandaId);
    if (!vigia) {
      return;
    }
    this.#vigias.delete(demandaId);
    if (vigia.caminho) {
      unwatchFile(vigia.caminho);
      if (apagar && arquivoLivrePara(vigia.caminho, demandaId)) {
        rmSync(vigia.caminho, { force: true });
      }
    }
  }

  #baseAtual(demandaId: number): Vigia['base'] {
    return new Map(
      this.#kanban.tarefasDaDemanda(demandaId).map((tarefa) => [tarefa.id, baseDaTarefa(tarefa)]),
    );
  }

  async #sincronizar(vigia: Vigia, demanda: DemandaDoKanban): Promise<void> {
    if (this.#vigias.get(vigia.demandaId) !== vigia || !vigia.caminho) {
      return;
    }
    let lido: string | undefined;
    try {
      lido = existsSync(vigia.caminho) ? readFileSync(vigia.caminho, 'utf8') : undefined;
    } catch {
      lido = undefined;
    }

    let avisos: string[] = [];
    if (lido !== undefined && lido !== vigia.escrito) {
      const importacao = this.#importar(vigia, lido);
      // JSON quebrado pode ser o outro lado no meio da edição: espera a próxima gravação válida.
      if (!importacao.ok) {
        return;
      }
      avisos = importacao.avisos;
    }
    const erroDaEscrita = await this.#escrever(vigia, this.#kanban.demanda(demanda.id));
    vigia.situacao.erro = [...avisos, ...(erroDaEscrita ? [erroDaEscrita] : [])].join('; ');
  }

  #importar(vigia: Vigia, texto: string): { ok: boolean; avisos: string[] } {
    let dados: unknown;
    try {
      dados = JSON.parse(texto.replace(/^﻿/, ''));
    } catch (erro) {
      vigia.situacao.erro = `O arquivo não é um JSON válido (${(erro as Error).message}). Corrija, ou apague para o HUB SNK recriar.`;
      return { ok: false, avisos: [] };
    }
    const lista = (dados as { tarefas?: unknown } | null)?.tarefas;
    if (!Array.isArray(lista)) {
      vigia.situacao.erro = 'O arquivo não tem a lista "tarefas". Apague para o HUB SNK recriar.';
      return { ok: false, avisos: [] };
    }

    const avisos: string[] = [];
    let mudancas = 0;
    for (const item of lista) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const tarefa = item as Record<string, unknown>;
      const id = Number(tarefa['id']);
      const base = vigia.base.get(id);
      if (!base) {
        continue;
      }
      let atual: TarefaDoKanban;
      try {
        atual = this.#kanban.tarefa(id);
      } catch {
        continue;
      }
      if (atual.demandaId !== vigia.demandaId) {
        continue;
      }

      const estadoEscrito = tarefa['estado'];
      if (typeof estadoEscrito === 'string' && estadoEscrito !== base.estado) {
        const estado = estadoDoTexto(estadoEscrito);
        if (!estado) {
          avisos.push(`Tarefa ${id}: o estado "${estadoEscrito.slice(0, 40)}" não existe`);
        } else if (estado !== atual.estado) {
          this.#kanban.moverTarefa(id, estado, Number.POSITIVE_INFINITY);
          mudancas += 1;
        }
      }
      // Da lista volta só o "feito" de cada item: o texto dos itens é do HUB SNK.
      const lista = tarefa['checklist'];
      if (Array.isArray(lista)) {
        let mudou = false;
        const checklist = atual.checklist.map((item, posicao) => {
          const escrito = lista[posicao] as { feito?: unknown } | undefined;
          const feito = escrito?.feito;
          if (
            typeof feito === 'boolean' &&
            feito !== base.feitos[posicao] &&
            feito !== item.feito
          ) {
            mudou = true;
            return { ...item, feito };
          }
          return item;
        });
        if (mudou) {
          this.#kanban.atualizarTarefa(id, { checklist });
          mudancas += 1;
        }
      }
      const notas = tarefa['notas'];
      if (
        typeof notas === 'string' &&
        notas.trim() !== base.notas &&
        notas.trim() !== atual.notas
      ) {
        this.#kanban.atualizarTarefa(id, { notas });
        mudancas += 1;
      }
    }

    if (mudancas) {
      vigia.situacao.importadoEm = new Date().toISOString();
      vigia.situacao.mudancasImportadas += mudancas;
    }
    return { ok: true, avisos };
  }

  /** Devolve a mensagem de erro, ou '' quando gravou (ou não havia o que gravar). */
  async #escrever(vigia: Vigia, demanda: DemandaDoKanban): Promise<string> {
    const { cliente, projeto } = await this.#nomes(demanda.clienteId, demanda.projetoId);
    const tarefas = ordenadas(this.#kanban.tarefasDaDemanda(demanda.id));
    const conteudo = `${JSON.stringify(
      {
        geradoPor: MARCA,
        documentoId: demanda.id,
        sobre:
          `Tarefas do kanban "${demanda.nome}"${projeto ? ` do projeto "${projeto}"` : ''} do cliente ${cliente || demanda.clienteId}, ` +
          'mantidas pelo HUB SNK. O quadro kanban do HUB SNK lê este arquivo de volta.',
        comoAtualizar: [
          'Releia o arquivo antes de editar: o HUB SNK o reescreve quando alguém mexe no quadro.',
          `Altere só "estado", "notas" e o "feito" dos itens de "checklist". Estados válidos: ${ESTADOS_DE_TAREFA.join(', ')}.`,
          'Fluxo: ao começar uma tarefa, "em_andamento"; pronta para conferência, "em_revisao"; entregue, "concluido".',
          'Em "notas", registre o que foi feito, onde (arquivos, commit) ou o que está bloqueando.',
          'Não mude "id", não crie nem remova tarefas (isso é feito no HUB SNK) e mantenha o JSON válido.',
          'Ao salvar, o HUB SNK importa em poucos segundos e regrava o arquivo normalizado.',
        ],
        projeto,
        demanda: demanda.nome,
        documentoDeEscopo: demanda.documento?.nome ?? '',
        resumoDoEscopo: demanda.resumo,
        atualizadoEm: tarefas.reduce(
          (maisRecente, tarefa) =>
            tarefa.atualizadaEm > maisRecente ? tarefa.atualizadaEm : maisRecente,
          demanda.analisadaEm || demanda.criadaEm,
        ),
        tarefas: tarefas.map((tarefa) => ({
          id: tarefa.id,
          titulo: tarefa.titulo,
          estado: tarefa.estado,
          notas: tarefa.notas,
          funcionalidade: tarefa.grupo,
          tipo: tarefa.tipo,
          prioridade: tarefa.prioridade,
          estimativaHoras: tarefa.estimativaHoras,
          descricao: tarefa.descricao,
          criteriosAceite: tarefa.criteriosDeAceite
            ? tarefa.criteriosDeAceite.split('\n').filter((linha) => linha.trim())
            : [],
          checklist: tarefa.checklist,
        })),
      },
      null,
      2,
    )}\n`;

    vigia.base = new Map(tarefas.map((tarefa) => [tarefa.id, baseDaTarefa(tarefa)]));
    if (conteudo === vigia.escrito && existsSync(vigia.caminho)) {
      return '';
    }

    const temporario = `${vigia.caminho}.${process.pid}.tmp`;
    try {
      writeFileSync(temporario, conteudo);
      try {
        renameSync(temporario, vigia.caminho);
      } catch {
        // O Windows recusa o rename quando outro programa segura o arquivo aberto.
        writeFileSync(vigia.caminho, conteudo);
        rmSync(temporario, { force: true });
      }
    } catch (erro) {
      rmSync(temporario, { force: true });
      return `Não foi possível gravar ${vigia.caminho}: ${(erro as Error).message}`;
    }
    vigia.escrito = conteudo;
    vigia.situacao.sincronizadoEm = new Date().toISOString();
    return '';
  }
}
