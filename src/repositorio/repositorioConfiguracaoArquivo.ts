import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  DESTINOS_DE_LINK,
  type Atalho,
  type ConfiguracaoGlobal,
  type DestinoDeLink,
} from '../tipos.ts';
import {
  gravarArquivoDeDados,
  lerArquivoDeDados,
  migrarArquivoDeDados,
  precisaMigrar,
} from './arquivoDeDados.ts';
import type {
  ConfiguracaoParaSalvar,
  DadosDeAtalho,
  RepositorioConfiguracao,
} from './repositorioConfiguracao.ts';

const NOME_DO_ARQUIVO = 'configuracao.json';
const CHAVE_DO_CORPO = 'configuracao';
const INTERVALO_DE_EXECUCAO_AUTOMATICA_PADRAO_S = 30;
const TEMPO_LIMITE_PADRAO_S = 5;
const MILISSEGUNDOS_POR_SEGUNDO = 1000;

const DESTINO_DOS_LINKS_PADRAO: DestinoDeLink = 'hub';

const CONFIGURACAO_INICIAL: ConfiguracaoGlobal = {
  scriptPadrao: '',
  intervaloDeExecucaoAutomaticaSegundos: INTERVALO_DE_EXECUCAO_AUTOMATICA_PADRAO_S,
  tempoLimiteSegundos: TEMPO_LIMITE_PADRAO_S,
  caminhoDoSchemaMcp: '',
  atalhos: [],
  destinoDosLinks: DESTINO_DOS_LINKS_PADRAO,
  caminhoDoExecutavelDaIde: '',
  experiencePersonId: '',
  sankhyaOmCodUsu: '',
};

/**
 * Nomes usados por versões anteriores do arquivo. O intervalo só foi
 * renomeado; o tempo limite, além de renomeado, era gravado em milissegundos.
 */
interface ConfiguracaoAnterior {
  intervaloDeAtualizacaoDoStatusDoBancoSegundos?: number;
  tempoLimiteDeStatusDaBaseMs?: number;
}

function lerTempoLimiteSegundos(dados: Partial<ConfiguracaoGlobal> & ConfiguracaoAnterior): number {
  if (dados.tempoLimiteSegundos !== undefined) {
    return dados.tempoLimiteSegundos;
  }

  if (dados.tempoLimiteDeStatusDaBaseMs !== undefined) {
    return Math.max(1, Math.round(dados.tempoLimiteDeStatusDaBaseMs / MILISSEGUNDOS_POR_SEGUNDO));
  }

  return TEMPO_LIMITE_PADRAO_S;
}

function ehDestinoDeLink(valor: unknown): valor is DestinoDeLink {
  return (DESTINOS_DE_LINK as readonly unknown[]).includes(valor);
}

/** Arquivo de antes desta versão não tem a chave, e um valor editado à mão inválido volta ao padrão. */
function lerDestinoDosLinks(valor: unknown): DestinoDeLink {
  return ehDestinoDeLink(valor) ? valor : DESTINO_DOS_LINKS_PADRAO;
}

/** Atalho recém-cadastrado chega sem id: é aqui que ele ganha um. */
function normalizarAtalho(atalho: DadosDeAtalho): Atalho {
  return {
    id: atalho.id ?? randomUUID(),
    nome: atalho.nome.trim(),
    caminhoDoExecutavel: atalho.caminhoDoExecutavel.trim(),
  };
}

/**
 * Configuração global num arquivo JSON próprio, com a mesma escrita atômica
 * usada no cadastro de clientes.
 */
export class RepositorioConfiguracaoArquivo implements RepositorioConfiguracao {
  readonly #caminhoDoArquivo: string;
  #configuracao: ConfiguracaoGlobal | null = null;

  constructor(diretorioDeDados: string) {
    this.#caminhoDoArquivo = join(diretorioDeDados, NOME_DO_ARQUIVO);
  }

  descartarCache(): void {
    this.#configuracao = null;
  }

