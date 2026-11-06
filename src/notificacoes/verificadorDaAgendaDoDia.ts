import type { RepositorioConfiguracao } from '../repositorio/repositorioConfiguracao.ts';
import { lerCodusuConfigurado } from '../sankhya/consultasDaAgenda.ts';
import type { SituacaoDoDia } from '../sankhya/experience.ts';
import { PonteDoDesktopIndisponivelError } from '../sankhya/ponteDoDesktop.ts';
import { idsCitadosNaAgenda } from '../sankhya/solicitacaoServicos.ts';
import type { AlertaDaAgenda, ConfiguracaoGlobal, Contato, EventoAgenda } from '../tipos.ts';
import type { DadosDeNotificacao, RegistradorDeNotificacoes } from './centralDeNotificacoes.ts';
import { montarEmailDeCobrancaDaAgenda } from './emailDeCobrancaDaAgenda.ts';
import {
  dataHoraLocal,
  dataIsoLocal,
  diaSeguinte,
  diasEntre,
  diaUtilAnterior,
  horaLocal,
  lerDataHoraDaAgenda,
  proximoDiaUtil,
} from './relogio.ts';

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
const MILISSEGUNDOS_POR_HORA = 60 * 60_000;

const DIA_INTEIRO = 'S';

/*
 * Separa, na chave da notificação, a identificação do evento de quando ela foi emitida.
 * Não é `:`, que já aparece no `inicio` da identificação de evento sem número.
 */
const SEPARADOR_DA_REPETICAO = '#';

const TITULO_DO_DIA_ATUAL_OU_FUTURO = 'Agenda sem tarefa na Experience';
const TITULO_DO_DIA_PASSADO = 'Tarefa não lançada na Experience';

/** O que o verificador usa de fora. Funções, e não as classes, para os testes não precisarem do Sankhya. */
export interface DependenciasDoVerificadorDaAgenda {
  configuracao: RepositorioConfiguracao;
  emitir(dados: DadosDeNotificacao): Promise<unknown>;
  jaEmitida(chave: string): Promise<boolean>;
  /** Traz o período de novo do Sankhya para o snapshot. */
  atualizarAgendaDoPeriodo(de: string, ate: string, codusu: number): Promise<void>;
  eventosDoDia(dia: string): EventoAgenda[];
  /** Identificações dos eventos marcados para não cobrar tarefa. */
  eventosSemCobranca(): Promise<Set<string>>;
  situacaoDoDia(codparc: number, dia: string): Promise<SituacaoDoDia>;
  contatos(): Promise<Contato[]>;
  /** Consulta a DS e devolve o id do solicitante já cadastrado como contato; `null` sem e-mail. */
  solicitanteComoContato(codigoDaDs: number): Promise<string | null>;
  caminhoDaLogo: string;
  agora(): Date;
  registrador: RegistradorDeNotificacoes;
}

function descreverErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/**
 * Os dias retroativos (todo dia de calendário desde o N-ésimo dia útil anterior, para
 * pegar evento de fim de semana), o dia atual e, quando o alerta pede, o próximo dia útil.
 */
export function diasMonitorados(hoje: string, alerta: AlertaDaAgenda): string[] {
  let inicio = hoje;
  for (let passo = 0; passo < alerta.diasUteisRetroativos; passo++) {
    inicio = diaUtilAnterior(inicio);
  }

  const dias: string[] = [];
  for (let dia = inicio; dia < hoje; dia = diaSeguinte(dia)) {
    dias.push(dia);
  }
  dias.push(hoje);
  if (alerta.incluirProximoDiaUtil) {
    dias.push(proximoDiaUtil(hoje));
  }
  return dias;
}

/** Mesma identificação que a tela usa para marcar o evento como "não cobrar". */
export function identificacaoDoEvento(evento: EventoAgenda): string {
  return String(evento.nuevento ?? `${evento.codparc}-${evento.inicio}`);
}

/**
 * `agenda:<dia do evento>:<evento>#<emissão>`. Sem repetição, a emissão é o dia da
 * verificação: um aviso por evento por dia, inclusive na véspera e no próprio dia. Com
 * repetição, é o instante, e cada execução avisa. O Resumo lê só o trecho antes do `#`.
 */
