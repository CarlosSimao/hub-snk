import { isAbsolute } from 'node:path';
import type { Cliente } from '../tipos.ts';
import {
  GitAutosyncFalhouError,
  GitAutosyncUsoError,
  PastaDoAutosyncNaoEncontradaError,
  type CliDoAutosync,
  type ResultadoDoCli,
} from './cliDoAutosync.ts';
import {
  classificarRepositoriosDosClientes,
  inspecionarPasta,
  sugerirRaizes,
  vincularClientes,
  type SituacaoDaPasta,
} from './sincronizacaoComClientes.ts';
import type {
  AgenteDeIa,
  CommitDoAutosync,
  OpcoesDeInstalacao,
  PoliticaDoRepositorio,
  RepositorioDeClienteNoAutosync,
  ResultadoDoLote,
  SugestaoDeRaiz,
  VisaoDoAutosync,
} from './tiposDoAutosync.ts';
import {
  alvoProprio,
  estaExcluidoDaRaiz,
  lerVisao,
  listarRepositoriosDaRaiz,
  normalizarCaminho,
  paiNormalizado,
  raizQueCobre,
} from './visaoDoAutosync.ts';

export const TAMANHO_MAXIMO_DO_CAMINHO = 400;

/** `sync --all` percorre todos os repositórios, cada um com push e talvez IA. */
const TEMPO_LIMITE_DA_RODADA_COMPLETA_MS = 900_000;

export interface Saida {
  saida: string;
}

export interface CamposDaPolitica {
  include?: string[];
  exclude?: string[];
  ramos?: string[];
  maxBytes?: number;
  ia?: 'on' | 'off';
}

export interface OpcoesDoMr {
  titulo?: string;
  destino?: string;
  origem?: string;
}

export interface DependenciasDoServicoDoAutosync {
  cli: CliDoAutosync;
  listarClientes: () => Promise<Cliente[]>;
  listarDaRaiz?: (raiz: string) => Promise<string[]>;
  inspecionar?: (caminho: string) => SituacaoDaPasta;
  /** Abre o terminal preferido na pasta, com o script padrão das configurações. */
  abrirTerminal?: (caminho: string) => Promise<void>;
}

/*
 * O argparse do autosync sai com código 2 e imprime `usage:` quando não reconhece
 * subcomando ou flag. Na prática isso é autosync antigo na máquina, e "atualize"
 * é a instrução útil — não o texto do argparse.
 */
function ehErroDeArgumento({ codigo, saida }: ResultadoDoCli): boolean {
  return codigo === 2 && /usage: git-autosync/i.test(saida);
}

function exigirSucesso(resultado: ResultadoDoCli): string {
  if (resultado.codigo === 0) {
    return resultado.saida.trim();
  }
  if (ehErroDeArgumento(resultado)) {
    throw new GitAutosyncFalhouError(
      `Esta versão do Git AutoSync não reconhece o comando. Atualize o Git AutoSync.\n\n${resultado.saida.trim()}`,
    );
  }
  throw new GitAutosyncFalhouError(
    resultado.saida.trim() || `O git-autosync saiu com código ${resultado.codigo}.`,
  );
}

/** Primeiro `{` até o último `}`: tolera aviso impresso antes do JSON. */
function extrairJson(saida: string): unknown {
  const inicio = saida.indexOf('{');
  const fim = saida.lastIndexOf('}');
  if (inicio === -1 || fim < inicio) {
    throw new GitAutosyncFalhouError('A saída do git-autosync não é JSON.');
  }
  try {
    return JSON.parse(saida.slice(inicio, fim + 1)) as unknown;
  } catch {
    throw new GitAutosyncFalhouError('A saída do git-autosync não é JSON.');
  }
}

/**
 * Tudo o que o HUB SNK faz com o Git AutoSync, traduzido em subcomandos do CLI.
 *
 * Nada aqui grava o `config.json`: toda escrita é um subcomando, que toma o
 * `state.lock` e grava de forma atômica. Editar o arquivo por fora perderia o que a
 * bandeja ou a tarefa agendada gravassem ao mesmo tempo, e deixaria `schedules`
 * dizendo uma coisa e o Agendador outra.
 */
