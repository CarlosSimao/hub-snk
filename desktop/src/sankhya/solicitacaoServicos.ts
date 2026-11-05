/**
 * Solicitação de Serviços - DS (tabela TSDCAB, entidade `SolicitacaoServicos`) do ERP
 * corporativo, pela janela oculta: o registro, o histórico (TSDLOGCAB) e os anexos. Os
 * corpos são os mesmos que a tela do Sankhya manda (capturados em HAR em 2026-11-05).
 *
 * Aqui só se busca: o JSON volta em texto e quem interpreta é o backend
 * (`src/sankhya/solicitacaoServicos.ts`), onde há testes.
 */
import type { ResultadoFetch } from './janelaAgendaOculta';
import { servico, type Chamar, type Resultado } from './ocorrencias';

type Baixar = (caminho: string) => Promise<ResultadoFetch>;

const RESOURCE_ID = 'solicitacaoservicos.br.com.sankhya.servicosds.solicitacaoservicos';
/** Sem o `resourceID` da tela o Sankhya pode negar o serviço para a sessão. */
const CONSULTA_DA_TELA = { application: 'SolicitacaoServicos', resourceID: RESOURCE_ID };
const CLIENT_EVENT = {
  clientEventList: { clientEvent: [{ $: 'br.com.sankhya.actionbutton.clientconfirm' }] },
};

export const CAMPOS_DA_SOLICITACAO = [
  'CODIGO',
  'TIPOSOLICITACAO',
  'MOVORC',
  'CODPARC',
  'Parceiro.NOMEPARC',
  'ORIGBASE',
  'CODUSU',
  'Usuario.NOMEUSU',
  'CARGOSOL',
  'UNIDADEBP',
  'CODUSUEXEC',
  'Usuario_AD001.NOMEUSU',
  'ORCADOPOR',
  'HORASESTSTR',
  'NOMECTTTEC',
  'CONTATOTECC',
  'DTABERTURA',
  'DTAPROVACAO',
  'DTENVIOCRON',
  'DTPRIAGENDA',
  'ANEXODOC',
  'DESCRSOL',
];
export const CAMPOS_DO_HISTORICO = [
  'SEQUENCIA',
  'DTGER',
  'MOVIMENTACAO',
  'NOMEUSUMOV',
  'OBSERVACAO',
];
export const CAMPOS_DO_ANEXO = [
  'NUATTACH',
  'NOMEARQUIVO',
  'CHAVEARQUIVO',
  'DESCRICAO',
  'Usuario.NOMEUSU',
  'DHCAD',
];

/** O JSON de cada uma das três consultas, em texto: `{ fields, total, result }`. */
export interface SolicitacaoBruta {
  solicitacao: string;
  historico: string;
  anexos: string;
}

function carregar(
  entityName: string,
  fields: string[],
  criteria: unknown,
  extras = {},
): { fields: string[] } & Record<string, unknown> {
  return {
    entityName,
    standAlone: false,
    fields,
    tryJoinedFields: true,
    criteria,
    ignoreListenerMethods: '',
    useDefaultRowsLimit: true,
    ...extras,
    ...CLIENT_EVENT,
  };
}

/** O `result` é posicional: os `fields` vão junto para o backend ler por nome. */
async function consultar(chamar: Chamar, corpo: { fields: string[] }): Promise<Resultado<string>> {
  const r = await servico(chamar, 'DatasetSP.loadRecords', corpo, CONSULTA_DA_TELA);
  if (!r.ok) return { ok: false, erro: r.erro };
  const resposta = (r.corpo?.responseBody ?? {}) as Record<string, unknown>;
  return { ok: true, corpo: JSON.stringify({ ...resposta, fields: corpo.fields }) };
}

export async function consultarSolicitacao(
  chamar: Chamar,
  codigo: number,
): Promise<Resultado<SolicitacaoBruta>> {
  const solicitacao = await consultar(
    chamar,
    carregar('SolicitacaoServicos', CAMPOS_DA_SOLICITACAO, {
      expression: 'this.CODIGO = ?',
      parameters: [{ type: 'N', value: codigo }],
    }),
  );
  if (!solicitacao.ok) return { ok: false, erro: solicitacao.erro };

  const historico = await consultar(
    chamar,
    carregar(
      'SolicitacaoServicosLog',
      CAMPOS_DO_HISTORICO,
      { expression: 'this.CODIGO = ?', parameters: [{ type: 'N', value: codigo }] },
      { parentEntityName: 'SolicitacaoServicos' },
    ),
  );
  if (!historico.ok) return { ok: false, erro: historico.erro };

  // O mesmo critério da tela: anexos globais, ou locais da própria tela.
  const anexos = await consultar(
    chamar,
    carregar(
      'AnexoSistema',
      CAMPOS_DO_ANEXO,
      {
        expression:
          "((this.PKREGISTRO = ? AND this.NOMEINSTANCIA = ?) AND ((this.TIPOAPRES = 'GLO') OR (this.TIPOAPRES = 'LOC' AND this.RESOURCEID = ?)))",
        parameters: [
          { type: 'S', value: `${codigo}_SolicitacaoServicos` },
          { type: 'S', value: 'SolicitacaoServicos' },
          { type: 'S', value: RESOURCE_ID },
        ],
      },
      { crudListener: 'br.com.sankhya.modelcore.crudlisteners.AnexoSistemaCrudListener' },
    ),
  );
  if (!anexos.ok) return { ok: false, erro: anexos.erro };

  return {
    ok: true,
    corpo: { solicitacao: solicitacao.corpo!, historico: historico.corpo!, anexos: anexos.corpo! },
  };
}

export interface AnexoDoSistema {
  codigo: number;
  nuAttach: string;
  nomeArquivo: string;
  chave: string;
}

/**
 * Botão de anexo: o `baixar` devolve uma chave temporária, e o arquivo sai do visualizador.
 * Sem `download=S` o visualizador responde a página HTML dele, não o arquivo.
 */
export async function baixarAnexoDoSistema(
  chamar: Chamar,
  baixar: Baixar,
  anexo: AnexoDoSistema,
): Promise<ResultadoFetch> {
  const r = await servico(
    chamar,
    'AnexoSistemaSP.baixar',
    {
      paramsDown: {
        nuAttach: anexo.nuAttach,
        pkEntity: String(anexo.codigo),
        nameEntity: 'SolicitacaoServicos',
        nameAttach: anexo.nomeArquivo,
        keyAttach: anexo.chave,
      },
      ...CLIENT_EVENT,
    },
    CONSULTA_DA_TELA,
  );
  if (!r.ok) return { ok: false, erro: r.erro };
  const chave = (r.corpo?.responseBody as { chave?: { valor?: unknown } } | undefined)?.chave
    ?.valor;
  if (typeof chave !== 'string' || !chave) {
    return { ok: false, erro: 'o Sankhya não devolveu a chave do anexo' };
  }
  return baixar(
    `/mge/visualizadorArquivos.mge?hidemail=S&download=S&chaveArquivo=${encodeURIComponent(chave)}`,
  );
}

/** Campo "Anexo" (ANEXODOC) do formulário: o mesmo link que a tela abre. */
export function baixarAnexoDoFormulario(
  baixar: Baixar,
  codigo: number,
  nomeArquivo: string,
): Promise<ResultadoFetch> {
  const consulta = new URLSearchParams({
    fileName: 'sab://ANEXODOC',
    downloadFileName: nomeArquivo,
    pkValues: JSON.stringify({ CODIGO: String(codigo) }),
    tableName: 'TSDCAB',
  });
  return baixar(`/mge/download.mge?${consulta.toString()}`);
}
