import type {
  BancoDeDados,
  Base,
  Cliente,
  LinkDoCliente,
  RepositorioGit,
  TipoDeBase,
} from '../tipos.ts';

export interface DadosDeCliente {
  nome: string;
}

export interface DadosDeBase {
  url: string;
  tipo: TipoDeBase;
  usuario: string;
  senha: string;
}

export type DadosDeBancoDeDados = BancoDeDados;

export interface DadosDeRepositorio {
  nome: string;
  url: string;
  caminhoLocal?: string;
}

export interface DadosDeLink {
  nome: string;
  url: string;
}

/**
 * Uma base vinda da importação de favoritos do navegador.
 *
 * Carrega o nome do cliente porque a importação ainda não sabe a qual cadastro
 * a base pertence: o nome é resolvido na hora — cliente existente é reutilizado,
 * nome inédito vira cliente novo.
 */
export interface DadosDeImportacaoDeBase extends DadosDeBase {
  nomeDoCliente: string;
}

export interface ResultadoDaImportacao {
  clientesCriados: number;
  basesImportadas: number;
}

/**
 * Uma base vinda do arquivo de cadastros do HUB SNK.
 *
 * Diferente da importação de favoritos, aqui a base pode trazer o banco de dados
 * vinculado e uma decisão já tomada na tela: `substituir` diz o que fazer quando
 * o cliente já tem uma base na mesma URL.
 */
export interface DadosDeBaseDeCadastro extends DadosDeBase {
  bancoDeDados?: DadosDeBancoDeDados;
  substituir: boolean;
}

/**
 * Um cliente do arquivo de cadastros, com as bases que vierem nele.
 *
 * A lista de bases pode ser vazia: o arquivo carrega o cliente mesmo quando nada
 * foi exportado além do nome dele.
 */
export interface DadosDeImportacaoDeCadastro {
  nome: string;
  bases: DadosDeBaseDeCadastro[];
}

export interface ResultadoDaImportacaoDeCadastros {
  clientesCriados: number;
  basesCriadas: number;
  basesSubstituidas: number;
  basesIgnoradas: number;
}

/**
 * Um repositório já clonado na máquina, vindo da varredura de pastas.
 *
 * Assim como na importação de favoritos, o cliente é resolvido pelo nome: a
 * varredura enxerga a pasta, não o cadastro, e o vínculo é escolhido na tela.
 */
export interface DadosDeImportacaoDeRepositorio extends DadosDeRepositorio {
  nomeDoCliente: string;
}

export interface ResultadoDaImportacaoDeRepositorios {
  clientesCriados: number;
  repositoriosImportados: number;
}

/**
 * Contrato de persistência de clientes e suas bases.
 *
 * As rotas dependem apenas desta abstração; trocar o armazenamento em arquivo
 * por outro — banco, API remota — não exige mudança nelas.
 */
export interface RepositorioClientes {
  /**
   * Esquece o que está em memória para que a próxima leitura volte ao disco.
   *
   * Existe por causa da pasta sincronizada com a nuvem: quando outra máquina
   * grava o arquivo, o cache daqui ficaria velho e a próxima gravação apagaria
   * o que chegou. Quem chama é o observador de `dados-hub-snk/`.
   */
  descartarCache(): void;

  listar(): Promise<Cliente[]>;
  buscarPorId(id: string): Promise<Cliente | undefined>;
  criar(dados: DadosDeCliente): Promise<Cliente>;
  atualizar(id: string, dados: DadosDeCliente): Promise<Cliente>;

  /**
   * Grava as anotações livres do cliente.
   *
   * Fica fora de `atualizar` porque não passa pela checagem de nome duplicado:
   * é só texto, e exigir o nome junto tornaria a gravação da anotação
   * dependente de um campo que ela não altera.
   */
  definirAnotacoes(id: string, anotacoes: string): Promise<Cliente>;

  remover(id: string): Promise<void>;

  adicionarBase(idDoCliente: string, dados: DadosDeBase): Promise<Base>;

  /**
   * Grava um lote de bases vindo da importação de favoritos.
   *
   * É tudo ou nada: qualquer item conflitante aborta o lote inteiro, para não
   * deixar metade dos favoritos cadastrada e a outra metade fora.
   */
  importarBases(itens: DadosDeImportacaoDeBase[]): Promise<ResultadoDaImportacao>;

  /**
   * Grava os clientes lidos de um arquivo de cadastros do HUB SNK.
   *
   * A URL identifica a base dentro do cliente: URL inédita entra, URL já
   * cadastrada só muda quando o item pede `substituir`. A substituição sobrescreve
   * apenas o que o arquivo trouxe — banco de dados ausente e credencial em branco
   * preservam o que já estava gravado, porque campo não exportado não é o mesmo
   * que campo apagado.
   *
   * É tudo ou nada, pelo mesmo motivo de `importarBases`.
   */
  importarCadastros(
    itens: DadosDeImportacaoDeCadastro[],
  ): Promise<ResultadoDaImportacaoDeCadastros>;

