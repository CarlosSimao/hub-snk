/**
 * Ocorrência de agenda (ausência do consultor: férias, folga, atestado...) no ERP
 * corporativo, tabela `AD_OCOAGE`, pelo mesmo botão de ação da tela do Sankhya — ver
 * docs/specs/ocorrencia-agenda-erp.md (mapeado ao vivo em 2026-10-01).
 *
 * Gravar pelo botão "Criar ocorrência" (1459), e não direto na tabela, mantém as
 * validações da procedure (sobreposição, permissão). O `__ESCOLHA_SIMNAO__ = S` responde
 * já na primeira chamada o "Confirma?" do ERP: a confirmação é feita na tela do hub.
 *
 * Só o usuário logado na janela oculta: o CODUSU sai de `STP_GET_CODUSULOGADO` (função do
 * Sankhya que lê a sessão), nunca do pedido.
 */
import type { ResultadoFetch } from './janelaAgendaOculta';

type Chamar = (serviceName: string, requestBody: unknown) => Promise<ResultadoFetch>;

const BOTAO_CRIAR = { actionID: '1459', procName: 'STP_BTN_CRIA_OCOAGE_SNK' };
const CONFIRMA = { type: 'S', sequence: '1', paramName: '__ESCOLHA_SIMNAO__', $: 'S' };
const DATA_HORA = /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/;

export interface Resultado<T> {
  ok: boolean;
  corpo?: T;
  erro?: string;
}

export interface UsuarioLogado {
  codusu: number;
  nomeusu: string;
}

export interface NovaOcorrencia {
  /** `dd/MM/yyyy HH:mm:ss`. */
  dtInicial: string;
  dtFinal: string;
  motivo: string;
  /** CODUSU configurado no hub; a sessão do ERP tem que ser dele. `null` não confere. */
  codusuEsperado: number | null;
}

/** O `statusMessage` às vezes vem em base64 (latin1); texto puro passa como está. */
function mensagemSankhya(m: unknown): string {
  const texto = typeof m === 'string' ? m.trim() : '';
  if (/^[A-Za-z0-9+/=\s]+$/.test(texto) && texto.replace(/\s/g, '').length % 4 === 0) {
    const decodificado = Buffer.from(texto, 'base64').toString('latin1');
    // Palavra solta como "Erro" também casa com o alfabeto do base64.
    if (decodificado && !/[\x00-\x08\x0e-\x1f]/.test(decodificado)) return decodificado;
  }
  return texto;
}

/** `1` e `2` são sucesso; `0` erro, `3` sessão caída, `4` concorrência ou confirmação. */
async function servico(
  chamar: Chamar,
  nome: string,
  requestBody: unknown,
): Promise<Resultado<{ responseBody?: unknown; mensagem: string }>> {
  const r = await chamar(nome, requestBody);
  if (!r.ok) return { ok: false, erro: r.erro };
  let j: { status?: unknown; statusMessage?: unknown; responseBody?: unknown };
  try {
    j = JSON.parse(r.conteudo ?? '') as typeof j;
  } catch {
    return { ok: false, erro: 'o Sankhya respondeu algo que não é JSON' };
  }
  const status = String(j.status);
  const mensagem = mensagemSankhya(j.statusMessage);
  if (status === '1' || status === '2')
    return { ok: true, corpo: { responseBody: j.responseBody, mensagem } };
  if (status === '3') return { ok: false, erro: 'a sessão do Sankhya expirou — tente de novo' };
  return { ok: false, erro: mensagem || `o Sankhya recusou (status ${status})` };
}

type Campo = { $?: string } | undefined;

export async function usuarioLogado(chamar: Chamar): Promise<Resultado<UsuarioLogado>> {
  const r = await servico(chamar, 'CRUDServiceProvider.loadRecords', {
    dataSet: {
      rootEntity: 'Usuario',
      includePresentationFields: 'N',
      offsetPage: '0',
      criteria: { expression: { $: 'this.CODUSU = STP_GET_CODUSULOGADO' } },
      entity: { fieldset: { list: 'CODUSU,NOMEUSU' } },
    },
  });
  if (!r.ok) return { ok: false, erro: r.erro };
  // Objeto em vez de array quando há um registro só; campos `f0, f1` na ordem pedida.
  const bruto = (r.corpo?.responseBody as { entities?: { entity?: unknown } } | undefined)?.entities
    ?.entity;
  const reg = (Array.isArray(bruto) ? bruto[0] : bruto) as Record<string, Campo> | undefined;
  const codusu = Number(reg?.['f0']?.$);
  if (!Number.isInteger(codusu) || codusu <= 0) {
    return { ok: false, erro: 'não consegui identificar o usuário logado no ERP' };
  }
  return { ok: true, corpo: { codusu, nomeusu: String(reg?.['f1']?.$ ?? '') } };
}

/** Devolve a mensagem de sucesso do ERP. Confirme com o usuário ANTES de chamar. */
export async function criarOcorrencia(
  chamar: Chamar,
  nova: NovaOcorrencia,
): Promise<Resultado<string>> {
  if (!DATA_HORA.test(nova.dtInicial) || !DATA_HORA.test(nova.dtFinal)) {
    return { ok: false, erro: 'datas no formato dd/MM/yyyy HH:mm:ss' };
  }
  if (!/^\d{1,3}$/.test(nova.motivo)) return { ok: false, erro: 'motivo inválido' };

  const usuario = await usuarioLogado(chamar);
  if (!usuario.ok || !usuario.corpo) return { ok: false, erro: usuario.erro };
  const { codusu, nomeusu } = usuario.corpo;
  if (nova.codusuEsperado !== null && codusu !== nova.codusuEsperado) {
    return {
      ok: false,
      erro:
        `o login salvo do SankhyaOm é de ${nomeusu} (${codusu}), mas o seu código de usuário ` +
        `configurado é ${nova.codusuEsperado} — a ocorrência só pode ser lançada para você mesmo. ` +
        'Confira o Sankhya ID.',
    };
  }

  const r = await servico(chamar, 'ActionButtonsSP.executeSTP', {
    stpCall: {
      ...BOTAO_CRIAR,
      rootEntity: 'AD_OCOAGE',
      refreshType: 'ALL',
      params: {
        param: [
          // A tela manda o CODUSU como texto; o botão não recebe OBSERVACAO.
          { type: 'S', paramName: 'CODUSU', $: String(codusu) },
          { type: 'D', paramName: 'DTINICIAL', $: nova.dtInicial },
          { type: 'D', paramName: 'DTFINAL', $: nova.dtFinal },
          { type: 'S', paramName: 'MOTIVO', $: nova.motivo },
          CONFIRMA,
        ],
      },
    },
    clientEventList: { clientEvent: [{ $: 'br.com.sankhya.actionbutton.clientconfirm' }] },
  });
  if (!r.ok) return { ok: false, erro: r.erro };
  return { ok: true, corpo: r.corpo?.mensagem || 'Ocorrência criada.' };
}
