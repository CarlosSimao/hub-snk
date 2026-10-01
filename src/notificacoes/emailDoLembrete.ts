/**
 * O e-mail de um lembrete: assunto, corpo em HTML com a logo do HUB SNK e a versão em
 * texto puro, para o cliente de e-mail que não mostra HTML. Regras puras, sem SMTP.
 */
import type { MensagemDeEmail } from './enviadorDeEmail.ts';

/* O `cid` liga a imagem anexada ao `<img>` do corpo: a logo não depende de internet. */
const CID_DA_LOGO = 'logo-hub-snk';
const NOME_DO_ARQUIVO_DA_LOGO = 'hub-snk.png';
const TAMANHO_DA_LOGO_PX = 40;

/* As cores do painel, fixas: e-mail não lê variável de CSS. */
const COR_DA_MARCA = '#66cb66';
const COR_DO_FUNDO = '#f1f5f9';
const COR_DO_CARTAO = '#ffffff';
const COR_DO_CABECALHO = '#131c30';
const COR_DO_TEXTO = '#1e293b';
const COR_DO_TEXTO_SUTIL = '#64748b';
const COR_DO_ATRASO = '#b45309';

/* Quem recebe em cópia pode não conhecer o HUB SNK: o rodapé diz de onde veio o e-mail. */
const PAGINA_DO_HUB_SNK = 'https://carlossimao.github.io/hub-snk/';
const AVISO_DE_EMAIL_AUTOMATICO = 'Este é um e-mail automático enviado pela ferramenta';

export interface DadosDoEmailDoLembrete {
  resumo: string;
  /** Vazio no lembrete antigo, em que o texto já é o resumo. */
  texto: string;
  /** "Cliente › Projeto", "Cliente" ou vazio. */
  vinculo: string;
  /** Horário previsto da ocorrência, já formatado. */
  previstoPara: string;
  atrasado: boolean;
  /** E-mails dos contatos, que vão em cópia. */
  copia: string[];
  caminhoDaLogo: string;
}

const ENTIDADES_HTML: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Texto digitado pelo usuário vira texto no HTML, nunca marcação. */
function escaparHtml(valor: string): string {
  return valor.replace(/[&<>"']/g, (caractere) => ENTIDADES_HTML[caractere] ?? caractere);
}

/* A quebra de linha digitada no lembrete é mantida no corpo. */
function paragrafoComQuebras(valor: string): string {
  return escaparHtml(valor).replace(/\r?\n/g, '<br>');
}

function linhaDoRodape(dados: DadosDoEmailDoLembrete): string {
  const partes = [dados.vinculo, `Previsto para ${dados.previstoPara}`].filter(Boolean);
  return partes.map(escaparHtml).join(' &nbsp;·&nbsp; ');
}

function montarHtml(dados: DadosDoEmailDoLembrete): string {
  const texto = dados.texto
    ? `<p style="margin:12px 0 0;font-size:14px;line-height:1.55;color:${COR_DO_TEXTO_SUTIL};">${paragrafoComQuebras(dados.texto)}</p>`
    : '';
  const atraso = dados.atrasado
    ? `<p style="margin:16px 0 0;font-size:12px;color:${COR_DO_ATRASO};">Este lembrete disparou depois do horário previsto.</p>`
    : '';

  return `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:${COR_DO_FUNDO};font-family:Segoe UI,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COR_DO_FUNDO};padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${COR_DO_CARTAO};border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr><td style="background:${COR_DO_CABECALHO};padding:16px 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;"><img src="cid:${CID_DA_LOGO}" width="${TAMANHO_DA_LOGO_PX}" height="${TAMANHO_DA_LOGO_PX}" alt="HUB SNK" style="display:block;border-radius:8px;"></td>
            <td style="vertical-align:middle;padding-left:12px;font-size:16px;font-weight:600;color:#e8eefc;">HUB SNK</td>
          </tr></table>
        </td></tr>
        <tr><td style="height:4px;background:${COR_DA_MARCA};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:24px;">
          <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${COR_DO_TEXTO_SUTIL};">Lembrete</p>
          <h1 style="margin:6px 0 0;font-size:20px;line-height:1.35;color:${COR_DO_TEXTO};">${escaparHtml(dados.resumo)}</h1>
          ${texto}
          ${atraso}
        </td></tr>
        <tr><td style="padding:14px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:${COR_DO_TEXTO_SUTIL};">${linhaDoRodape(dados)}</td></tr>
      </table>
      <p style="margin:12px 0 0;font-size:11px;color:${COR_DO_TEXTO_SUTIL};">${AVISO_DE_EMAIL_AUTOMATICO} <a href="${PAGINA_DO_HUB_SNK}" style="color:${COR_DO_TEXTO_SUTIL};text-decoration:underline;">HUB SNK</a>.</p>
    </td></tr>
  </table>
</body>
</html>`;
}

function montarTexto(dados: DadosDoEmailDoLembrete): string {
  const linhas = [dados.resumo];
  if (dados.texto) linhas.push('', dados.texto);
  if (dados.atrasado) linhas.push('', 'Disparou depois do horário previsto.');
  linhas.push('', ...[dados.vinculo, `Previsto para ${dados.previstoPara}`].filter(Boolean));
  linhas.push('', '--', `${AVISO_DE_EMAIL_AUTOMATICO} HUB SNK: ${PAGINA_DO_HUB_SNK}`);
  return linhas.join('\n');
}

export function montarEmailDoLembrete(dados: DadosDoEmailDoLembrete): MensagemDeEmail {
  return {
    assunto: `[HUB SNK] Lembrete - ${dados.resumo}`,
    texto: montarTexto(dados),
    html: montarHtml(dados),
    copia: dados.copia,
    imagensEmbutidas: [
      { cid: CID_DA_LOGO, nomeDoArquivo: NOME_DO_ARQUIVO_DA_LOGO, caminho: dados.caminhoDaLogo },
    ],
  };
}