function chaveDoEvento(evento: EventoAgenda, dia: string, emissao: string): string {
  return `agenda:${dia}:${identificacaoDoEvento(evento)}${SEPARADOR_DA_REPETICAO}${emissao}`;
}

/** Há quantos dias corridos foi o atendimento passado: "há 1 dia", "há 3 dias". */
function descreverAtraso(dia: string, hoje: string): string {
  const dias = diasEntre(dia, hoje);
  return dias === 1 ? 'há 1 dia' : `há ${dias} dias`;
}

function descreverHorario(evento: EventoAgenda): string {
  if (evento.allday === DIA_INTEIRO) {
    return 'dia inteiro';
  }
  return `${horaLocal(lerDataHoraDaAgenda(evento.inicio))}–${horaLocal(lerDataHoraDaAgenda(evento.fim))}`;
}

/** Quem vai em cópia do e-mail de um evento e por que alguém esperado ficou de fora. */
interface CopiaDoEvento {
  contatoIds: string[];
  emails: string[];
  aviso: string;
}

interface ContextoDaVerificacao {
  dia: string;
  hoje: string;
  emissao: string;
  configuracao: ConfiguracaoGlobal;
  geradoEm: string;
}

const mesmoEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function descreverDia(dia: string, hoje: string): string {
  if (dia === hoje) {
    return 'hoje';
  }
  const [ano, mes, numero] = dia.split('-');
  return `${numero}/${mes}/${ano}`;
}

