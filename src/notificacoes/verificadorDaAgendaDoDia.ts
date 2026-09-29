import type { RepositorioConfiguracao } from '../repositorio/repositorioConfiguracao.ts';
import { lerCodusuConfigurado } from '../sankhya/consultasDaAgenda.ts';
import type { SituacaoDoDia } from '../sankhya/experience.ts';
import { PonteDoDesktopIndisponivelError } from '../sankhya/ponteDoDesktop.ts';
import type { EventoAgenda } from '../tipos.ts';
import type { DadosDeNotificacao, RegistradorDeNotificacoes } from './centralDeNotificacoes.ts';
import { dataIsoLocal, horaLocal, lerDataHoraDaAgenda } from './relogio.ts';

/*
 * A primeira verificação espera o shell empurrar a sessão da Experience e a janela
 * oculta do ERP logar; antes disso, toda consulta falharia.
 */
const ESPERA_ANTES_DA_PRIMEIRA_VERIFICACAO_MS = 2 * 60_000;
const INTERVALO_ENTRE_VERIFICACOES_MS = 15 * 60_000;
const MILISSEGUNDOS_POR_MINUTO = 60_000;

/*
 * Evento de dia inteiro, ou que continua amanhã, não tem fim hoje: o alerta usa o fim do
 * expediente como se fosse o fim dele.
 */
const HORARIO_DE_FIM_DO_EXPEDIENTE = '18:00:00';
const DIA_INTEIRO = 'S';

const ROTULOS_DA_SITUACAO: Record<Exclude<SituacaoDoDia['tipo'], 'os-lancada'>, string> = {
  'tarefa-aberta': 'tarefa aberta, sem OS lançada',
  'sem-tarefa': 'nenhuma tarefa nem OS no dia',
};

/** O que o verificador usa de fora. Funções, e não as classes, para os testes não precisarem do Sankhya. */
export interface DependenciasDoVerificadorDaAgenda {
  configuracao: RepositorioConfiguracao;
  emitir(dados: DadosDeNotificacao): Promise<unknown>;
  jaEmitida(chave: string): Promise<boolean>;
  /** Traz o dia de novo do Sankhya para o snapshot. */
  atualizarAgendaDoDia(dia: string, codusu: number): Promise<void>;
  eventosDoDia(dia: string): EventoAgenda[];
  situacaoDoDia(codparc: number, dia: string): Promise<SituacaoDoDia>;
  agora(): Date;
  registrador: RegistradorDeNotificacoes;
}

function descreverErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/** Quando o evento passa a merecer o alerta: o fim dele no dia, mais a tolerância. */
export function momentoDoAlerta(
  evento: EventoAgenda,
  dia: string,
  toleranciaMinutos: number,
): Date {
  const terminaHoje = evento.allday !== DIA_INTEIRO && evento.fim.startsWith(dia);
  const fim = terminaHoje ? evento.fim : `${dia} ${HORARIO_DE_FIM_DO_EXPEDIENTE}`;
  return new Date(
    lerDataHoraDaAgenda(fim).getTime() + toleranciaMinutos * MILISSEGUNDOS_POR_MINUTO,
  );
}

function chaveDoEvento(evento: EventoAgenda, dia: string): string {
  return `agenda:${dia}:${evento.nuevento ?? `${evento.codparc}-${evento.inicio}`}`;
}

function descreverHorario(evento: EventoAgenda): string {
  if (evento.allday === DIA_INTEIRO) {
    return 'dia inteiro';
  }
  return `${horaLocal(lerDataHoraDaAgenda(evento.inicio))}–${horaLocal(lerDataHoraDaAgenda(evento.fim))}`;
}

/**
 * Alerta de agenda do dia sem OS lançada: de tempos em tempos, relê a agenda de hoje e,
 * para cada evento de parceiro que já terminou (mais a tolerância), confere na
 * Experience se o dia tem OS. Sem OS — tarefa aberta ou nada —, notifica uma vez por
 * evento por dia.
 */
export class VerificadorDaAgendaDoDia {
  readonly #dependencias: DependenciasDoVerificadorDaAgenda;
  #espera: NodeJS.Timeout | null = null;
  #intervalo: NodeJS.Timeout | null = null;
  #verificando = false;

  constructor(dependencias: DependenciasDoVerificadorDaAgenda) {
    this.#dependencias = dependencias;
  }

