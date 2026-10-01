import nodemailer from 'nodemailer';
import type { RepositorioConfiguracao } from '../repositorio/repositorioConfiguracao.ts';
import type { ConfiguracaoSmtp } from '../tipos.ts';

/* Servidor que não responde não pode segurar a verificação da agenda por minutos. */
const TEMPO_LIMITE_DO_SMTP_MS = 15_000;

/*
 * Todo e-mail do HUB SNK diz de onde veio: quem recebe em cópia pode não conhecer a
 * ferramenta. No texto puro o envio acrescenta a linha; o HTML, que tem layout próprio,
 * a desenha com estas mesmas constantes.
 */
export const PAGINA_DO_HUB_SNK = 'https://carlossimao.github.io/hub-snk/';
export const AVISO_DE_EMAIL_AUTOMATICO = 'Este é um e-mail automático enviado pela ferramenta';

export function textoComRodape(texto: string): string {
  return `${texto}\n\n--\n${AVISO_DE_EMAIL_AUTOMATICO} HUB SNK: ${PAGINA_DO_HUB_SNK}`;
}

/** O SMTP está sem host, remetente ou destinatário: não há como enviar. */
export class SmtpNaoConfiguradoError extends Error {
  constructor() {
    super('Configure o SMTP (host, remetente e destinatário) em Configurações › SMTP.');
    this.name = 'SmtpNaoConfiguradoError';
  }
}

/** Imagem anexada e referenciada no HTML por `cid:`, sem depender de internet. */
export interface ImagemEmbutida {
  cid: string;
  nomeDoArquivo: string;
  caminho: string;
}

export interface MensagemDeEmail {
  assunto: string;
  /** Sempre presente: é o corpo de quem não mostra HTML. */
  texto: string;
  html?: string;
  /** Em cópia; o destinatário do SMTP vai sempre no "Para". */
  copia?: string[];
  imagensEmbutidas?: ImagemEmbutida[];
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
        cc: mensagem.copia?.length ? mensagem.copia : undefined,
        subject: mensagem.assunto,
        text: textoComRodape(mensagem.texto),
        html: mensagem.html,
        attachments: mensagem.imagensEmbutidas?.map((imagem) => ({
          cid: imagem.cid,
          filename: imagem.nomeDoArquivo,
          path: imagem.caminho,
        })),
      });
    } finally {
      transporte.close();
    }
  }
}
