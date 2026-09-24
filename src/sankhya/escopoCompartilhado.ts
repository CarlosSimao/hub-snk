/**
 * Arquivo de tarefas compartilhado com IAs externas.
 *
 * Um JSON por demanda, numa pasta que a pessoa escolhe (em geral o repositório do
 * cliente, onde o Claude, o Codex ou o Copilot já trabalham). O hub reescreve o arquivo a
 * cada mudança no quadro e vigia o arquivo: quando outro processo altera `estado` ou
 * `notas` de uma tarefa, a mudança entra no banco e o quadro da tela acompanha.
 *
 * Arquivo e não porta/servidor: qualquer modelo que sabe editar arquivo participa, sem
 * configurar MCP, token nem rede — e o arquivo é legível por gente também.
 *
 * Só `estado` e `notas` voltam do arquivo. Título, estimativa e o resto são do hub: um
 * modelo "arrumando" o texto não pode reescrever o escopo combinado com o cliente.
 */
import { existsSync, readFileSync, renameSync, rmSync, unwatchFile, watchFile, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { ESTADOS_TAREFA, type CompartilhamentoEscopo, type EstadoTarefa, type TarefaEscopo } from '../types.ts';
import { ehEstado, type Escopo } from './escopo.ts';

/** `watchFile` e não `watch`: editor e agente costumam salvar trocando o arquivo, e o `watch` do Windows perde isso. */
const INTERVALO_VIGIA_MS = 1500;

interface Vigia {
  docId: number;
  clienteId: number;
  arquivo: string;
  /** Texto que o hub gravou por último — o arquivo igual a ele é eco da própria escrita. */
  escrito: string;
  /** `estado`/`notas` como o hub os deixou no arquivo: a edição externa é o que difere disto. */
  base: Map<number, { estado: EstadoTarefa; notas: string }>;
  situacao: CompartilhamentoEscopo;
}

export function nomeDoArquivo(docId: number): string {
  return `sankhya-hub-tarefas-${docId}.json`;
}

const MARCA = 'sankhya-hub';

/**
 * O arquivo em `caminho` pode ser (re)usado por esta demanda? Sim se não existe ou se é
 * o JSON que o hub gerou para ela. Qualquer outro arquivo é de alguém — sobrescrever
 * apagaria o conteúdo dele sem aviso.
 */
export function arquivoLivrePara(caminho: string, docId: number): boolean {
  if (!existsSync(caminho)) return true;
  try {
    const dados = JSON.parse(readFileSync(caminho, 'utf8').replace(/^﻿/, '')) as Record<string, unknown>;
    return dados['geradoPor'] === MARCA && dados['documentoId'] === docId;
  } catch {
    return false;
  }
}

export interface ResultadoGitignore {
  /** O .gitignore da raiz do repositório, ou '' quando a pasta não está em repositório git. */
  gitignore: string;
  entrada: string;
  /** false quando a entrada já estava lá (ou não havia repositório). */
  adicionada: boolean;
}

/** Sobe da pasta até achar o `.git` (pasta, ou arquivo em worktree/submódulo). */
function raizDoRepositorio(pasta: string): string | undefined {
  let atual = resolve(pasta);
  for (;;) {
    if (existsSync(join(atual, '.git'))) return atual;
    const pai = dirname(atual);
    if (pai === atual) return undefined;
    atual = pai;
  }
}

/**
 * Tira o arquivo de tarefas (ou a pasta Tarefas inteira) do controle de versão do
 * repositório onde ele caiu: é estado de trabalho do hub, muda a cada cartão movido, e
 * não deve virar commit — nem do git-autosync, que comitaria cada mudança de coluna.
 */
export function ignorarNoGit(caminho: string, ehPasta: boolean): ResultadoGitignore {
  const raiz = raizDoRepositorio(ehPasta ? caminho : dirname(caminho));
  if (!raiz) return { gitignore: '', entrada: '', adicionada: false };

  const relativo = relative(raiz, resolve(caminho)).split(sep).join('/');
  const entrada = ehPasta ? `/${relativo}/` : `/${relativo}`;
  const gitignore = join(raiz, '.gitignore');
  const atual = existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : '';

  const normal = (l: string) => l.trim().replace(/^\//, '').replace(/\/$/, '');
  if (atual.split(/\r?\n/).some((l) => normal(l) === normal(entrada))) {
    return { gitignore, entrada, adicionada: false };
  }
  const quebra = atual.includes('\r\n') ? '\r\n' : '\n';
  const antes = atual && !atual.endsWith('\n') ? quebra : '';
  const bloco = `${atual ? quebra : ''}# sankhya-hub: tarefas compartilhadas com IA${quebra}${entrada}${quebra}`;
  writeFileSync(gitignore, `${atual}${antes}${bloco}`);
  return { gitignore, entrada, adicionada: true };
}

/** Subpasta que junta os arquivos de todas as demandas compartilhadas num mesmo lugar. */
export const PASTA_TAREFAS = 'Tarefas';

/**
 * Nome digitado vira nome de arquivo seguro: sem separador de caminho (não sai da pasta),
 * sem caractere que o Windows recusa, sempre `.json`. '' quando não sobra nada.
 */
export function nomeDeArquivoSeguro(nome: string): string {
  const base = nome
    .trim()
    .replace(/\.json$/i, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return base ? `${base}.json` : '';
}

/** "Portal do Cliente" -> "portal-do-cliente.json": a sugestão que a tela oferece. */
export function nomeSugerido(demanda: string): string {
  const slug = demanda
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${slug || 'tarefas'}.json`;
}

const APELIDOS: Record<string, EstadoTarefa> = {
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

/** Modelo escreve o rótulo ("Em andamento", "Concluído") tanto quanto o código — os dois valem. */
export function estadoDoTexto(valor: string): EstadoTarefa | undefined {
  const v = valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return ehEstado(v) ? v : APELIDOS[v];
}

function ordenadas(tarefas: TarefaEscopo[]): TarefaEscopo[] {
  const coluna = (e: EstadoTarefa) => ESTADOS_TAREFA.indexOf(e);
  return [...tarefas].sort((a, b) => coluna(a.estado) - coluna(b.estado) || a.ordem - b.ordem || a.id - b.id);
}

export class CompartilhamentoTarefas {
  readonly #escopo: Escopo;
  readonly #nomeCliente: (clienteId: number) => string;
  readonly #vigias = new Map<number, Vigia>();
  readonly #pararDeOuvir: () => void;
  /** Durante a importação o próprio hub move cartões — isso não pode disparar nova escrita no meio. */
  #importando = false;

  constructor(escopo: Escopo, nomeCliente: (clienteId: number) => string) {
    this.#escopo = escopo;
    this.#nomeCliente = nomeCliente;
    this.#pararDeOuvir = escopo.aoMudar((clienteId) => {
      if (this.#importando) return;
      for (const v of this.#vigias.values()) if (v.clienteId === clienteId) this.#sincronizar(v);
    });
    for (const doc of escopo.documentosCompartilhados()) {
      this.#vigiar(doc.id, doc.clienteId, join(doc.compartilharEm, doc.compartilharNome || nomeDoArquivo(doc.id)));
    }
  }

  situacao(docId: number): CompartilhamentoEscopo | undefined {
    const s = this.#vigias.get(docId)?.situacao;
    return s ? { ...s } : undefined;
  }

  /** Outra demanda já usa este arquivo? Duas escrevendo no mesmo JSON se apagariam mutuamente. */
  quemUsa(arquivo: string, excetoDocId: number): number | undefined {
    const alvo = resolve(arquivo).toLowerCase();
    for (const v of this.#vigias.values()) {
      if (v.docId !== excetoDocId && resolve(v.arquivo).toLowerCase() === alvo) return v.docId;
    }
    return undefined;
  }

  /** Pasta e nome já vêm validados pela rota. */
  ligar(docId: number, pasta: string, nome: string): CompartilhamentoEscopo | undefined {
    const doc = this.#escopo.definirCompartilhamento(docId, pasta, nome);
    if (!doc) return undefined;
    const arquivo = join(pasta, nome);
    // Trocou pasta ou nome: o arquivo antigo ficaria para trás, parecendo vivo.
    const antigo = this.#vigias.get(docId)?.arquivo;
    this.#parar(docId, antigo !== undefined && resolve(antigo) !== resolve(arquivo));
    this.#vigiar(doc.id, doc.clienteId, arquivo);
    return this.situacao(docId);
  }

  /**
   * Desligar apaga o arquivo: ele leva o nome do documento, é do hub, e deixá-lo para trás
   * faria um religar futuro importar estados velhos por cima do quadro.
   */
  desligar(docId: number): void {
    this.#escopo.definirCompartilhamento(docId, '');
    this.#parar(docId, true);
  }

  /** Documento removido: o registro já foi junto, só falta parar de vigiar e apagar o arquivo. */
  esquecer(docId: number): void {
    this.#parar(docId, true);
  }

  fechar(): void {
    this.#pararDeOuvir();
    for (const docId of [...this.#vigias.keys()]) this.#parar(docId, false);
  }

  #vigiar(docId: number, clienteId: number, arquivo: string): void {
    // Base = o banco agora. Arquivo que já existe (edição feita com o hub desligado) é
    // comparado contra ela e importado antes de ser reescrito.
    const v: Vigia = {
      docId,
      clienteId,
      arquivo,
      escrito: '',
      base: this.#baseAtual(docId),
      situacao: { arquivo, sincronizadoEm: '', importadoEm: '', mudancasImportadas: 0, erro: '' },
    };
    this.#vigias.set(docId, v);
    this.#sincronizar(v);
    watchFile(arquivo, { interval: INTERVALO_VIGIA_MS, persistent: false }, () => this.#sincronizar(v));
  }

  #parar(docId: number, apagar: boolean): void {
    const v = this.#vigias.get(docId);
    if (!v) return;
    unwatchFile(v.arquivo);
    this.#vigias.delete(docId);
    if (apagar) rmSync(v.arquivo, { force: true });
  }

  #baseAtual(docId: number): Vigia['base'] {
    return new Map(this.#escopo.tarefasDaDemanda(docId).map((t) => [t.id, { estado: t.estado, notas: t.notas }]));
  }

  #sincronizar(v: Vigia): void {
    if (this.#vigias.get(v.docId) !== v) return;
    let lido: string | undefined;
    try {
      lido = existsSync(v.arquivo) ? readFileSync(v.arquivo, 'utf8') : undefined;
    } catch {
      lido = undefined;
    }

    let avisos: string[] = [];
    if (lido !== undefined && lido !== v.escrito) {
      const r = this.#importar(v, lido);
      // JSON quebrado: pode ser o outro lado no meio da edição. Sobrescrever apagaria o
      // trabalho dele; espera a próxima gravação válida.
      if (!r.ok) return;
      avisos = r.avisos;
    }
    const erroEscrita = this.#escrever(v);
    v.situacao.erro = [...avisos, ...(erroEscrita ? [erroEscrita] : [])].join('; ');
  }

  #importar(v: Vigia, texto: string): { ok: boolean; avisos: string[] } {
    let dados: unknown;
    try {
      dados = JSON.parse(texto.replace(/^﻿/, ''));
    } catch (err) {
      v.situacao.erro = `o arquivo não é um JSON válido (${(err as Error).message}) — corrija, ou apague para o hub recriar`;
      return { ok: false, avisos: [] };
    }
    const lista = (dados as { tarefas?: unknown } | null)?.tarefas;
    if (!Array.isArray(lista)) {
      v.situacao.erro = 'o arquivo não tem a lista "tarefas" — apague para o hub recriar';
      return { ok: false, avisos: [] };
    }

    const avisos: string[] = [];
    let mudancas = 0;
    this.#importando = true;
    try {
      for (const item of lista) {
        if (!item || typeof item !== 'object') continue;
        const t = item as Record<string, unknown>;
        const id = Number(t['id']);
        const base = v.base.get(id);
        const atual = base ? this.#escopo.tarefa(id) : undefined;
        if (!base || !atual || atual.documentoId !== v.docId) continue;

        const estadoTexto = t['estado'];
        if (typeof estadoTexto === 'string' && estadoTexto !== base.estado) {
          const estado = estadoDoTexto(estadoTexto);
          if (!estado) {
            avisos.push(`tarefa ${id}: estado "${estadoTexto.slice(0, 40)}" não existe`);
          } else if (estado !== atual.estado) {
            this.#escopo.mover(id, estado, Number.MAX_SAFE_INTEGER);
            mudancas += 1;
          }
        }
        const notas = t['notas'];
        if (typeof notas === 'string' && notas.trim() !== base.notas && notas.trim() !== atual.notas) {
          this.#escopo.atualizarTarefa(id, { notas });
          mudancas += 1;
        }
      }
    } finally {
      this.#importando = false;
    }

    if (mudancas) {
      v.situacao.importadoEm = new Date().toISOString();
      v.situacao.mudancasImportadas = mudancas;
    }
    return { ok: true, avisos };
  }

  /** Devolve a mensagem de erro, ou '' quando gravou (ou não havia o que gravar). */
  #escrever(v: Vigia): string {
    const doc = this.#escopo.documento(v.docId);
    if (!doc) return '';
    const tarefas = ordenadas(this.#escopo.tarefasDaDemanda(v.docId));
    const conteudo = `${JSON.stringify(
      {
        geradoPor: MARCA,
        documentoId: doc.id,
        sobre:
          `Tarefas da demanda "${doc.demanda}" do cliente ${this.#nomeCliente(doc.clienteId) || doc.clienteId}, ` +
          'mantidas pelo Development Switch (sankhya-hub). O quadro kanban do hub lê este arquivo de volta.',
        comoAtualizar: [
          'Releia o arquivo antes de editar: o hub o reescreve quando alguém mexe no quadro.',
          `Altere só "estado" e "notas". Estados válidos: ${ESTADOS_TAREFA.join(', ')}.`,
          'Fluxo: ao começar uma tarefa, "em_andamento"; pronta para conferência, "em_revisao"; entregue, "concluido".',
          'Em "notas", registre o que foi feito, onde (arquivos, commit) ou o que está bloqueando.',
          'Não mude "id", não crie nem remova tarefas (isso é feito no hub) e mantenha o JSON válido.',
          'Ao salvar, o hub importa em poucos segundos e regrava o arquivo normalizado.',
        ],
        demanda: doc.demanda,
        documentoDeEscopo: doc.nome,
        resumoDoEscopo: doc.resumo,
        atualizadoEm: tarefas.reduce((m, t) => (t.atualizadaEm > m ? t.atualizadaEm : m), doc.analisadoEm || doc.enviadoEm),
        tarefas: tarefas.map((t) => ({
          id: t.id,
          titulo: t.titulo,
          estado: t.estado,
          notas: t.notas,
          funcionalidade: t.grupo,
          tipo: t.tipo,
          prioridade: t.prioridade,
          estimativaHoras: t.estimativaHoras,
          descricao: t.descricao,
          criteriosAceite: t.criteriosAceite ? t.criteriosAceite.split('\n').filter((l) => l.trim()) : [],
        })),
      },
      null,
      2,
    )}\n`;

    v.base = new Map(tarefas.map((t) => [t.id, { estado: t.estado, notas: t.notas }]));
    if (conteudo === v.escrito && existsSync(v.arquivo)) return '';

    const temporario = `${v.arquivo}.${process.pid}.tmp`;
    try {
      writeFileSync(temporario, conteudo);
      try {
        renameSync(temporario, v.arquivo);
      } catch {
        // Windows recusa o rename quando outro programa segura o arquivo aberto.
        writeFileSync(v.arquivo, conteudo);
        rmSync(temporario, { force: true });
      }
    } catch (err) {
      rmSync(temporario, { force: true });
      return `não consegui gravar ${v.arquivo}: ${(err as Error).message}`;
    }
    v.escrito = conteudo;
    v.situacao.sincronizadoEm = new Date().toISOString();
    return '';
  }
}
