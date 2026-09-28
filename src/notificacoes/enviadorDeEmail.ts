import nodemailer from 'nodemailer';
import type { RepositorioConfiguracao } from '../repositorio/repositorioConfiguracao.ts';
import type { ConfiguracaoSmtp } from '../tipos.ts';

/* Servidor que não responde não pode segurar a verificação da agenda por minutos. */
const TEMPO_LIMITE_DO_SMTP_MS = 15_000;

/** O SMTP está sem host, remetente ou destinatário: não há como enviar. */
export class SmtpNaoConfiguradoError extends Error {
  constructor() {
    super('Configure o SMTP (host, remetente e destinatário) em Configurações › SMTP.');
    this.name = 'SmtpNaoConfiguradoError';
  }
}

export interface MensagemDeEmail {
  assunto: string;
  texto: string;
}

export function smtpConfigurado(smtp: ConfiguracaoSmtp): boolean {
  return smtp.host !== '' && smtp.remetente !== '' && smtp.destinatario !== '';
}

function criarTransporte(smtp: ConfiguracaoSmtp) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.porta,
    secure: smtp.seguranca === 'ssl',
    requireTLS: smtp.seguranca === 'starttls',
    ignoreTLS: smtp.seguranca === 'nenhuma',
    auth: smtp.usuario === '' ? undefined : { user: smtp.usuario, pass: smtp.senha },
    connectionTimeout: TEMPO_LIMITE_DO_SMTP_MS,
    greetingTimeout: TEMPO_LIMITE_DO_SMTP_MS,
    socketTimeout: TEMPO_LIMITE_DO_SMTP_MS,
  });
}

/** Envia os e-mails das notificações pelo SMTP da configuração global. */
export class EnviadorDeEmail {
  readonly #configuracao: RepositorioConfiguracao;

  constructor(configuracao: RepositorioConfiguracao) {
    this.#configuracao = configuracao;
  }

  /** Com o SMTP gravado. É o caminho das notificações. */
  async enviarPeloSmtpGravado(mensagem: MensagemDeEmail): Promise<void> {
    const { smtp } = await this.#configuracao.ler();
    await this.enviar(smtp, mensagem);
  }

  /** Com um SMTP qualquer, gravado ou não. É o caminho do e-mail de teste. */
  async enviar(smtp: ConfiguracaoSmtp, mensagem: MensagemDeEmail): Promise<void> {
    if (!smtpConfigurado(smtp)) {
      throw new SmtpNaoConfiguradoError();
    }

    const transporte = criarTransporte(smtp);
    try {
      await transporte.sendMail({
        from: smtp.remetente,
        to: smtp.destinatario,
        subject: mensagem.assunto,
        text: mensagem.texto,
      });
    } finally {
      transporte.close();
    }
  }
}
