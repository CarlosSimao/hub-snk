import type {
  ConfiguracaoDoAutosync,
  OpcoesDeInstalacao,
  StatusDoAutosync,
  TarefaDoAgendador,
} from './tiposDoAutosync.ts';

export interface ResultadoDoCli {
  codigo: number;
  /** stdout e stderr juntos: o git escreve em stderr sem que seja erro. */
  saida: string;
}

/**
 * Contrato com o Git AutoSync instalado na máquina.
 *
 * As rotas dependem só desta abstração; os testes trocam a implementação por um
 * dublê e nenhum deles toca no `~/.git-autosync` real nem no Agendador.
 *
 * Leitura de `config.json`, `status.json` e `autosync.log` é direta e só para exibir.
 * Escrita, sempre por `executar`: o CLI é o dono dos arquivos.
 */
export interface CliDoAutosync {
  instalado(): boolean;
  versao(): Promise<string | null>;

  /**
   * Roda o CLI com os argumentos em lista, sem shell. Não lança por código de saída
   * diferente de zero — o `doctor` sai com 1 e a saída ainda é útil; quem chama
   * decide. Lança `GitAutosyncNaoInstaladoError` quando não há CLI.
   */
  executar(argumentos: readonly string[], tempoLimiteMs?: number): Promise<ResultadoDoCli>;

  /** `null` quando o arquivo ainda não existe (o CLI o cria na primeira chamada). */
  lerConfiguracao(): Promise<ConfiguracaoDoAutosync | null>;
  lerStatus(): Promise<StatusDoAutosync | null>;
  lerLog(limite: number): Promise<string[]>;
  listarTarefas(): Promise<TarefaDoAgendador[]>;

  /**
   * Baixa o pacote da Release mais recente do Git AutoSync e roda o
   * `install-standalone.ps1` dele.
   */
  instalarPacote(opcoes: OpcoesDeInstalacao): Promise<ResultadoDoCli>;

  /** Saída do `git --version`, ou `null` quando o Git não está no PATH. */
  versaoDoGit(): Promise<string | null>;
}

/** Entrada inválida: caminho que não pode ser usado, horário malformado. Vira 400. */
export class GitAutosyncUsoError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'GitAutosyncUsoError';
  }
}

/** Pasta informada não existe. Vira 404. */
export class PastaDoAutosyncNaoEncontradaError extends Error {
  constructor(caminho: string) {
    super(`Pasta não encontrada: ${caminho}`);
    this.name = 'PastaDoAutosyncNaoEncontradaError';
  }
}

/** O CLI rodou e falhou. A mensagem é a saída dele, já redigida pelo próprio autosync. Vira 502. */
export class GitAutosyncFalhouError extends Error {
  constructor(saida: string) {
    super(saida);
    this.name = 'GitAutosyncFalhouError';
  }
}

/** Nem `.exe` nem `.bat` em `<home>/bin`. Vira 503. */
export class GitAutosyncNaoInstaladoError extends Error {
  constructor() {
    super('O Git AutoSync não está instalado nesta máquina.');
    this.name = 'GitAutosyncNaoInstaladoError';
  }
}

/** Sem Release, Release sem o `.zip`, ou plataforma sem instalador silencioso. Vira 409. */
export class PacoteDoAutosyncAusenteError extends Error {
  constructor(mensagem = 'O pacote do Git AutoSync não está disponível para esta máquina.') {
    super(mensagem);
    this.name = 'PacoteDoAutosyncAusenteError';
  }
}

export const URL_DO_GIT = 'https://git-scm.com/';

/** O Git AutoSync roda `git` em todo comando: sem ele no PATH, a instalação nem começa. Vira 409. */
export class GitAusenteError extends Error {
  constructor() {
    super(
      `O Git não está instalado nesta máquina. Baixe e instale em ${URL_DO_GIT} e tente de novo.`,
    );
    this.name = 'GitAusenteError';
  }
}
