import type { RepositorioParaVerificar } from '../git/cacheDeSituacao.ts';
import type { RepositorioParaConsultar } from '../git/consultaDoRemoto.ts';
import type { RepositorioClientes } from '../repositorio/repositorioClientes.ts';
import type { RepositorioConfiguracao } from '../repositorio/repositorioConfiguracao.ts';
import type { Cliente, ConfiguracaoGlobal, RepositorioGit, SituacaoGit } from '../tipos.ts';
import type { DadosDeNotificacao, RegistradorDeNotificacoes } from './centralDeNotificacoes.ts';

/**
 * A cada 30 minutos, consulta o remoto (`git fetch`) dos repositórios que estão na branch
 * principal e avisa quando ela ficou atrás do remoto ou divergiu dele.
 *
 * A chave da notificação traz o código e a distância (a mensagem da pendência a contém):
 * o aviso sai uma vez por mudança de estado, e não a cada 30 minutos enquanto nada muda.
 */

const INTERVALO_ENTRE_CONSULTAS_MS = 30 * 60_000;
/* Sem o primeiro fetch o `-M` do status é velho e o cartão não mostra atraso nenhum. */
const ATRASO_DA_PRIMEIRA_CONSULTA_MS = 2 * 60_000;

const TITULOS_POR_CODIGO: Record<string, string> = {
  'branch-principal-atras': 'Branch principal atrás do remoto',
  'branch-principal-atras-com-alteracoes':
    'Branch principal atrás do remoto, com alterações locais',
  'branch-principal-divergente': 'Branch principal divergiu do remoto',
};

export interface DependenciasDoVerificadorDeSincroniaGit {
  clientes: Pick<RepositorioClientes, 'listar'>;
  configuracao: Pick<RepositorioConfiguracao, 'ler'>;
  consultarRemotos(
    repositorios: RepositorioParaConsultar[],
    tempoLimiteSegundos: number,
  ): Promise<void>;
  coletarSituacoes(
    repositorios: RepositorioParaVerificar[],
    configuracao: ConfiguracaoGlobal,
    forcar: boolean,
  ): Promise<Record<string, SituacaoGit>>;
  emitir(dados: DadosDeNotificacao): Promise<unknown>;
  registrador: RegistradorDeNotificacoes;
}

function descreverErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

interface RepositorioDoCliente {
  cliente: Cliente;
  repositorio: RepositorioGit;
}

export class VerificadorDeSincroniaGit {
  readonly #dependencias: DependenciasDoVerificadorDeSincroniaGit;
  #primeiraConsulta: NodeJS.Timeout | null = null;
  #intervalo: NodeJS.Timeout | null = null;

  constructor(dependencias: DependenciasDoVerificadorDeSincroniaGit) {
    this.#dependencias = dependencias;
  }

  /* Espera um pouco antes do primeiro fetch para não disputar a rede com a abertura do HUB SNK. */
  iniciar(): void {
    this.#primeiraConsulta = setTimeout(
      () => void this.#conferirSemFalhar(),
      ATRASO_DA_PRIMEIRA_CONSULTA_MS,
    );
    this.#intervalo = setInterval(
      () => void this.#conferirSemFalhar(),
      INTERVALO_ENTRE_CONSULTAS_MS,
    );
  }

  parar(): void {
    if (this.#primeiraConsulta) clearTimeout(this.#primeiraConsulta);
    if (this.#intervalo) clearInterval(this.#intervalo);
  }

  async conferir(): Promise<void> {
    const configuracao = await this.#dependencias.configuracao.ler();
    if (!configuracao.avisoDaBranchPrincipal) return;

    const clientes = await this.#dependencias.clientes.listar();
    const itens = clientes.flatMap((cliente) =>
      cliente.repositorios
        .filter((repositorio) => repositorio.caminhoLocal && repositorio.branchPrincipal)
        .map<RepositorioDoCliente>((repositorio) => ({ cliente, repositorio })),
    );
    if (itens.length === 0) return;

    const repositorios = itens.map(({ repositorio }) => ({
      id: repositorio.id,
      caminhoLocal: repositorio.caminhoLocal as string,
      urlCadastrada: repositorio.url,
      branchPrincipal: repositorio.branchPrincipal,
    }));

    await this.#dependencias.consultarRemotos(repositorios, configuracao.tempoLimiteSegundos);
    const situacoes = await this.#dependencias.coletarSituacoes(repositorios, configuracao, true);

    for (const item of itens) {
      await this.#avisar(item, situacoes[item.repositorio.id]);
    }
  }

  async #avisar(
    { cliente, repositorio }: RepositorioDoCliente,
    situacao: SituacaoGit | undefined,
  ): Promise<void> {
    for (const pendencia of situacao?.pendencias ?? []) {
      const titulo = TITULOS_POR_CODIGO[pendencia.codigo];
      if (!titulo) continue;

      await this.#dependencias.emitir({
        origem: 'sistema',
        tag: 'padrão',
        chave: `git:${repositorio.id}:${pendencia.codigo}:${pendencia.mensagem}`,
        titulo,
        mensagem: [
          cliente.nome,
          repositorio.url,
          repositorio.caminhoLocal,
          `Branch: ${repositorio.branchPrincipal}`,
          pendencia.mensagem,
        ].join('\n'),
        enviarEmail: false,
      });
    }
  }

  async #conferirSemFalhar(): Promise<void> {
    try {
      await this.conferir();
    } catch (erro) {
      this.#dependencias.registrador.warn(
        `Não foi possível conferir a sincronia dos repositórios: ${descreverErro(erro)}`,
      );
    }
  }
}
