/**
 * O e-mail que a pessoa escreve no HUB SNK, como no Gmail: corpo formatado, sem o layout
 * nem o rodapé das notificações. Regras puras, sem SMTP.
 *
 * O corpo chega como árvore de nós, e não como HTML: o editor da tela só produz as
 * marcações abaixo, e o HTML é gerado aqui, sempre escapado. Assim nada colado de
 * outra página (script, estilo, evento) chega ao e-mail.
 */
import { escaparHtml } from './emailDoLembrete.ts';
import type { AnexoDeEmail, MensagemDeEmail } from './enviadorDeEmail.ts';

export const MARCAS_DO_CORPO = ['div', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'a'] as const;

export type MarcaDoCorpo = (typeof MARCAS_DO_CORPO)[number];

/** Texto puro ou elemento; só o `a` usa o `href`. */
export type NoDoCorpo = string | { marca: MarcaDoCorpo; filhos: NoDoCorpo[]; href?: string };

/* Link que não é web nem e-mail (javascript:, file:, data:) vira só o texto. */
const ENDERECO_DE_LINK_PERMITIDO = /^(https?:|mailto:)/i;

const COR_DO_TEXTO = '#1e293b';

export interface DadosDoEmailAvulso {
  para: string[];
  copia: string[];
  copiaOculta: string[];
  assunto: string;
  corpo: NoDoCorpo[];
  anexos: AnexoDeEmail[];
}

function linkPermitido(href: string | undefined): href is string {
  return href !== undefined && ENDERECO_DE_LINK_PERMITIDO.test(href.trim());
}

function noParaHtml(no: NoDoCorpo): string {
  if (typeof no === 'string') {
    return escaparHtml(no);
  }
  if (no.marca === 'br') {
    return '<br>';
  }

  const filhos = no.filhos.map(noParaHtml).join('');
  if (no.marca !== 'a') {
    return `<${no.marca}>${filhos}</${no.marca}>`;
  }
  return linkPermitido(no.href) ? `<a href="${escaparHtml(no.href.trim())}">${filhos}</a>` : filhos;
}

export function corpoParaHtml(corpo: NoDoCorpo[]): string {
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"></head>
<body style="margin:0;font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:${COR_DO_TEXTO};">
${corpo.map(noParaHtml).join('')}
</body>
</html>`;
}

function textoDosFilhos(no: Exclude<NoDoCorpo, string>): string {
  if (no.marca === 'ul' || no.marca === 'ol') {
    const itens = no.filhos.filter((filho) => typeof filho !== 'string' && filho.marca === 'li');
    return itens
      .map((item, indice) => {
        const marcador = no.marca === 'ol' ? `${indice + 1}. ` : '• ';
        return `${marcador}${noParaTexto(item).trim()}\n`;
      })
      .join('');
  }
  return no.filhos.map(noParaTexto).join('');
}

function noParaTexto(no: NoDoCorpo): string {
  if (typeof no === 'string') {
    return no;
  }
  if (no.marca === 'br') {
    return '\n';
  }

  const texto = textoDosFilhos(no);
  if (no.marca === 'div' || no.marca === 'li') {
    return texto.endsWith('\n') ? texto : `${texto}\n`;
  }
  if (no.marca === 'a' && linkPermitido(no.href) && no.href.trim() !== texto.trim()) {
    return `${texto} (${no.href.trim()})`;
  }
  return texto;
}

/** Versão para quem não mostra HTML: listas com marcador, link com o endereço ao lado. */
export function corpoParaTexto(corpo: NoDoCorpo[]): string {
  return corpo.map(noParaTexto).join('').trimEnd();
}

export function montarEmailAvulso(dados: DadosDoEmailAvulso): MensagemDeEmail {
  return {
    assunto: dados.assunto,
    texto: corpoParaTexto(dados.corpo),
    html: corpoParaHtml(dados.corpo),
    para: dados.para,
    copia: dados.copia,
    copiaOculta: dados.copiaOculta,
    anexos: dados.anexos,
    semRodape: true,
  };
}
