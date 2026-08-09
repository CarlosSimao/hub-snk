import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Atalho, ConfiguracaoGlobal } from '../tipos.ts';
import type {
  ConfiguracaoParaSalvar,
  DadosDeAtalho,
  RepositorioConfiguracao,
} from './repositorioConfiguracao.ts';

const NOME_DO_ARQUIVO = 'configuracao.json';
const IDENTACAO_JSON = 2;
const INTERVALO_DE_EXECUCAO_AUTOMATICA_PADRAO_S = 30;
const TEMPO_LIMITE_PADRAO_S = 5;
const MILISSEGUNDOS_POR_SEGUNDO = 1000;

const CONFIGURACAO_INICIAL: ConfiguracaoGlobal = {
  scriptPadrao: '',
  intervaloDeExecucaoAutomaticaSegundos: INTERVALO_DE_EXECUCAO_AUTOMATICA_PADRAO_S,
  tempoLimiteSegundos: TEMPO_LIMITE_PADRAO_S,
  caminhoDoSchemaMcp: '',
  atalhos: [],
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

    let conteudo: string;
    try {
      conteudo = await readFile(this.#caminhoDoArquivo, 'utf8');
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === 'ENOENT') {
        this.#configuracao = { ...CONFIGURACAO_INICIAL };
        return this.#configuracao;
      }
      throw erro;
    }

    const dados = JSON.parse(conteudo) as Partial<ConfiguracaoGlobal> & ConfiguracaoAnterior;
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
    };
    return this.#configuracao;
  }

  async salvar(configuracao: ConfiguracaoParaSalvar): Promise<ConfiguracaoGlobal> {
    const normalizada: ConfiguracaoGlobal = {
      scriptPadrao: configuracao.scriptPadrao.trim(),
      intervaloDeExecucaoAutomaticaSegundos: configuracao.intervaloDeExecucaoAutomaticaSegundos,
      tempoLimiteSegundos: configuracao.tempoLimiteSegundos,
      caminhoDoSchemaMcp: configuracao.caminhoDoSchemaMcp.trim(),
      atalhos: configuracao.atalhos.map(normalizarAtalho),
    };

    await mkdir(dirname(this.#caminhoDoArquivo), { recursive: true });

    const caminhoTemporario = `${this.#caminhoDoArquivo}.tmp`;
    await writeFile(
      caminhoTemporario,
      JSON.stringify(normalizada, null, IDENTACAO_JSON),
      'utf8',
    );
    await rename(caminhoTemporario, this.#caminhoDoArquivo);

    this.#configuracao = normalizada;
    return normalizada;
  }
}
