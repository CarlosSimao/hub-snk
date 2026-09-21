/**
 * Resumo diario das anotacoes marcadas com "avisar".
 *
 * Um e-mail por dia, no horario configurado, com as anotacoes dos clientes que voce
 * pediu para lembrar. Vai para o PROPRIO endereco configurado no SMTP — e' lembrete de
 * quem usa o hub, nao comunicacao com o cliente (que e' o que `EmailInterno.enviar` faz).
 *
 * O controle de "ja mandei hoje" e' a DATA do ultimo envio, guardada no banco, nao um
 * timer em memoria: o hub abre e fecha varias vezes por dia, e um contador em memoria
 * mandaria o resumo de novo a cada abertura depois do horario.
 */
import type { Clientes } from './sankhya/clientes.ts';
import type { EmailInterno } from './sankhya/emailInterno.ts';
import { temPendencia, textoPendencias, type Pendencias } from './pendencias.ts';
import type { Cliente } from './types.ts';

/** De quanto em quanto tempo se olha o relogio. Um minuto e' fino o bastante para `HH:MM`. */
const INTERVALO_MS = 60_000;

export interface ResultadoResumo {
  enviado: boolean;
  motivo: string;
  clientes: number;
}

/** `YYYY-MM-DD` na hora local — e' o que o usuario chama de "hoje". */
export function diaLocal(agora = new Date()): string {
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

function horaLocal(agora = new Date()): string {
  return `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
}

/** Clientes com anotacao preenchida E marcada para avisar. */
export function paraLembrar(clientes: Cliente[]): Cliente[] {
  return clientes.filter((c) => c.anotacoesNotificar && c.anotacoes.trim() !== '');
}

export function montarCorpo(lista: Cliente[]): string {
  const linhas = lista.map((c) => `• ${c.nome}\n${c.anotacoes.trim()}`);
  return [
    lista.length === 1
      ? 'Uma anotação marcada para lembrete:'
      : `${lista.length} anotações marcadas para lembrete:`,
    '',
    linhas.join('\n\n'),
  ].join('\n');
}

export class ResumoAnotacoes {
  readonly #clientes: Clientes;
  readonly #email: EmailInterno;
  readonly #pendencias: Pendencias | undefined;
  #timer: NodeJS.Timeout | undefined;

  constructor(clientes: Clientes, email: EmailInterno, pendencias?: Pendencias) {
    this.#clientes = clientes;
    this.#email = email;
    this.#pendencias = pendencias;
  }

  /**
   * Tenta enviar agora, respeitando config, horario e o "ja mandei hoje".
   *
   * Exposto para a rota de teste da tela poder disparar na hora, sem esperar o horario:
   * conferir se o e-mail chega nao deveria exigir mudar o relogio da maquina.
   */
  async tentarEnviar(agora = new Date(), forcar = false): Promise<ResultadoResumo> {
    const config = this.#email.obterConfig();
    if (!forcar && !config.resumoAnotacoes.ativo) {
      return { enviado: false, motivo: 'resumo desativado', clientes: 0 };
    }

    const hoje = diaLocal(agora);
    if (!forcar) {
      if (horaLocal(agora) < config.resumoAnotacoes.hora) {
        return { enviado: false, motivo: 'ainda não deu a hora', clientes: 0 };
      }
      if (this.#email.ultimoResumoEm() === hoje) {
        return { enviado: false, motivo: 'já enviado hoje', clientes: 0 };
      }
    }

    const lista = paraLembrar(this.#clientes.listar());

    // As pendencias (tarefa atrasada, dia sem OS, e-mail de finalizacao) entram no MESMO
    // e-mail: sao a mesma pergunta — "o que ficou para tras?" — e dois e-mails diarios
    // seriam dois e-mails a ignorar.
    const pendentes = this.#pendencias ? await this.#pendencias.deTodos() : [];
    const blocoPendencias = textoPendencias(pendentes);
    const quantosPendentes = pendentes.filter(temPendencia).length;

    if (lista.length === 0 && !blocoPendencias) {
      // Marca o dia mesmo sem enviar: sem isto, um dia sem nada faria a verificacao
      // repetir a cada minuto ate' a meia-noite.
      if (!forcar) this.#email.registrarResumoEnviado(hoje);
      return { enviado: false, motivo: 'nada a avisar', clientes: 0 };
    }

    const destinatario = config.smtpUsuario;
    if (!destinatario) {
      return { enviado: false, motivo: 'SMTP sem usuário configurado', clientes: lista.length };
    }

    const partes = [lista.length ? montarCorpo(lista) : '', blocoPendencias].filter(Boolean);

    await this.#email.enviarPara(destinatario, {
      assunto: `Anotações e pendências — ${hoje.split('-').reverse().join('/')}`,
      corpo: partes.join('\n\n'),
    });

    this.#email.registrarResumoEnviado(hoje);
    return { enviado: true, motivo: 'enviado', clientes: lista.length + quantosPendentes };
  }

  /**
   * O texto que o e-mail de hoje teria, sem enviar nada.
   *
   * Existe para conferir o conteudo sem gastar um envio (e sem consumir o "ja enviei
   * hoje", que o botao de teste consome).
   */
  async previa(): Promise<{ corpo: string; anotacoes: number; pendentes: number }> {
    const lista = paraLembrar(this.#clientes.listar());
    const pendentes = this.#pendencias ? await this.#pendencias.deTodos() : [];
    const partes = [lista.length ? montarCorpo(lista) : '', textoPendencias(pendentes)].filter(Boolean);
    return {
      corpo: partes.join('\n\n'),
      anotacoes: lista.length,
      pendentes: pendentes.filter(temPendencia).length,
    };
  }

  /** Relogio de um minuto. `unref` para nao segurar o processo no encerramento. */
  iniciar(aoFalhar?: (erro: unknown) => void): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => {
      void this.tentarEnviar().catch((erro: unknown) => aoFalhar?.(erro));
    }, INTERVALO_MS);
    this.#timer.unref();
  }

  parar(): void {
    if (!this.#timer) return;
    clearInterval(this.#timer);
    this.#timer = undefined;
  }
}
