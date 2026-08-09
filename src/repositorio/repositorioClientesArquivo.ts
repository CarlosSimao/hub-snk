import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { BancoDeDados, Base, Cliente, LinkDoCliente, RepositorioGit } from '../tipos.ts';
import {
  ArquivoDeDadosInvalidoError,
  gravarArquivoDeDados,
  lerArquivoDeDados,
  migrarArquivoDeDados,
  precisaMigrar,
} from './arquivoDeDados.ts';
import {
  AcessoDeBaseDuplicadoError,
  BaseJaCadastradaError,
  BaseNaoEncontradaError,
  ClienteNaoEncontradoError,
  FavoritoDuplicadoNaImportacaoError,
  LinkNaoEncontradoError,
  NomeDeClienteDuplicadoError,
  RepositorioDuplicadoNaImportacaoError,
  RepositorioNaoEncontradoError,
  UrlDeLinkDuplicadaError,
  UrlDeRepositorioDuplicadaError,
  type DadosDeBancoDeDados,
  type DadosDeBase,
  type DadosDeCliente,
  type DadosDeImportacaoDeBase,
  type DadosDeImportacaoDeRepositorio,
  type DadosDeLink,
  type DadosDeRepositorio,
  type RepositorioClientes,
  type ResultadoDaImportacao,
  type ResultadoDaImportacaoDeRepositorios,
} from './repositorioClientes.ts';

const NOME_DO_ARQUIVO = 'clientes.json';
const CHAVE_DO_CORPO = 'clientes';

function normalizarParaComparacao(valor: string): string {
  return valor.trim().toLocaleLowerCase('pt-BR');
}

const DIACRITICOS = /\p{Diacritic}/gu;
const FORA_DE_LETRA_OU_DIGITO = /[^\p{L}\p{N}]+/gu;

/**
 * Só letras e dígitos, minúsculos e sem acento.
 *
 * "NecoTruck", "necotruck" e "Neco Truck" viram a mesma chave — é o que permite
 * a importação reconhecer o cliente já cadastrado escrito de outro jeito.
 */
function chaveAchatadaDeNome(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(DIACRITICOS, '')
    .toLocaleLowerCase('pt-BR')
    .replace(FORA_DE_LETRA_OU_DIGITO, '');
}

/** Nome de exibição para repositórios gravados antes do campo `nome` existir. */
function nomeDerivadoDaUrl(url: string): string {
  try {
    const caminho = new URL(url).pathname.replace(/\.git$/, '');
    return caminho.split('/').filter(Boolean).pop() ?? url;
  } catch {
    return url;
  }
}

/**
 * Persistência dos clientes em um único arquivo JSON no disco local.
 *
 * A escrita é atômica (arquivo temporário + rename) para que uma queda no meio
 * da gravação não deixe o arquivo corrompido, e as operações são serializadas
 * em fila para evitar que requisições concorrentes sobrescrevam umas às outras.
 */
export class RepositorioClientesArquivo implements RepositorioClientes {
  readonly #caminhoDoArquivo: string;
  #clientes: Cliente[] | null = null;
  #ultimaOperacao: Promise<unknown> = Promise.resolve();

  constructor(diretorioDeDados: string) {
    this.#caminhoDoArquivo = join(diretorioDeDados, NOME_DO_ARQUIVO);
  }

  descartarCache(): void {
    this.#clientes = null;
  }

