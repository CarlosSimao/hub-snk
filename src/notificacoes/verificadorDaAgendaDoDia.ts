import type { RepositorioConfiguracao } from '../repositorio/repositorioConfiguracao.ts';
import { lerCodusuConfigurado } from '../sankhya/consultasDaAgenda.ts';
import type { SituacaoDoDia } from '../sankhya/experience.ts';
import { PonteDoDesktopIndisponivelError } from '../sankhya/ponteDoDesktop.ts';
import type { AlertaDaAgenda, EventoAgenda } from '../tipos.ts';
import type { DadosDeNotificacao, RegistradorDeNotificacoes } from './centralDeNotificacoes.ts';
import { dataIsoLocal, horaLocal, lerDataHoraDaAgenda, proximoDiaUtil } from './relogio.ts';

/*
 * A primeira verificação espera o shell empurrar a sessão da Experience e a janela
 * oculta do ERP logar; antes disso, toda consulta falharia.
 */
const ESPERA_ANTES_DA_PRIMEIRA_VERIFICACAO_MS = 2 * 60_000;
/*
 * De quanto em quanto tempo o verificador confere se já deu a periodicidade configurada.
 * É o atraso máximo para uma periodicidade alterada na tela passar a valer.
 */
const INTERVALO_DO_RELOGIO_MS = 60_000;
const MILISSEGUNDOS_POR_MINUTO = 60_000;

const DIA_INTEIRO = 'S';

/*
 * Separa, na chave da notificação repetida, a identificação do evento do momento da
 * execução. Não é `:`, que já aparece no `inicio` da identificação de evento sem número.
 */
const SEPARADOR_DA_REPETICAO = '#';

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

/** O dia atual e, quando o alerta pede, o próximo dia útil. */
export function diasMonitorados(hoje: string, alerta: AlertaDaAgenda): string[] {
  return alerta.incluirProximoDiaUtil ? [hoje, proximoDiaUtil(hoje)] : [hoje];
}

/**
 * Sem repetição, a chave é a do evento no dia e a central não emite a mesma duas vezes.
 * Com repetição, cada execução ganha a sua; o Resumo lê só o trecho antes do separador.
 */
function chaveDoEvento(evento: EventoAgenda, dia: string, repeticao: number | null): string {
  const chave = `agenda:${dia}:${evento.nuevento ?? `${evento.codparc}-${evento.inicio}`}`;
  return repeticao === null ? chave : `${chave}${SEPARADOR_DA_REPETICAO}${repeticao}`;
}

function descreverHorario(evento: EventoAgenda): string {
  if (evento.allday === DIA_INTEIRO) {
    return 'dia inteiro';
  }
  return `${horaLocal(lerDataHoraDaAgenda(evento.inicio))}–${horaLocal(lerDataHoraDaAgenda(evento.fim))}`;
}

function descreverDia(dia: string, hoje: string): string {
  if (dia === hoje) {
    return 'hoje';
  }
  const [ano, mes, numero] = dia.split('-');
  return `${numero}/${mes}/${ano}`;
}

/**
 * Alerta de agenda sem tarefa na Experience: na periodicidade configurada, relê a agenda
 * de hoje — e, se pedido, a do próximo dia útil — e, para cada evento de parceiro,
 * confere na Experience se o dia tem tarefa ou OS. Sem nenhuma das duas, notifica: uma
 * vez por evento por dia ou, com a repetição ligada, a cada execução até resolver.
 */
export class VerificadorDaAgendaDoDia {
  readonly #dependencias: DependenciasDoVerificadorDaAgenda;
  #espera: NodeJS.Timeout | null = null;
  #relogio: NodeJS.Timeout | null = null;
  #ultimaVerificacao: number | null = null;
  #verificando = false;

  constructor(dependencias: DependenciasDoVerificadorDaAgenda) {
    this.#dependencias = dependencias;
  }

