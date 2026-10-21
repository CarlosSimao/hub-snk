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

/** Quem usa o HUB SNK, como preenchido em Configurações; sai em todo e-mail enviado. */
export interface RemetenteDoEmail {
  nome: string;
  empresa: string;
  time: string;
}

/** "Nome · Empresa · Time", só com o que está preenchido. */
export function descreverRemetente(remetente: RemetenteDoEmail | undefined): string {
  return [remetente?.nome, remetente?.empresa, remetente?.time]
    .map((parte) => parte?.trim() ?? '')
    .filter(Boolean)
    .join(' · ');
}

export function textoComRodape(texto: string, remetente?: RemetenteDoEmail): string {
  const quem = descreverRemetente(remetente);
  const identificacao = quem ? `\nEnviado por: ${quem}` : '';
  return `${texto}\n\n--\n${AVISO_DE_EMAIL_AUTOMATICO} HUB SNK: ${PAGINA_DO_HUB_SNK}${identificacao}`;
}

const ENTIDADES_HTML: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/* O HTML do lembrete tem layout próprio: a identificação entra antes de fechar o corpo. */
export function htmlComRemetente(html: string, remetente: RemetenteDoEmail): string {
  const quem = descreverRemetente(remetente);
  if (!quem) {
    return html;
  }
  const escapado = quem.replace(/[&<>"']/g, (caractere) => ENTIDADES_HTML[caractere] ?? caractere);
  const bloco = `<p style="margin:8px 0 0;font-size:11px;text-align:center;color:#64748b;">Enviado por: ${escapado}</p>`;
  return html.includes('</body>') ? html.replace('</body>', `${bloco}\n</body>`) : html + bloco;
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

/** Arquivo que o usuário anexou, já em memória. */
export interface AnexoDeEmail {
  nomeDoArquivo: string;
  conteudo: Buffer;
  /** Tipo MIME informado pelo navegador; vazio deixa o nodemailer deduzir pelo nome. */
  tipo: string;
}

export interface MensagemDeEmail {
  assunto: string;
  /** Sempre presente: é o corpo de quem não mostra HTML. */
  texto: string;
  html?: string;
  /** Ausente vai para o destinatário do SMTP: é o caso das notificações. */
  para?: string[];
  copia?: string[];
  copiaOculta?: string[];
  imagensEmbutidas?: ImagemEmbutida[];
  anexos?: AnexoDeEmail[];
  /** E-mail escrito pela pessoa não é automático: sai sem o rodapé do HUB SNK. */
  semRodape?: boolean;
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

function listaOuNada(enderecos: string[] | undefined): string[] | undefined {
  return enderecos?.length ? enderecos : undefined;
}

function anexosDoEnvio(mensagem: MensagemDeEmail) {
  const imagens = (mensagem.imagensEmbutidas ?? []).map((imagem) => ({
    cid: imagem.cid,
    filename: imagem.nomeDoArquivo,
    path: imagem.caminho,
  }));
  const arquivos = (mensagem.anexos ?? []).map((anexo) => ({
    filename: anexo.nomeDoArquivo,
    content: anexo.conteudo,
    contentType: anexo.tipo || undefined,
  }));
  return [...imagens, ...arquivos];
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

    const { nomeDoUsuario, empresaDoUsuario, timeDoUsuario } = await this.#configuracao.ler();
    const remetente = { nome: nomeDoUsuario, empresa: empresaDoUsuario, time: timeDoUsuario };

    const transporte = criarTransporte(smtp);
    try {
      await transporte.sendMail({
        from: smtp.remetente,
        to: listaOuNada(mensagem.para) ?? smtp.destinatario,
        cc: listaOuNada(mensagem.copia),
        bcc: listaOuNada(mensagem.copiaOculta),
        subject: mensagem.assunto,
        text: mensagem.semRodape ? mensagem.texto : textoComRodape(mensagem.texto, remetente),
        html:
          mensagem.html === undefined || mensagem.semRodape
            ? mensagem.html
            : htmlComRemetente(mensagem.html, remetente),
        attachments: anexosDoEnvio(mensagem),
      });
    } finally {
      transporte.close();
    }
  }
}