  iniciar(): void {
    this.#espera = setTimeout(() => {
      void this.#verificarSemSobrepor();
      this.#intervalo = setInterval(
        () => void this.#verificarSemSobrepor(),
        INTERVALO_ENTRE_VERIFICACOES_MS,
      );
    }, ESPERA_ANTES_DA_PRIMEIRA_VERIFICACAO_MS);
  }

  parar(): void {
    if (this.#espera) clearTimeout(this.#espera);
    if (this.#intervalo) clearInterval(this.#intervalo);
  }

  async verificar(): Promise<void> {
    const { configuracao, agora } = this.#dependencias;
    const { alertaDaAgenda, sankhyaOmCodUsu, terceiro } = await configuracao.ler();
    // Terceiro não tem as credenciais do Sankhya: um alerta deixado ligado só geraria falha.
    if (!alertaDaAgenda.ativo || terceiro) {
      return;
    }

    const codusu = lerCodusuConfigurado({ sankhyaOmCodUsu });
    if (codusu === null) {
      this.#dependencias.registrador.warn(
        'Alerta da agenda ligado sem o código de usuário do Sankhya OM: nada a verificar.',
      );
      return;
    }

    const momento = agora();
    const dia = dataIsoLocal(momento);
    await this.#atualizarAgenda(dia, codusu);

    const vencidos = this.#dependencias
      .eventosDoDia(dia)
      .filter((evento) => evento.codusu === codusu && evento.codparc !== null)
      .filter(
        (evento) => momentoDoAlerta(evento, dia, alertaDaAgenda.toleranciaMinutos) <= momento,
      );

    await this.#notificarEventosSemOs(vencidos, dia, alertaDaAgenda.enviarEmail);
  }

  async #verificarSemSobrepor(): Promise<void> {
    if (this.#verificando) {
      return;
    }

    this.#verificando = true;
    try {
      await this.verificar();
    } catch (erro) {
      this.#dependencias.registrador.warn(`Verificação da agenda falhou: ${descreverErro(erro)}`);
    } finally {
      this.#verificando = false;
    }
  }

  /** Sem conseguir atualizar, segue com o snapshot que já existe: melhor que não avisar. */
  async #atualizarAgenda(dia: string, codusu: number): Promise<void> {
    try {
      await this.#dependencias.atualizarAgendaDoDia(dia, codusu);
    } catch (erro) {
      this.#dependencias.registrador.warn(
        `Agenda de ${dia} não foi atualizada do Sankhya; vale o snapshot: ${descreverErro(erro)}`,
      );
    }
  }

  async #notificarEventosSemOs(
    eventos: EventoAgenda[],
    dia: string,
    enviarEmail: boolean,
  ): Promise<void> {
    const situacoesPorParceiro = new Map<number, SituacaoDoDia>();

    for (const evento of eventos) {
      const chave = chaveDoEvento(evento, dia);
      if (await this.#dependencias.jaEmitida(chave)) {
        continue;
      }

      const codparc = evento.codparc as number;
      let situacao = situacoesPorParceiro.get(codparc);
      if (!situacao) {
        try {
          situacao = await this.#dependencias.situacaoDoDia(codparc, dia);
        } catch (erro) {
          // A falha é da sessão ou do shell, e vale para todos os eventos: parar aqui.
          await this.#notificarFalhaDaConsulta(erro, dia);
          return;
        }
        situacoesPorParceiro.set(codparc, situacao);
      }

      if (situacao.tipo === 'os-lancada') {
        continue;
      }

      await this.#dependencias.emitir({
        origem: 'agenda',
        chave,
        titulo: 'Agenda de hoje sem OS lançada',
        mensagem: `${evento.nomeparc} (${descreverHorario(evento)}): ${ROTULOS_DA_SITUACAO[situacao.tipo]}.`,
        enviarEmail,
      });
    }
  }

  /** Uma vez por dia: a sessão caída repetiria o mesmo aviso a cada verificação. */
  async #notificarFalhaDaConsulta(erro: unknown, dia: string): Promise<void> {
    const motivo = descreverErro(erro);
    // Sem o shell (`npm run dev`) não há consulta possível, e isso é o esperado.
    if (erro instanceof PonteDoDesktopIndisponivelError) {
      this.#dependencias.registrador.info(`Alerta da agenda sem o shell desktop: ${motivo}`);
      return;
    }

    await this.#dependencias.emitir({
      origem: 'sistema',
      chave: `agenda-falha:${dia}`,
      titulo: 'Não foi possível conferir as OS da agenda de hoje',
      mensagem: `${motivo} Confira o login em Credenciais Sankhya.`,
      enviarEmail: false,
    });
  }
}