  iniciar(): void {
    this.#espera = setTimeout(() => {
      void this.#verificarSeDeuAPeriodicidade();
      this.#relogio = setInterval(
        () => void this.#verificarSeDeuAPeriodicidade(),
        INTERVALO_DO_RELOGIO_MS,
      );
    }, ESPERA_ANTES_DA_PRIMEIRA_VERIFICACAO_MS);
  }

  parar(): void {
    if (this.#espera) clearTimeout(this.#espera);
    if (this.#relogio) clearInterval(this.#relogio);
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
        'Alerta da agenda ligado sem o código de usuário do SankhyaOm: nada a verificar.',
      );
      return;
    }

    const momento = agora();
    const hoje = dataIsoLocal(momento);
    const repeticao = alertaDaAgenda.repetirAteResolver ? momento.getTime() : null;
    for (const dia of diasMonitorados(hoje, alertaDaAgenda)) {
      await this.#atualizarAgenda(dia, codusu);
      const eventos = this.#dependencias
        .eventosDoDia(dia)
        .filter((evento) => evento.codusu === codusu && evento.codparc !== null);
      const conseguiuConsultar = await this.#notificarEventosSemTarefa(eventos, {
        dia,
        hoje,
        repeticao,
        enviarEmail: alertaDaAgenda.enviarEmail,
      });
      if (!conseguiuConsultar) {
        return;
      }
    }
  }

  async #verificarSeDeuAPeriodicidade(): Promise<void> {
    if (this.#verificando) {
      return;
    }

    this.#verificando = true;
    try {
      const { alertaDaAgenda } = await this.#dependencias.configuracao.ler();
      const agora = this.#dependencias.agora().getTime();
      const intervalo = alertaDaAgenda.intervaloMinutos * MILISSEGUNDOS_POR_MINUTO;
      if (this.#ultimaVerificacao !== null && agora - this.#ultimaVerificacao < intervalo) {
        return;
      }
      this.#ultimaVerificacao = agora;
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

  /** Falso quando a consulta à Experience falhou: a falha vale para os outros dias também. */
  async #notificarEventosSemTarefa(
    eventos: EventoAgenda[],
    contexto: { dia: string; hoje: string; repeticao: number | null; enviarEmail: boolean },
  ): Promise<boolean> {
    const { dia, hoje, repeticao, enviarEmail } = contexto;
    const situacoesPorParceiro = new Map<number, SituacaoDoDia>();

    for (const evento of eventos) {
      const chave = chaveDoEvento(evento, dia, repeticao);
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
          await this.#notificarFalhaDaConsulta(erro, hoje);
          return false;
        }
        situacoesPorParceiro.set(codparc, situacao);
      }

      // Tarefa aberta ou OS lançada: o evento já está encaminhado na Experience.
      if (situacao.tipo !== 'sem-tarefa') {
        continue;
      }

      await this.#dependencias.emitir({
        origem: 'agenda',
        tag: 'OS',
        chave,
        titulo: 'Agenda sem tarefa na Experience',
        mensagem: `${evento.nomeparc} (${descreverDia(dia, hoje)}, ${descreverHorario(evento)}): nenhuma tarefa nem OS no dia.`,
        enviarEmail,
      });
    }
    return true;
  }

  /** Uma vez por dia: a sessão caída repetiria o mesmo aviso a cada verificação. */
  async #notificarFalhaDaConsulta(erro: unknown, hoje: string): Promise<void> {
    const motivo = descreverErro(erro);
    // Sem o shell (`npm run dev`) não há consulta possível, e isso é o esperado.
    if (erro instanceof PonteDoDesktopIndisponivelError) {
      this.#dependencias.registrador.info(`Alerta da agenda sem o shell desktop: ${motivo}`);
      return;
    }

    await this.#dependencias.emitir({
      origem: 'sistema',
      chave: `agenda-falha:${hoje}`,
      titulo: 'Não foi possível conferir as tarefas da agenda',
      mensagem: `${motivo} Confira o login em Credenciais Sankhya.`,
      enviarEmail: false,
    });
  }
}