  atualizarBase(idDoCliente: string, idDaBase: string, dados: DadosDeBase): Promise<Base>;
  removerBase(idDoCliente: string, idDaBase: string): Promise<void>;

  /** Vincula ou substitui o banco de dados da base. */
  definirBancoDeDados(
    idDoCliente: string,
    idDaBase: string,
    dados: DadosDeBancoDeDados,
  ): Promise<BancoDeDados>;
  removerBancoDeDados(idDoCliente: string, idDaBase: string): Promise<void>;

  adicionarRepositorio(idDoCliente: string, dados: DadosDeRepositorio): Promise<RepositorioGit>;

  /**
   * Grava um lote de repositórios locais vindo da varredura de pastas.
   *
   * É tudo ou nada, pelo mesmo motivo de `importarBases`: item conflitante
   * aborta o lote inteiro em vez de cadastrar metade.
   */
  importarRepositorios(
    itens: DadosDeImportacaoDeRepositorio[],
  ): Promise<ResultadoDaImportacaoDeRepositorios>;

  atualizarRepositorio(
    idDoCliente: string,
    idDoRepositorio: string,
    dados: DadosDeRepositorio,
  ): Promise<RepositorioGit>;
  removerRepositorio(idDoCliente: string, idDoRepositorio: string): Promise<void>;

  adicionarLink(idDoCliente: string, dados: DadosDeLink): Promise<LinkDoCliente>;
  atualizarLink(idDoCliente: string, idDoLink: string, dados: DadosDeLink): Promise<LinkDoCliente>;
  removerLink(idDoCliente: string, idDoLink: string): Promise<void>;
}

export class ClienteNaoEncontradoError extends Error {
  constructor(id: string) {
    super(`Cliente não encontrado: ${id}`);
    this.name = 'ClienteNaoEncontradoError';
  }
}

export class NomeDeClienteDuplicadoError extends Error {
  constructor(nome: string) {
    super(`Já existe um cliente com o nome "${nome}".`);
    this.name = 'NomeDeClienteDuplicadoError';
  }
}

export class BaseNaoEncontradaError extends Error {
  constructor(id: string) {
    super(`Base não encontrada: ${id}`);
    this.name = 'BaseNaoEncontradaError';
  }
}

/**
 * A mesma URL pode se repetir dentro de um cliente desde que o usuário mude —
 * é o par URL + usuário que identifica um acesso. Como o usuário é opcional,
 * duas bases na mesma URL e sem usuário também são o mesmo acesso.
 */
export class AcessoDeBaseDuplicadoError extends Error {
  constructor(url: string, usuario: string) {
    super(
      usuario === ''
        ? `Este cliente já tem uma base com a URL "${url}" e sem usuário informado.`
        : `Este cliente já tem uma base com a URL "${url}" e o usuário "${usuario}".`,
    );
    this.name = 'AcessoDeBaseDuplicadoError';
  }
}

/**
 * O trio nome do cliente + URL + tipo identifica a base na importação: é o que
 * distingue "Diniz produção" de "Diniz teste" sem depender de usuário e senha,
 * que só são digitados na última etapa.
 */
export class BaseJaCadastradaError extends Error {
  constructor(nomeDoCliente: string, url: string, tipo: TipoDeBase) {
    super(`O cliente "${nomeDoCliente}" já tem a base "${url}" do tipo "${tipo}".`);
    this.name = 'BaseJaCadastradaError';
  }
}

export class FavoritoDuplicadoNaImportacaoError extends Error {
  constructor(nomeDoCliente: string, url: string, tipo: TipoDeBase) {
    super(
      `A importação repete a base "${url}" do tipo "${tipo}" para o cliente "${nomeDoCliente}".`,
    );
    this.name = 'FavoritoDuplicadoNaImportacaoError';
  }
}

export class RepositorioNaoEncontradoError extends Error {
  constructor(id: string) {
    super(`Repositório não encontrado: ${id}`);
    this.name = 'RepositorioNaoEncontradoError';
  }
}

export class UrlDeRepositorioDuplicadaError extends Error {
  constructor(url: string) {
    super(`Este cliente já tem o repositório "${url}".`);
    this.name = 'UrlDeRepositorioDuplicadaError';
  }
}

/**
 * O par nome do cliente + URL identifica o repositório na importação: é o mesmo
 * critério de `UrlDeRepositorioDuplicadaError`, aplicado antes de gravar.
 */
export class RepositorioDuplicadoNaImportacaoError extends Error {
  constructor(nomeDoCliente: string, url: string) {
    super(`A importação repete o repositório "${url}" para o cliente "${nomeDoCliente}".`);
    this.name = 'RepositorioDuplicadoNaImportacaoError';
  }
}

export class LinkNaoEncontradoError extends Error {
  constructor(id: string) {
    super(`Link não encontrado: ${id}`);
    this.name = 'LinkNaoEncontradoError';
  }
}

export class UrlDeLinkDuplicadaError extends Error {
  constructor(url: string) {
    super(`Este cliente já tem o link "${url}".`);
    this.name = 'UrlDeLinkDuplicadaError';
  }
}