export class ServicoDoAutosync {
  readonly #cli: CliDoAutosync;
  readonly #listarClientes: () => Promise<Cliente[]>;
  readonly #listarDaRaiz: (raiz: string) => Promise<string[]>;
  readonly #inspecionar: (caminho: string) => SituacaoDaPasta;
  readonly #abrirTerminal: ((caminho: string) => Promise<void>) | null;

  constructor(dependencias: DependenciasDoServicoDoAutosync) {
    this.#cli = dependencias.cli;
    this.#listarClientes = dependencias.listarClientes;
    this.#listarDaRaiz = dependencias.listarDaRaiz ?? listarRepositoriosDaRaiz;
    this.#inspecionar = dependencias.inspecionar ?? inspecionarPasta;
    this.#abrirTerminal = dependencias.abrirTerminal ?? null;
  }

  instalado(): boolean {
    return this.#cli.instalado();
  }

  async visao(comClientes = false): Promise<VisaoDoAutosync> {
    const visao = await lerVisao(this.#cli, this.#listarDaRaiz);
    return comClientes ? vincularClientes(visao, await this.#listarClientes()) : visao;
  }

  async repositoriosDosClientes(): Promise<{
    repositorios: RepositorioDeClienteNoAutosync[];
    sugestoesDeRaiz: SugestaoDeRaiz[];
  }> {
    const [visao, clientes] = await Promise.all([this.visao(), this.#listarClientes()]);
    const repositorios = classificarRepositoriosDosClientes(clientes, visao, this.#inspecionar);
    return { repositorios, sugestoesDeRaiz: sugerirRaizes(repositorios) };
  }

  /**
   * Põe o repositório (ou a pasta-raiz) no autosync pelo caminho certo para o caso.
   *
   * Repositório dentro de uma raiz já cadastrada não ganha `add`: ele já roda, e um
   * alvo a mais só duplicaria. Se estiver no `exclude` da raiz, o que o reativa é
   * `include`. Alvo próprio com `enabled: false` não tem subcomando para religar:
   * sai e entra de novo.
   */
  async adicionar(caminho: string, tipo: 'repo' | 'root'): Promise<Saida> {
    const visao = await this.#visaoComCaminhoPermitido(caminho, { paraAdicionar: true });
    const pasta = this.#inspecionar(caminho);
    if (pasta === 'ausente') {
      throw new PastaDoAutosyncNaoEncontradaError(caminho);
    }
    if (tipo === 'repo' && pasta === 'nao-e-repositorio') {
      throw new GitAutosyncUsoError(`A pasta não é um repositório Git: ${caminho}`);
    }

    if (tipo === 'root') {
      const existente = visao.alvos.find(
        (alvo) =>
          alvo.type === 'root' && normalizarCaminho(alvo.path) === normalizarCaminho(caminho),
      );
      if (existente) {
        return { saida: `A pasta já está no Git AutoSync: ${existente.path}` };
      }
      return { saida: await this.#executar(['add', caminho, '--type', 'root']) };
    }

    const proprio = alvoProprio(visao.alvos, caminho);
    if (proprio) {
      if (proprio.enabled !== false) {
        return { saida: `O repositório já está no Git AutoSync: ${proprio.path}` };
      }
      await this.#removerAlvo(proprio.path);
      return { saida: await this.#executar(['add', caminho, '--type', 'repo']) };
    }

    const raiz = raizQueCobre(visao.alvos, caminho);
    if (raiz) {
      if (estaExcluidoDaRaiz(raiz, caminho)) {
        return { saida: await this.#executar(['include', caminho]) };
      }
      return { saida: `O repositório já roda pela pasta ${raiz.path}.` };
    }

    return { saida: await this.#executar(['add', caminho, '--type', 'repo']) };
  }

  /**
   * Tira do autosync sem levar nada junto: alvo próprio sai com `remove`; repositório
   * que veio de uma raiz sai com `exclude`, porque `remove` na raiz levaria todos os
   * outros repositórios dela. Não checa a pasta: a que foi apagada também precisa sair.
   */
  async retirar(caminho: string): Promise<Saida> {
    const visao = await this.#visaoComCaminhoPermitido(caminho);

    const alvo = visao.alvos.find(
      (candidato) => normalizarCaminho(candidato.path) === normalizarCaminho(caminho),
    );
    if (alvo) {
      return { saida: await this.#removerAlvo(alvo.path) };
    }

    const raiz = raizQueCobre(visao.alvos, caminho);
    if (raiz) {
      if (estaExcluidoDaRaiz(raiz, caminho)) {
        return { saida: `O repositório já está fora da pasta ${raiz.path}.` };
      }
      return { saida: await this.#executar(['exclude', caminho]) };
    }

    return { saida: 'O repositório não está no Git AutoSync.' };
  }

  async excluirDaRaiz(caminho: string): Promise<Saida> {
    await this.#visaoComCaminhoPermitido(caminho);
    return { saida: await this.#executar(['exclude', caminho]) };
  }

  async incluirNaRaiz(caminho: string): Promise<Saida> {
    await this.#visaoComCaminhoPermitido(caminho);
    return { saida: await this.#executar(['include', caminho]) };
  }

  /**
   * Adiciona, um a um e em série, os repositórios de clientes que estão fora. O
   * `state.lock` já serializaria; em paralelo só haveria contenção. Uma falha não
   * interrompe os seguintes.
   */
  async adicionarRepositoriosDosClientes(): Promise<ResultadoDoLote> {
    const { repositorios } = await this.repositoriosDosClientes();
    const resultado: ResultadoDoLote = {
      adicionados: [],
      jaEstavam: [],
      ignorados: [],
      falhas: [],
    };

    for (const repositorio of repositorios) {
      const { caminho } = repositorio;
      switch (repositorio.situacao) {
        case 'fora':
          try {
            await this.#executar(['add', caminho, '--type', 'repo']);
            resultado.adicionados.push(caminho);
          } catch (erro) {
            resultado.falhas.push({ caminho, erro: (erro as Error).message });
          }
          break;
        case 'ativo':
          resultado.jaEstavam.push(caminho);
          break;
        case 'excluido':
          resultado.ignorados.push({
            caminho,
            motivo: `Excluído da pasta ${repositorio.raiz ?? ''}: reative pelo repositório.`,
          });
          break;
        case 'desligado':
          resultado.ignorados.push({ caminho, motivo: 'Desligado no Git AutoSync.' });
          break;
        case 'pasta-ausente':
          resultado.ignorados.push({ caminho, motivo: 'A pasta não existe.' });
          break;
        case 'nao-e-repositorio':
          resultado.ignorados.push({ caminho, motivo: 'A pasta não é um repositório Git.' });
          break;
      }
    }

    return resultado;
  }

  /** O CLI reinstala a tarefa junto: não há passo de reinstalar depois. */
  async definirHorarios(horarios: readonly string[]): Promise<Saida> {
    return { saida: await this.#executar(['set-schedule', horarios.join(',')]) };
  }

  async instalarTarefa(): Promise<Saida> {
    return { saida: await this.#executar(['install']) };
  }

  /** Atenção: o `uninstall` do CLI desliga também a bandeja no login. */
  async desinstalarTarefa(): Promise<Saida> {
    return { saida: await this.#executar(['uninstall']) };
  }

  async definirBandeja(ligada: boolean): Promise<Saida> {
    return { saida: await this.#executar([ligada ? 'enable-tray' : 'disable-tray']) };
  }

  async definirIa(
    ligada: boolean,
    agente?: AgenteDeIa,
  ): Promise<{ ligada: boolean; agente: string }> {
    await this.#executar(['set-ai', ligada ? 'on' : 'off']);
    if (agente) {
      await this.#executar(['set-agent', agente]);
    }
    const configuracao = await this.#cli.lerConfiguracao();
    return {
      ligada: configuracao?.aiEnabled === true,
      agente: configuracao?.aiAgent ?? 'auto',
    };
  }

  /**
   * Cada flag do `set-policy` substitui o campo inteiro, e o CLI não tem como limpar
   * um campo: `--exclude ""` grava `[""]`, e um `include` assim bloquearia todo commit.
   * Lista vazia só é aceita quando o campo já está vazio.
   */
  async definirPolitica(caminho: string, campos: CamposDaPolitica): Promise<PoliticaDoRepositorio> {
    const visao = await this.#visaoComCaminhoPermitido(caminho);
    const atual =
      visao.repositorios.find((r) => normalizarCaminho(r.caminho) === normalizarCaminho(caminho))
        ?.politica ?? {};

    const argumentos = ['set-policy', '--repo', caminho];
    const listas = [
      ['include', '--include', campos.include, atual.include],
      ['exclude', '--exclude', campos.exclude, atual.exclude],
      ['ramos', '--branch', campos.ramos, atual.allowedBranches],
    ] as const;
    for (const [nome, flag, novos, gravados] of listas) {
      if (novos === undefined) {
        continue;
      }
      if (novos.length === 0) {
        if ((gravados ?? []).length > 0) {
          throw new GitAutosyncUsoError(
            `O Git AutoSync ainda não permite limpar o campo "${nome}" de uma política. Deixe ao menos um item.`,
          );
        }
        continue;
      }
      for (const item of novos) {
        argumentos.push(flag, item);
      }
    }
    if (campos.maxBytes !== undefined) {
      argumentos.push('--max-file-bytes', String(campos.maxBytes));
    }
    if (campos.ia !== undefined) {
      argumentos.push('--ai', campos.ia);
    }

    if (argumentos.length === 3) {
      return atual;
    }

    await this.#executar(argumentos);
    const configuracao = await this.#cli.lerConfiguracao();
    const politicas = configuracao?.repoPolicies ?? {};
    const chave = Object.keys(politicas).find(
      (c) => normalizarCaminho(c) === normalizarCaminho(caminho),
    );
    return chave === undefined ? {} : (politicas[chave] ?? {});
  }

  /** Mensagem que o autosync usaria agora. Não grava nada: o CLI desfaz o stage. */
  async previa(
    caminho: string,
  ): Promise<{ caminho: string; mensagem: string } | { semAlteracoes: true }> {
    await this.#visaoComCaminhoPermitido(caminho);
    const saida = await this.#executar(['preview', '--json', '--repo', caminho]);
    /* Sem alterações o CLI não imprime JSON: só `[OK] <caminho>: sem alteracoes pendentes`. */
    if (!saida.includes('{')) {
      return { semAlteracoes: true };
    }
    const dados = extrairJson(saida) as { path?: string; message?: string };
    return { caminho: dados.path ?? caminho, mensagem: dados.message ?? '' };
  }

  async commit(caminho: string, mensagem?: string): Promise<Saida> {
    await this.#visaoComCaminhoPermitido(caminho);
    const argumentos = ['commit', '--repo', caminho];
    if (mensagem) argumentos.push('--message', mensagem);
    return { saida: await this.#executar(argumentos) };
  }

  async push(caminho: string): Promise<Saida> {
    await this.#visaoComCaminhoPermitido(caminho);
    return { saida: await this.#executar(['push', '--repo', caminho]) };
  }

  /**
   * Commit + push. Sem caminho, todos os alvos (`sync --all`), que não aceita
   * mensagem. Com caminho, sempre `--repo`: sem ele o CLI opera no diretório atual.
   */
  async sincronizar(caminho?: string, mensagem?: string): Promise<Saida> {
    if (caminho === undefined) {
      if (mensagem) {
        throw new GitAutosyncUsoError('A mensagem só vale para um repositório: informe o caminho.');
      }
      return {
        saida: await this.#executar(['sync', '--all'], TEMPO_LIMITE_DA_RODADA_COMPLETA_MS),
      };
    }

    await this.#visaoComCaminhoPermitido(caminho);
    const argumentos = ['sync', '--repo', caminho];
    if (mensagem) argumentos.push('--message', mensagem);
    return { saida: await this.#executar(argumentos) };
  }

  /** Só GitLab. O token é gravado pelo `set-gitlab-token` do CLI, fora do HUB SNK. */
  async mergeRequest(caminho: string, opcoes: OpcoesDoMr): Promise<Saida> {
    await this.#visaoComCaminhoPermitido(caminho);
    const argumentos = ['mr', '--repo', caminho];
    if (opcoes.titulo) argumentos.push('--title', opcoes.titulo);
    if (opcoes.destino) argumentos.push('--target', opcoes.destino);
    if (opcoes.origem) argumentos.push('--source', opcoes.origem);
    return { saida: await this.#executar(argumentos) };
  }

  async historico(caminho: string, limite: number): Promise<CommitDoAutosync[]> {
    await this.#visaoComCaminhoPermitido(caminho);
    const saida = await this.#executar([
      'history',
      '--json',
      '--repo',
      caminho,
      '--limit',
      String(limite),
      '--since',
      'all',
    ]);
    /* Uma chave só, mas o CLI pode devolvê-la com barras diferentes das enviadas. */
    const dados = extrairJson(saida) as Record<string, CommitDoAutosync[]>;
    return Object.values(dados)[0] ?? [];
  }

  /**
   * Terminal na pasta do repositório, para resolver o que o autosync não resolve
   * sozinho (push rejeitado, conflito, credencial). Não roda comando nenhum.
   */
  async abrirTerminal(caminho: string): Promise<void> {
    await this.#visaoComCaminhoPermitido(caminho);
    if (!this.#abrirTerminal) {
      throw new GitAutosyncUsoError('Abrir o terminal não está disponível aqui.');
    }
    if (this.#inspecionar(caminho) === 'ausente') {
      throw new PastaDoAutosyncNaoEncontradaError(caminho);
    }
    await this.#abrirTerminal(caminho);
  }

  log(limite: number): Promise<string[]> {
    return this.#cli.lerLog(limite);
  }

  /** O `doctor` sai com 1 quando algum repositório falha, e a saída ainda é o diagnóstico. */
  async diagnostico(rede: boolean): Promise<unknown> {
    const resultado = await this.#cli.executar(rede ? ['doctor', '--network'] : ['doctor']);
    if (resultado.codigo !== 0 && !resultado.saida.includes('{')) {
      exigirSucesso(resultado);
    }
    return extrairJson(resultado.saida);
  }

  async instalar(opcoes: OpcoesDeInstalacao): Promise<Saida> {
    return { saida: exigirSucesso(await this.#cli.instalarPacote(opcoes)) };
  }

  async #executar(argumentos: readonly string[], tempoLimiteMs?: number): Promise<string> {
    return exigirSucesso(await this.#cli.executar(argumentos, tempoLimiteMs));
  }

  /*
   * O `remove` do CLI compara o caminho resolvido com o gravado, letra a letra: um alvo
   * gravado como `C:/...` não casa com o `C:\...` que ele resolve, e o CLI responde
   * "nenhum alvo encontrado" com código 0. Conferir depois é o que impede a tela de
   * dizer que tirou quando não tirou.
   */
  async #removerAlvo(caminhoGravado: string): Promise<string> {
    const saida = await this.#executar(['remove', caminhoGravado]);
    const configuracao = await this.#cli.lerConfiguracao();
    const continua = (configuracao?.targets ?? []).some(
      (alvo) => normalizarCaminho(alvo.path) === normalizarCaminho(caminhoGravado),
    );
    if (continua) {
      throw new GitAutosyncFalhouError(
        `O Git AutoSync não removeu o alvo ${caminhoGravado}. Remova pela interface do Git AutoSync.\n\n${saida}`,
      );
    }
    return saida;
  }

  /**
   * A API não é uma porta para o CLI operar em qualquer pasta do disco: o caminho
   * precisa ser absoluto e já conhecido — no autosync ou no cadastro de um cliente.
   * Para adicionar, vale também a pasta-mãe de um repositório de cliente (a raiz
   * sugerida pela §4.3).
   */
  async #visaoComCaminhoPermitido(
    caminho: string,
    { paraAdicionar = false } = {},
  ): Promise<VisaoDoAutosync> {
    if (!isAbsolute(caminho) || caminho.length > TAMANHO_MAXIMO_DO_CAMINHO) {
      throw new GitAutosyncUsoError('Informe o caminho absoluto da pasta.');
    }

    const [visao, clientes] = await Promise.all([
      lerVisao(this.#cli, this.#listarDaRaiz),
      this.#listarClientes(),
    ]);
    const chave = normalizarCaminho(caminho);

    const conhecidos = new Set<string>([
      ...visao.repositorios.map((r) => normalizarCaminho(r.caminho)),
      ...visao.alvos.map((alvo) => normalizarCaminho(alvo.path)),
    ]);
    for (const cliente of clientes) {
      for (const repositorioGit of cliente.repositorios) {
        if (repositorioGit.caminhoLocal) {
          conhecidos.add(normalizarCaminho(repositorioGit.caminhoLocal));
          if (paraAdicionar) {
            conhecidos.add(paiNormalizado(repositorioGit.caminhoLocal));
          }
        }
      }
    }

    if (!conhecidos.has(chave)) {
      throw new GitAutosyncUsoError(
        'O caminho não está no Git AutoSync nem no cadastro de um cliente.',
      );
    }
    return visao;
  }
}
