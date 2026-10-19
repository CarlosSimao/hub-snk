import type { RepositorioClientes } from '../repositorio/repositorioClientes.ts';
import type { TipoDeBase } from '../tipos.ts';
import type { DadosDeNotificacao, RegistradorDeNotificacoes } from './centralDeNotificacoes.ts';

/**
 * Lembra, a cada 4 horas, das bases com o dashboard HUB - Workbench implantado
 * (`dashboardImplantado`). O campo é gravado por outra aplicação: aqui ele só é lido.
 *
 * A chave da notificação é a janela de 4 horas em que ela sai, então o lembrete aparece
 * no máximo uma vez por janela, mesmo com o HUB SNK reiniciado no meio dela.
 */

const PERIODO_DO_LEMBRETE_MS = 4 * 60 * 60_000;
/* Conferência curta: o lembrete sai logo que a janela abre, ou que uma base é marcada. */
const INTERVALO_ENTRE_CONFERENCIAS_MS = 5 * 60_000;

const ROTULOS_DE_TIPO: Record<TipoDeBase, string> = {
  producao: 'Produção',
  teste: 'Teste',
  outro: 'Outro',
};

export interface DependenciasDoAvisoDeDashboards {
  clientes: Pick<RepositorioClientes, 'listar'>;
  emitir(dados: DadosDeNotificacao): Promise<unknown>;
  agora(): Date;
  registrador: RegistradorDeNotificacoes;
}

function descreverErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

export class AvisoDeDashboardsImplantados {
  readonly #dependencias: DependenciasDoAvisoDeDashboards;
  #intervalo: NodeJS.Timeout | null = null;

  constructor(dependencias: DependenciasDoAvisoDeDashboards) {
    this.#dependencias = dependencias;
  }

  iniciar(): void {
    void this.#conferirSemFalhar();
    this.#intervalo = setInterval(
      () => void this.#conferirSemFalhar(),
      INTERVALO_ENTRE_CONFERENCIAS_MS,
    );
  }

  parar(): void {
    if (this.#intervalo) clearInterval(this.#intervalo);
  }

  async conferir(): Promise<void> {
    const clientes = await this.#dependencias.clientes.listar();
    const linhas = clientes.flatMap((cliente) =>
      cliente.bases
        .filter((base) => base.dashboardImplantado === true)
        .map((base) => `${cliente.nome} (${ROTULOS_DE_TIPO[base.tipo] ?? base.tipo}): ${base.url}`),
    );
    if (linhas.length === 0) return;

    const janela = Math.floor(this.#dependencias.agora().getTime() / PERIODO_DO_LEMBRETE_MS);
    await this.#dependencias.emitir({
      origem: 'sistema',
      chave: `dashboards-implantados:${janela}`,
      titulo:
        linhas.length === 1
          ? 'Dashboard HUB - Workbench implantado em 1 base'
          : `Dashboard HUB - Workbench implantado em ${linhas.length} bases`,
      mensagem: linhas.join('\n'),
      enviarEmail: false,
    });
  }

  async #conferirSemFalhar(): Promise<void> {
    try {
      await this.conferir();
    } catch (erro) {
      this.#dependencias.registrador.warn(
        `Não foi possível conferir os dashboards implantados: ${descreverErro(erro)}`,
      );
    }
  }
}