/**
 * Alerta de agenda sem tarefa na Experience: na periodicidade configurada, relê a agenda
 * de hoje — e, se pedido, a dos dias úteis anteriores e a do próximo dia útil — e, para
 * cada evento de parceiro não marcado como "não cobrar", confere na Experience se o dia
 * tem tarefa ou OS. Sem nenhuma das duas, notifica: uma vez por evento por dia ou, com a
 * repetição ligada, a cada execução até resolver ou o dia sair da janela.
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
    const configuracaoLida = await configuracao.ler();
    const { alertaDaAgenda, sankhyaOmCodUsu, terceiro } = configuracaoLida;
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
    const emissao = alertaDaAgenda.repetirAteResolver ? String(momento.getTime()) : hoje;
    const dias = diasMonitorados(hoje, alertaDaAgenda);
    await this.#atualizarAgenda(dias[0] as string, dias.at(-1) as string, codusu);
    const semCobranca = await this.#dependencias.eventosSemCobranca();

    for (const dia of dias) {
      const eventos = this.#dependencias
        .eventosDoDia(dia)
        .filter((evento) => evento.codusu === codusu && evento.codparc !== null)
        .filter((evento) => !semCobranca.has(identificacaoDoEvento(evento)));
      const conseguiuConsultar = await this.#notificarEventosSemTarefa(eventos, {
        dia,
        hoje,
        emissao,
        configuracao: configuracaoLida,
        geradoEm: dataHoraLocal(momento),
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
      const intervalo = alertaDaAgenda.intervaloHoras * MILISSEGUNDOS_POR_HORA;
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
  async #atualizarAgenda(de: string, ate: string, codusu: number): Promise<void> {
    try {
      await this.#dependencias.atualizarAgendaDoPeriodo(de, ate, codusu);
    } catch (erro) {
      this.#dependencias.registrador.warn(
        `Agenda de ${de} a ${ate} não foi atualizada do Sankhya; vale o snapshot: ${descreverErro(erro)}`,
      );
    }
  }

  /** Falso quando a consulta à Experience falhou: a falha vale para os outros dias também. */
  async #notificarEventosSemTarefa(
    eventos: EventoAgenda[],
    contexto: ContextoDaVerificacao,
  ): Promise<boolean> {
    const { dia, hoje, emissao } = contexto;
    const situacoesPorParceiro = new Map<number, SituacaoDoDia>();

    for (const evento of eventos) {
      const chave = chaveDoEvento(evento, dia, emissao);
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

      await this.#emitirAlertaDoEvento(evento, chave, contexto);
    }
    return true;
  }

  async #emitirAlertaDoEvento(
    evento: EventoAgenda,
    chave: string,
    contexto: ContextoDaVerificacao,
  ): Promise<void> {
    const { dia, hoje, configuracao, geradoEm } = contexto;
    const passado = dia < hoje;
    const atraso = passado ? descreverAtraso(dia, hoje) : '';
    const alerta: DadosDeNotificacao = {
      origem: 'agenda',
      tag: 'OS',
      chave,
      titulo: passado ? TITULO_DO_DIA_PASSADO : TITULO_DO_DIA_ATUAL_OU_FUTURO,
      mensagem: `${evento.nomeparc} (${descreverDia(dia, hoje)}, ${descreverHorario(evento)}): nenhuma tarefa nem OS no dia${atraso && `, ${atraso}`}.`,
      enviarEmail: configuracao.alertaDaAgenda.enviarEmail,
    };
    if (!alerta.enviarEmail) {
      await this.#dependencias.emitir(alerta);
      return;
    }

    const copia = await this.#copiaDoEvento(evento, configuracao);
    await this.#dependencias.emitir({
      ...alerta,
      contatoIdsEmCopia: copia.contatoIds,
      avisoDaCopia: copia.aviso,
      email: montarEmailDeCobrancaDaAgenda({
        // O assunto do e-mail leva o atraso, que a notificação já mostra na mensagem.
        titulo: atraso ? `${alerta.titulo} (${atraso})` : alerta.titulo,
        mensagem: alerta.mensagem,
        geradoEm,
        observacao: '',
        copia: copia.emails,
        caminhoDaLogo: this.#dependencias.caminhoDaLogo,
        cobrador: configuracao,
      }),
    });
  }

  /**
   * Os contatos configurados e o solicitante de cada DS citada no evento. A DS que não
   * pôde ser consultada não segura o e-mail: ele sai sem o solicitante, com o motivo.
   */
  async #copiaDoEvento(
    evento: EventoAgenda,
    configuracao: ConfiguracaoGlobal,
  ): Promise<CopiaDoEvento> {
    const { contatoIds: solicitantes, aviso } = await this.#solicitantesDoEvento(evento);
    const ids = new Set([...configuracao.alertaDaAgenda.contatoIdsEmCopia, ...solicitantes]);
    const cadastrados = await this.#dependencias.contatos();

    const copia: CopiaDoEvento = { contatoIds: [], emails: [], aviso };
    for (const id of ids) {
      const contato = cadastrados.find((item) => item.id === id);
      if (!contato?.email) {
        this.#dependencias.registrador.warn(
          `Contato em cópia do alerta da agenda sem e-mail ou excluído: ${contato?.nome ?? id}.`,
        );
        continue;
      }
      const repetido = [configuracao.smtp.destinatario, ...copia.emails].some((email) =>
        mesmoEmail(email, contato.email),
      );
      if (repetido) continue;
      copia.contatoIds.push(contato.id);
      copia.emails.push(contato.email);
    }
    return copia;
  }

  async #solicitantesDoEvento(
    evento: EventoAgenda,
  ): Promise<{ contatoIds: string[]; aviso: string }> {
    const contatoIds: string[] = [];
    const falhas: string[] = [];
    for (const codigo of idsCitadosNaAgenda(`${evento.descrabrev}\n${evento.descrlonga}`)) {
      try {
        const contatoId = await this.#dependencias.solicitanteComoContato(codigo);
        if (contatoId) contatoIds.push(contatoId);
      } catch (erro) {
        const motivo = `Solicitante da DS ${codigo} fora da cópia: ${descreverErro(erro)}`;
        this.#dependencias.registrador.warn(`Alerta da agenda: ${motivo}`);
        falhas.push(motivo);
      }
    }
    return { contatoIds, aviso: falhas.join(' ') };
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
      mensagem: `${motivo} Confira o login em Sankhya ID.`,
      enviarEmail: false,
    });
  }
}