  async listar(): Promise<Cliente[]> {
    return this.#enfileirar(async () => {
      const clientes = await this.#carregar();
      return [...clientes].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    });
  }

  async buscarPorId(id: string): Promise<Cliente | undefined> {
    return this.#enfileirar(async () => {
      const clientes = await this.#carregar();
      return clientes.find((cliente) => cliente.id === id);
    });
  }

  async criar(dados: DadosDeCliente): Promise<Cliente> {
    return this.#enfileirar(async () => {
      const clientes = await this.#carregar();
      this.#garantirNomeDisponivel(clientes, dados.nome);

      const agora = new Date().toISOString();
      const novoCliente: Cliente = {
        id: randomUUID(),
        nome: dados.nome.trim(),
        anotacoes: '',
        bases: [],
        repositorios: [],
        links: [],
        criadoEm: agora,
        atualizadoEm: agora,
      };

      await this.#persistir([...clientes, novoCliente]);
      return novoCliente;
    });
  }

  async atualizar(id: string, dados: DadosDeCliente): Promise<Cliente> {
    return this.#enfileirar(async () => {
      const clientes = await this.#carregar();
      const cliente = this.#obterCliente(clientes, id);
      this.#garantirNomeDisponivel(clientes, dados.nome, id);

      return this.#substituirCliente(clientes, { ...cliente, nome: dados.nome.trim() });
    });
  }

  async definirAnotacoes(id: string, anotacoes: string): Promise<Cliente> {
    return this.#enfileirar(async () => {
      const clientes = await this.#carregar();
      const cliente = this.#obterCliente(clientes, id);

      return this.#substituirCliente(clientes, { ...cliente, anotacoes });
    });
  }

  async remover(id: string): Promise<void> {
    await this.#enfileirar(async () => {
      const clientes = await this.#carregar();
      const restantes = clientes.filter((cliente) => cliente.id !== id);
      if (restantes.length === clientes.length) {
        throw new ClienteNaoEncontradoError(id);
      }

      await this.#persistir(restantes);
    });
  }

  async adicionarBase(idDoCliente: string, dados: DadosDeBase): Promise<Base> {
    return this.#enfileirar(async () => {
      const clientes = await this.#carregar();
      const cliente = this.#obterCliente(clientes, idDoCliente);
      this.#garantirAcessoDisponivel(cliente, dados);

      const novaBase: Base = { id: randomUUID(), ...this.#normalizarDadosDeBase(dados) };
      await this.#substituirCliente(clientes, { ...cliente, bases: [...cliente.bases, novaBase] });
      return novaBase;
    });
  }

  async importarBases(itens: DadosDeImportacaoDeBase[]): Promise<ResultadoDaImportacao> {
    return this.#enfileirar(async () => {
      const clientes = await this.#carregar();
      this.#garantirImportacaoSemRepeticao(itens);

      const agora = new Date().toISOString();
      let atualizados = [...clientes];
      let clientesCriados = 0;

      for (const item of itens) {
        const resolucao = this.#obterOuCriarClientePorNome(
          atualizados,
          item.nomeDoCliente.trim(),
          agora,
        );
        const cliente = resolucao.cliente;
        atualizados = resolucao.clientes;
        clientesCriados += resolucao.criado ? 1 : 0;

        this.#garantirBaseNaoCadastrada(cliente, item);
        this.#garantirAcessoDisponivel(cliente, item);

        const novaBase: Base = { id: randomUUID(), ...this.#normalizarDadosDeBase(item) };
        const clienteComABase: Cliente = {
          ...cliente,
          bases: [...cliente.bases, novaBase],
          atualizadoEm: agora,
        };
        atualizados = atualizados.map((candidato) =>
          candidato.id === clienteComABase.id ? clienteComABase : candidato,
        );
      }

      await this.#persistir(atualizados);
      return { clientesCriados, basesImportadas: itens.length };
    });
  }

  async atualizarBase(idDoCliente: string, idDaBase: string, dados: DadosDeBase): Promise<Base> {
    return this.#enfileirar(async () => {
      const clientes = await this.#carregar();
      const cliente = this.#obterCliente(clientes, idDoCliente);

      const posicao = this.#obterPosicaoDaBase(cliente, idDaBase);
      this.#garantirAcessoDisponivel(cliente, dados, idDaBase);

      // O banco vinculado não vem no formulário da base: preservá-lo é explícito.
      const baseAtual = cliente.bases[posicao] as Base;
      const baseAtualizada: Base = {
        id: idDaBase,
        ...this.#normalizarDadosDeBase(dados),
        ...(baseAtual.bancoDeDados ? { bancoDeDados: baseAtual.bancoDeDados } : {}),
      };

      const bases = [...cliente.bases];
      bases[posicao] = baseAtualizada;

      await this.#substituirCliente(clientes, { ...cliente, bases });
      return baseAtualizada;
    });
  }

  async removerBase(idDoCliente: string, idDaBase: string): Promise<void> {
    await this.#enfileirar(async () => {
      const clientes = await this.#carregar();
      const cliente = this.#obterCliente(clientes, idDoCliente);

      const restantes = cliente.bases.filter((base) => base.id !== idDaBase);
      if (restantes.length === cliente.bases.length) {
        throw new BaseNaoEncontradaError(idDaBase);
      }

      await this.#substituirCliente(clientes, { ...cliente, bases: restantes });
    });
  }

  async definirBancoDeDados(
    idDoCliente: string,
    idDaBase: string,
    dados: DadosDeBancoDeDados,
  ): Promise<BancoDeDados> {
    return this.#enfileirar(async () => {
      const clientes = await this.#carregar();
      const cliente = this.#obterCliente(clientes, idDoCliente);
      const posicao = this.#obterPosicaoDaBase(cliente, idDaBase);

      const bancoDeDados: BancoDeDados = {
        host: dados.host.trim(),
        porta: dados.porta,
        nomeDoServico: dados.nomeDoServico.trim(),
        usuario: dados.usuario.trim(),
        senha: dados.senha,
      };

      const bases = [...cliente.bases];
      bases[posicao] = { ...(bases[posicao] as Base), bancoDeDados };

      await this.#substituirCliente(clientes, { ...cliente, bases });
      return bancoDeDados;
    });
  }

  async removerBancoDeDados(idDoCliente: string, idDaBase: string): Promise<void> {
    await this.#enfileirar(async () => {
      const clientes = await this.#carregar();
      const cliente = this.#obterCliente(clientes, idDoCliente);
      const posicao = this.#obterPosicaoDaBase(cliente, idDaBase);

      const { bancoDeDados: _bancoRemovido, ...baseSemBanco } = cliente.bases[posicao] as Base;
      const bases = [...cliente.bases];
      bases[posicao] = baseSemBanco;

      await this.#substituirCliente(clientes, { ...cliente, bases });
    });
  }

  async adicionarRepositorio(
    idDoCliente: string,
    dados: DadosDeRepositorio,
  ): Promise<RepositorioGit> {
    return this.#enfileirar(async () => {
      const clientes = await this.#carregar();
      const cliente = this.#obterCliente(clientes, idDoCliente);
      this.#garantirRepositorioDisponivel(cliente, dados.url);

      const novoRepositorio: RepositorioGit = {
        id: randomUUID(),
        ...this.#normalizarDadosDeRepositorio(dados),
      };
      await this.#substituirCliente(clientes, {
        ...cliente,
        repositorios: [...cliente.repositorios, novoRepositorio],
      });
      return novoRepositorio;
    });
  }

  async importarRepositorios(
    itens: DadosDeImportacaoDeRepositorio[],
  ): Promise<ResultadoDaImportacaoDeRepositorios> {
    return this.#enfileirar(async () => {
      const clientes = await this.#carregar();
      this.#garantirImportacaoDeRepositoriosSemRepeticao(itens);

      const agora = new Date().toISOString();
      let atualizados = [...clientes];
      let clientesCriados = 0;

      for (const item of itens) {
        const resolucao = this.#obterOuCriarClientePorNome(
          atualizados,
          item.nomeDoCliente.trim(),
          agora,
        );
        const cliente = resolucao.cliente;
        atualizados = resolucao.clientes;
        clientesCriados += resolucao.criado ? 1 : 0;

        this.#garantirRepositorioDisponivel(cliente, item.url);

        const novoRepositorio: RepositorioGit = {
          id: randomUUID(),
          ...this.#normalizarDadosDeRepositorio(item),
        };
        const clienteComORepositorio: Cliente = {
          ...cliente,
          repositorios: [...cliente.repositorios, novoRepositorio],
          atualizadoEm: agora,
        };
        atualizados = atualizados.map((candidato) =>
          candidato.id === clienteComORepositorio.id ? clienteComORepositorio : candidato,
        );
      }

      await this.#persistir(atualizados);
      return { clientesCriados, repositoriosImportados: itens.length };
    });
  }

  async atualizarRepositorio(
    idDoCliente: string,
    idDoRepositorio: string,
    dados: DadosDeRepositorio,
  ): Promise<RepositorioGit> {
    return this.#enfileirar(async () => {
      const clientes = await this.#carregar();
      const cliente = this.#obterCliente(clientes, idDoCliente);

      const posicao = cliente.repositorios.findIndex(
        (repositorio) => repositorio.id === idDoRepositorio,
      );
      if (posicao === -1) {
        throw new RepositorioNaoEncontradoError(idDoRepositorio);
      }

      this.#garantirRepositorioDisponivel(cliente, dados.url, idDoRepositorio);

      const repositorioAtualizado: RepositorioGit = {
        id: idDoRepositorio,
        ...this.#normalizarDadosDeRepositorio(dados),
      };
      const repositorios = [...cliente.repositorios];
      repositorios[posicao] = repositorioAtualizado;

      await this.#substituirCliente(clientes, { ...cliente, repositorios });
      return repositorioAtualizado;
    });
  }

  async removerRepositorio(idDoCliente: string, idDoRepositorio: string): Promise<void> {
    await this.#enfileirar(async () => {
      const clientes = await this.#carregar();
      const cliente = this.#obterCliente(clientes, idDoCliente);

      const restantes = cliente.repositorios.filter(
        (repositorio) => repositorio.id !== idDoRepositorio,
      );
      if (restantes.length === cliente.repositorios.length) {
        throw new RepositorioNaoEncontradoError(idDoRepositorio);
      }

      await this.#substituirCliente(clientes, { ...cliente, repositorios: restantes });
    });
  }

  async adicionarLink(idDoCliente: string, dados: DadosDeLink): Promise<LinkDoCliente> {
    return this.#enfileirar(async () => {
      const clientes = await this.#carregar();
      const cliente = this.#obterCliente(clientes, idDoCliente);
      this.#garantirLinkDisponivel(cliente, dados.url);

      const novoLink: LinkDoCliente = { id: randomUUID(), ...this.#normalizarDadosDeLink(dados) };
      await this.#substituirCliente(clientes, {
        ...cliente,
        links: [...cliente.links, novoLink],
      });
      return novoLink;
    });
  }

  async atualizarLink(
    idDoCliente: string,
    idDoLink: string,
    dados: DadosDeLink,
  ): Promise<LinkDoCliente> {
    return this.#enfileirar(async () => {
      const clientes = await this.#carregar();
      const cliente = this.#obterCliente(clientes, idDoCliente);

      const posicao = cliente.links.findIndex((link) => link.id === idDoLink);
      if (posicao === -1) {
        throw new LinkNaoEncontradoError(idDoLink);
      }

      this.#garantirLinkDisponivel(cliente, dados.url, idDoLink);

      const linkAtualizado: LinkDoCliente = {
        id: idDoLink,
        ...this.#normalizarDadosDeLink(dados),
      };
      const links = [...cliente.links];
      links[posicao] = linkAtualizado;

      await this.#substituirCliente(clientes, { ...cliente, links });
      return linkAtualizado;
    });
  }

  async removerLink(idDoCliente: string, idDoLink: string): Promise<void> {
    await this.#enfileirar(async () => {
      const clientes = await this.#carregar();
      const cliente = this.#obterCliente(clientes, idDoCliente);

      const restantes = cliente.links.filter((link) => link.id !== idDoLink);
      if (restantes.length === cliente.links.length) {
        throw new LinkNaoEncontradoError(idDoLink);
      }

      await this.#substituirCliente(clientes, { ...cliente, links: restantes });
    });
  }

  #obterPosicaoDaBase(cliente: Cliente, idDaBase: string): number {
    const posicao = cliente.bases.findIndex((base) => base.id === idDaBase);
    if (posicao === -1) {
      throw new BaseNaoEncontradaError(idDaBase);
    }
    return posicao;
  }

  #obterCliente(clientes: Cliente[], id: string): Cliente {
    const cliente = clientes.find((candidato) => candidato.id === id);
    if (!cliente) {
      throw new ClienteNaoEncontradoError(id);
    }
    return cliente;
  }

  /** Caminho local em branco não vira string vazia: some do arquivo. */
  #normalizarDadosDeRepositorio(dados: DadosDeRepositorio): DadosDeRepositorio {
    const caminhoLocal = dados.caminhoLocal?.trim();

    return {
      nome: dados.nome.trim(),
      url: dados.url.trim(),
      ...(caminhoLocal ? { caminhoLocal } : {}),
    };
  }

  #normalizarDadosDeLink(dados: DadosDeLink): DadosDeLink {
    return {
      nome: dados.nome.trim(),
      url: dados.url.trim(),
    };
  }

  #normalizarDadosDeBase(dados: DadosDeBase): DadosDeBase {
    return {
      url: dados.url.trim(),
      tipo: dados.tipo,
      usuario: dados.usuario.trim(),
      senha: dados.senha,
    };
  }

  /** Grava o cliente com `atualizadoEm` renovado e devolve a versão persistida. */
  async #substituirCliente(clientes: Cliente[], cliente: Cliente): Promise<Cliente> {
    const clienteAtualizado: Cliente = { ...cliente, atualizadoEm: new Date().toISOString() };
    const atualizados = clientes.map((candidato) =>
      candidato.id === cliente.id ? clienteAtualizado : candidato,
    );

    await this.#persistir(atualizados);
    return clienteAtualizado;
  }

  #garantirNomeDisponivel(clientes: Cliente[], nome: string, idIgnorado?: string): void {
    const alvo = normalizarParaComparacao(nome);
    const conflito = clientes.some(
      (cliente) => cliente.id !== idIgnorado && normalizarParaComparacao(cliente.nome) === alvo,
    );

    if (conflito) {
      throw new NomeDeClienteDuplicadoError(nome.trim());
    }
  }

  #garantirAcessoDisponivel(cliente: Cliente, dados: DadosDeBase, idIgnorado?: string): void {
    const urlAlvo = normalizarParaComparacao(dados.url);
    const usuarioAlvo = normalizarParaComparacao(dados.usuario);

    const conflito = cliente.bases.some(
      (base) =>
        base.id !== idIgnorado &&
        normalizarParaComparacao(base.url) === urlAlvo &&
        normalizarParaComparacao(base.usuario) === usuarioAlvo,
    );

    if (conflito) {
      throw new AcessoDeBaseDuplicadoError(dados.url.trim(), dados.usuario.trim());
    }
  }

  /**
   * Cliente de mesmo nome, tolerando caixa, acento e separador.
   *
   * A igualdade exata vem primeiro; só se ela falhar entra o casamento pela
   * chave achatada, e apenas quando um único cadastro cai nela — dois
   * candidatos seria escolha arbitrária, e aí é melhor tratar como nome novo.
   */
  #encontrarClientePorNome(clientes: Cliente[], nome: string): Cliente | undefined {
    const alvo = normalizarParaComparacao(nome);
    const exato = clientes.find((cliente) => normalizarParaComparacao(cliente.nome) === alvo);
    if (exato) {
      return exato;
    }

    const chaveAlvo = chaveAchatadaDeNome(nome);
    if (!chaveAlvo) {
      return undefined;
    }

    const equivalentes = clientes.filter(
      (cliente) => chaveAchatadaDeNome(cliente.nome) === chaveAlvo,
    );
    return equivalentes.length === 1 ? equivalentes[0] : undefined;
  }

  /**
   * Resolve o cliente de um item de importação pelo nome: reaproveita o cadastro
   * existente ou devolve a lista acrescida de um cliente novo.
   *
   * Nada é gravado aqui — quem chama é responsável por persistir a lista
   * devolvida, para que o lote continue sendo tudo ou nada.
   */
  #obterOuCriarClientePorNome(
    clientes: Cliente[],
    nome: string,
    agora: string,
  ): { clientes: Cliente[]; cliente: Cliente; criado: boolean } {
    const existente = this.#encontrarClientePorNome(clientes, nome);
    if (existente) {
      return { clientes, cliente: existente, criado: false };
    }

    const cliente: Cliente = {
      id: randomUUID(),
      nome,
      anotacoes: '',
      bases: [],
      repositorios: [],
      links: [],
      criadoEm: agora,
      atualizadoEm: agora,
    };
    return { clientes: [...clientes, cliente], cliente, criado: true };
  }

  #garantirBaseNaoCadastrada(cliente: Cliente, item: DadosDeImportacaoDeBase): void {
    const urlAlvo = normalizarParaComparacao(item.url);
    const conflito = cliente.bases.some(
      (base) => normalizarParaComparacao(base.url) === urlAlvo && base.tipo === item.tipo,
    );

    if (conflito) {
      throw new BaseJaCadastradaError(cliente.nome, item.url.trim(), item.tipo);
    }
  }

  #garantirImportacaoSemRepeticao(itens: DadosDeImportacaoDeBase[]): void {
    const vistos = new Set<string>();

    for (const item of itens) {
      const chave = [
        normalizarParaComparacao(item.nomeDoCliente),
        normalizarParaComparacao(item.url),
        item.tipo,
      ].join('|');

      if (vistos.has(chave)) {
        throw new FavoritoDuplicadoNaImportacaoError(
          item.nomeDoCliente.trim(),
          item.url.trim(),
          item.tipo,
        );
      }

      vistos.add(chave);
    }
  }

  #garantirImportacaoDeRepositoriosSemRepeticao(itens: DadosDeImportacaoDeRepositorio[]): void {
    const vistos = new Set<string>();

    for (const item of itens) {
      const chave = [
        normalizarParaComparacao(item.nomeDoCliente),
        normalizarParaComparacao(item.url),
      ].join('|');

      if (vistos.has(chave)) {
        throw new RepositorioDuplicadoNaImportacaoError(
          item.nomeDoCliente.trim(),
          item.url.trim(),
        );
      }

      vistos.add(chave);
    }
  }

  #garantirRepositorioDisponivel(cliente: Cliente, url: string, idIgnorado?: string): void {
    const alvo = normalizarParaComparacao(url);
    const conflito = cliente.repositorios.some(
      (repositorio) =>
        repositorio.id !== idIgnorado && normalizarParaComparacao(repositorio.url) === alvo,
    );

    if (conflito) {
      throw new UrlDeRepositorioDuplicadaError(url.trim());
    }
  }

  #garantirLinkDisponivel(cliente: Cliente, url: string, idIgnorado?: string): void {
    const alvo = normalizarParaComparacao(url);
    const conflito = cliente.links.some(
      (link) => link.id !== idIgnorado && normalizarParaComparacao(link.url) === alvo,
    );

    if (conflito) {
      throw new UrlDeLinkDuplicadaError(url.trim());
    }
  }

  /**
   * Serializa as operações: cada chamada só começa depois que a anterior
   * terminou, com sucesso ou erro.
   */
  #enfileirar<T>(tarefa: () => Promise<T>): Promise<T> {
    const resultado = this.#ultimaOperacao.then(tarefa, tarefa);
    this.#ultimaOperacao = resultado.catch(() => undefined);
    return resultado;
  }

  async #carregar(): Promise<Cliente[]> {
    if (this.#clientes) {
      return this.#clientes;
    }

    const conteudo = await lerArquivoDeDados(this.#caminhoDoArquivo, CHAVE_DO_CORPO);
    if (conteudo === null) {
      this.#clientes = [];
      return this.#clientes;
    }

    if (!Array.isArray(conteudo.corpo)) {
      throw new ArquivoDeDadosInvalidoError(
        this.#caminhoDoArquivo,
        `esperado um array de clientes em "${CHAVE_DO_CORPO}"`,
      );
    }

    // Clientes gravados antes de anotações, bases, repositórios e links existirem não têm os campos.
    this.#clientes = (conteudo.corpo as Cliente[]).map((cliente) => ({
      ...cliente,
      anotacoes: cliente.anotacoes ?? '',
      bases: cliente.bases ?? [],
      repositorios: (cliente.repositorios ?? []).map((repositorio) => ({
        ...repositorio,
        nome: repositorio.nome ?? nomeDerivadoDaUrl(repositorio.url),
      })),
      links: cliente.links ?? [],
    }));

    if (precisaMigrar(conteudo)) {
      await migrarArquivoDeDados({
        caminhoDoArquivo: this.#caminhoDoArquivo,
        chaveDoCorpo: CHAVE_DO_CORPO,
        corpo: this.#clientes,
        versaoDeOrigem: conteudo.versaoDeOrigem,
      });
    }

    return this.#clientes;
  }

  async #persistir(clientes: Cliente[]): Promise<void> {
    await gravarArquivoDeDados(this.#caminhoDoArquivo, CHAVE_DO_CORPO, clientes);
    this.#clientes = clientes;
  }
}
