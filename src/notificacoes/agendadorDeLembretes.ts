import type { RepositorioClientes } from '../repositorio/repositorioClientes.ts';
import type { RepositorioLembretes } from '../repositorio/repositorioLembretes.ts';
import type { Lembrete } from '../tipos.ts';
import type { DadosDeNotificacao, RegistradorDeNotificacoes } from './centralDeNotificacoes.ts';
import { ocorrenciaDevida } from './disparoDeLembretes.ts';
import { dataHoraLocal } from './relogio.ts';

/* O cron tem resolução de minuto: conferir a cada meio minuto dispara no minuto certo. */
const INTERVALO_ENTRE_CONFERENCIAS_MS = 30_000;

/* Folga para o tique do agendador: passou disto, o disparo é de uma ocorrência perdida. */
const ATRASO_TOLERADO_MS = 2 * 60_000;

export interface DependenciasDoAgendadorDeLembretes {
  lembretes: RepositorioLembretes;
  clientes: RepositorioClientes;
  emitir(dados: DadosDeNotificacao): Promise<unknown>;
  agora(): Date;
  registrador: RegistradorDeNotificacoes;
}

function descreverErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/** Confere os lembretes de tempos em tempos e dispara os que venceram. */
export class AgendadorDeLembretes {
  readonly #dependencias: DependenciasDoAgendadorDeLembretes;
  #intervalo: NodeJS.Timeout | null = null;
  #conferindo = false;

  constructor(dependencias: DependenciasDoAgendadorDeLembretes) {
    this.#dependencias = dependencias;
  }

  /* Confere já na largada: o lembrete vencido com o HUB SNK fechado aparece ao abrir. */
  iniciar(): void {
    void this.#conferirSemSobrepor();
    this.#intervalo = setInterval(
      () => void this.#conferirSemSobrepor(),
      INTERVALO_ENTRE_CONFERENCIAS_MS,
    );
  }

  parar(): void {
    if (this.#intervalo) clearInterval(this.#intervalo);
  }

  async conferir(): Promise<void> {
    const agora = this.#dependencias.agora();
    for (const lembrete of await this.#dependencias.lembretes.listar()) {
      await this.#dispararSeVenceu(lembrete, agora);
    }
  }

  async #conferirSemSobrepor(): Promise<void> {
    if (this.#conferindo) {
      return;
    }

    this.#conferindo = true;
    try {
      await this.conferir();
    } catch (erro) {
      this.#dependencias.registrador.warn(
        `Conferência dos lembretes falhou: ${descreverErro(erro)}`,
      );
    } finally {
      this.#conferindo = false;
    }
  }

  /** Um lembrete com problema (cron editado à mão no arquivo) não trava os outros. */
  async #dispararSeVenceu(lembrete: Lembrete, agora: Date): Promise<void> {
    let ocorrencia: Date | null;
    try {
      ocorrencia = ocorrenciaDevida(lembrete, agora);
    } catch (erro) {
      this.#dependencias.registrador.warn(
        `Lembrete ${lembrete.id} ignorado: ${descreverErro(erro)}`,
      );
      return;
    }

    if (!ocorrencia) {
      return;
    }

    await this.#dependencias.emitir({
      origem: 'lembrete',
      chave: `lembrete:${lembrete.id}:${ocorrencia.toISOString()}`,
      titulo: 'Lembrete',
      mensagem: await this.#montarMensagem(lembrete, ocorrencia, agora),
      enviarEmail: lembrete.enviarEmail,
    });
    await this.#dependencias.lembretes.registrarDisparo(lembrete.id, agora);
  }

  async #montarMensagem(lembrete: Lembrete, ocorrencia: Date, agora: Date): Promise<string> {
    const linhas = [lembrete.texto, ...(await this.#descreverVinculo(lembrete))];
    if (agora.getTime() - ocorrencia.getTime() > ATRASO_TOLERADO_MS) {
      linhas.push(`Atrasado: era para ${dataHoraLocal(ocorrencia)}.`);
    }
    return linhas.join('\n');
  }

  /* Cliente ou projeto removido depois do cadastro do lembrete só some da mensagem. */
  async #descreverVinculo(lembrete: Lembrete): Promise<string[]> {
    if (lembrete.clienteId === null) {
      return [];
    }

    const cliente = await this.#dependencias.clientes.buscarPorId(lembrete.clienteId);
    if (!cliente) {
      return [];
    }

    const projeto = cliente.projetos.find((item) => item.id === lembrete.projetoId);
    return [projeto ? `${cliente.nome} › ${projeto.nome}` : cliente.nome];
  }
}