  async ler(): Promise<ConfiguracaoGlobal> {
    if (this.#configuracao) {
      return this.#configuracao;
    }

    const conteudo = await lerArquivoDeDados(this.#caminhoDoArquivo, CHAVE_DO_CORPO);
    if (conteudo === null) {
      this.#configuracao = { ...CONFIGURACAO_INICIAL };
      return this.#configuracao;
    }

    const dados = (conteudo.corpo ?? {}) as Partial<ConfiguracaoGlobal> & ConfiguracaoAnterior;
    this.#configuracao = {
      scriptPadrao: dados.scriptPadrao ?? '',
      // Arquivo de antes desta versão traz o campo com o nome antigo, ou nenhum dos dois.
      intervaloDeExecucaoAutomaticaSegundos:
        dados.intervaloDeExecucaoAutomaticaSegundos ??
        dados.intervaloDeAtualizacaoDoStatusDoBancoSegundos ??
        INTERVALO_DE_EXECUCAO_AUTOMATICA_PADRAO_S,
      tempoLimiteSegundos: lerTempoLimiteSegundos(dados),
      // Arquivo de antes desta versão não tem o campo: nasce desligado.
      caminhoDoSchemaMcp: dados.caminhoDoSchemaMcp ?? '',
      // Idem: sem a chave no arquivo, o HUB SNK começa sem atalho nenhum.
      atalhos: dados.atalhos ?? [],
      destinoDosLinks: lerDestinoDosLinks(dados.destinoDosLinks),
      // Idem: arquivo de antes desta versão não tem IDE escolhida.
      caminhoDoExecutavelDaIde: dados.caminhoDoExecutavelDaIde ?? '',
      // Idem: arquivo de antes desta versão não tem o vínculo com a Experience.
      experiencePersonId: dados.experiencePersonId ?? '',
      // Idem: arquivo de antes desta versão não tem o CODUSU do Sankhya OM.
      sankhyaOmCodUsu: dados.sankhyaOmCodUsu ?? '',
    };

    if (precisaMigrar(conteudo)) {
      await migrarArquivoDeDados({
        caminhoDoArquivo: this.#caminhoDoArquivo,
        chaveDoCorpo: CHAVE_DO_CORPO,
        corpo: this.#configuracao,
        versaoDeOrigem: conteudo.versaoDeOrigem,
      });
    }

    return this.#configuracao;
  }

  async salvar(configuracao: ConfiguracaoParaSalvar): Promise<ConfiguracaoGlobal> {
    // Sem campo na tela: preserva o que já estava gravado, em vez de apagar com ''.
    const { experiencePersonId } = await this.ler();

    const normalizada: ConfiguracaoGlobal = {
      scriptPadrao: configuracao.scriptPadrao.trim(),
      intervaloDeExecucaoAutomaticaSegundos: configuracao.intervaloDeExecucaoAutomaticaSegundos,
      tempoLimiteSegundos: configuracao.tempoLimiteSegundos,
      caminhoDoSchemaMcp: configuracao.caminhoDoSchemaMcp.trim(),
      atalhos: configuracao.atalhos.map(normalizarAtalho),
      destinoDosLinks: configuracao.destinoDosLinks,
      caminhoDoExecutavelDaIde: configuracao.caminhoDoExecutavelDaIde.trim(),
      experiencePersonId,
      sankhyaOmCodUsu: configuracao.sankhyaOmCodUsu.trim(),
    };

    await gravarArquivoDeDados(this.#caminhoDoArquivo, CHAVE_DO_CORPO, normalizada);

    this.#configuracao = normalizada;
    return normalizada;
  }

  async definirExperiencePersonId(personId: string): Promise<ConfiguracaoGlobal> {
    const atual = await this.ler();
    const normalizada: ConfiguracaoGlobal = { ...atual, experiencePersonId: personId.trim() };

    await gravarArquivoDeDados(this.#caminhoDoArquivo, CHAVE_DO_CORPO, normalizada);

    this.#configuracao = normalizada;
    return normalizada;
  }
}
