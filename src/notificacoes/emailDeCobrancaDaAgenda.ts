/**
 * O e-mail que cobra a abertura da tarefa na Experience a partir do alerta "Agenda sem
 * tarefa na Experience". Mesmo layout do e-mail do lembrete, com um destaque de atenção
 * discreto. Regras puras, sem SMTP.
 */
import {
  CID_DA_LOGO,
  COR_DA_MARCA,
  COR_DO_CABECALHO,
  COR_DO_CARTAO,
  COR_DO_FUNDO,
  COR_DO_TEXTO,
  COR_DO_TEXTO_SUTIL,
  NOME_DO_ARQUIVO_DA_LOGO,
  TAMANHO_DA_LOGO_PX,
  escaparHtml,
  paragrafoComQuebras,
} from './emailDoLembrete.ts';
import {
  AVISO_DE_EMAIL_AUTOMATICO,
  PAGINA_DO_HUB_SNK,
  type MensagemDeEmail,
} from './enviadorDeEmail.ts';

/* Âmbar de aviso, não vermelho de erro: é uma cobrança, não uma falha. */
const COR_DO_ALERTA = '#b45309';
const COR_DO_FUNDO_DO_ALERTA = '#fffbeb';
const COR_DA_BORDA_DO_ALERTA = '#f59e0b';

const PEDIDO_DE_ACAO = 'Por favor, abra a tarefa na Experience para este atendimento.';

export interface DadosDoEmailDeCobrancaDaAgenda {
  /** Título da notificação: "Agenda sem tarefa na Experience". */
  titulo: string;
  /** Mensagem da notificação: parceiro, dia e horário do evento. */
  mensagem: string;
  /** Quando o alerta foi gerado, já formatado: o "hoje" da mensagem é relativo a ele. */
  geradoEm: string;
  /** Vazio quando o usuário não escreveu nada. */
  observacao: string;
  copia: string[];
  caminhoDaLogo: string;
}

function blocoDaObservacao(observacao: string): string {
  if (!observacao) {
    return '';
  }
  return `<p style="margin:16px 0 0;font-size:14px;line-height:1.55;color:${COR_DO_TEXTO};">${paragrafoComQuebras(observacao)}</p>`;
}

function montarHtml(dados: DadosDoEmailDeCobrancaDaAgenda): string {
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
          <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${COR_DO_TEXTO_SUTIL};">Alerta da agenda</p>
          <h1 style="margin:6px 0 0;font-size:20px;line-height:1.35;color:${COR_DO_TEXTO};">${escaparHtml(dados.titulo)}</h1>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 0;background:${COR_DO_FUNDO_DO_ALERTA};border-left:3px solid ${COR_DA_BORDA_DO_ALERTA};border-radius:6px;">
            <tr>
              <td style="width:28px;padding:12px 0 12px 14px;vertical-align:top;font-size:16px;line-height:1.4;color:${COR_DO_ALERTA};">&#9888;</td>
              <td style="padding:12px 14px 12px 8px;font-size:14px;line-height:1.55;color:${COR_DO_TEXTO};">${paragrafoComQuebras(dados.mensagem)}</td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:14px;line-height:1.55;color:${COR_DO_TEXTO};">${PEDIDO_DE_ACAO}</p>
          ${blocoDaObservacao(dados.observacao)}
        </td></tr>
        <tr><td style="padding:14px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:${COR_DO_TEXTO_SUTIL};">Alerta gerado em ${escaparHtml(dados.geradoEm)}</td></tr>
      </table>
      <p style="margin:12px 0 0;font-size:11px;color:${COR_DO_TEXTO_SUTIL};">${AVISO_DE_EMAIL_AUTOMATICO} <a href="${PAGINA_DO_HUB_SNK}" style="color:${COR_DO_TEXTO_SUTIL};text-decoration:underline;">HUB SNK</a>.</p>
    </td></tr>
  </table>
</body>
</html>`;
}

function montarTexto(dados: DadosDoEmailDeCobrancaDaAgenda): string {
  const linhas = [dados.titulo, '', dados.mensagem, '', PEDIDO_DE_ACAO];
  if (dados.observacao) linhas.push('', dados.observacao);
  linhas.push('', `Alerta gerado em ${dados.geradoEm}`);
  return linhas.join('\n');
}

export function montarEmailDeCobrancaDaAgenda(
  dados: DadosDoEmailDeCobrancaDaAgenda,
): MensagemDeEmail {
  return {
    assunto: `[HUB SNK] Atenção - ${dados.titulo}`,
    texto: montarTexto(dados),
    html: montarHtml(dados),
    copia: dados.copia,
    imagensEmbutidas: [
      { cid: CID_DA_LOGO, nomeDoArquivo: NOME_DO_ARQUIVO_DA_LOGO, caminho: dados.caminhoDaLogo },
    ],
  };
}
