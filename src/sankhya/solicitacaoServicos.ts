/**
 * Solicitação de Serviços - DS (TSDCAB) do ERP corporativo, citada no texto livre dos
 * eventos da agenda ("ID 3619" ou "DS 3619"). O shell busca pela janela oculta e devolve o JSON cru do
 * `DatasetSP.loadRecords`; aqui ele vira o que a tela mostra.
 */
import { CacheComValidade } from './cacheComValidade.ts';
import type { Credenciais } from './credenciais.ts';
import { RespostaDoSankhyaInvalidaError } from './consultasDaAgenda.ts';

/** Na agenda, só "ID" ou "DS" seguido do número conta: número solto é hora, ano, nota... */
const ID_NA_AGENDA = /\b(?:ID|DS)\s*[:#-]?\s*(\d{4,})\b/gi;
/** No texto da DS também aparecem "DS3264", "DS 3264" e "ID DSTECH 3619". */
const ID_NA_SOLICITACAO = /\b(?:ID(?:\s+DSTECH)?|DS)\s*[:#-]?\s*(\d{4,})\b/gi;

const VALIDADE_DO_CACHE_MS = 30 * 60 * 1000;

const TIPOS_DE_SOLICITACAO: Record<string, string> = {
  '1': 'Integrações',
  '2': 'Personalização e Customização',
  '3': 'Relatórios e Dashboard',
  '5': 'EDI Comercial',
  '7': 'Análise Performance',
  '8': 'Agenda Avulsa',
};
const STATUS_DO_ORCAMENTO: Record<string, string> = {
  '0': 'Orçamento Reprovado',
  '1': 'Não Iniciado',
  '2': 'Pendente Atendimento',
  '3': 'Em Orçamento',
  '4': 'Aguardando Aprovação',
  '5': 'Orçamento Aprovado',
  '7': 'Orçamento Cancelado',
  '8': 'Pendente Correção',
  B: 'Em Negociação / Cliente',
  C: 'Prazo Retorno Excedido',
};
const ORIGENS: Record<string, string> = {
  '1': 'Base',
  '2': 'Novos',
  '3': 'Projeto em Andamento',
};

const EXTENSOES_PREVISUALIZAVEIS: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

export class SolicitacaoNaoEncontradaError extends Error {}

export interface CampoDaSolicitacao {
  rotulo: string;
  valor: string;
}

export interface OcorrenciaDoHistorico {
  data: string;
  movimentacao: string;
  usuario: string;
  observacao: string;
}

export interface AnexoDaSolicitacao {
  origem: 'formulario' | 'sistema';
  nome: string;
  descricao: string;
  usuario: string;
  data: string;
  /** Só o botão de anexo tem; o campo do formulário é baixado pelo código da DS. */
  nuAttach: string;
  chave: string;
  tipo: string;
  previsualizavel: boolean;
}

export interface SolicitacaoRelacionada {
  codigo: number;
  origem: string;
}

export interface SolicitacaoDeServico {
  codigo: number;
  titulo: string;
  campos: CampoDaSolicitacao[];
  descricao: string;
  historico: OcorrenciaDoHistorico[];
  anexos: AnexoDaSolicitacao[];
  /** IDs citados na descrição e no histórico; os da agenda a tela junta. */
  relacionados: SolicitacaoRelacionada[];
  /** Quem pediu a DS, para virar contato do HUB; `null` sem solicitante. */
  solicitante: SolicitanteDaDs | null;
}

export interface SolicitanteDaDs {
  nome: string;
  cargo: string;
  email: string;
}

export interface SolicitacaoBruta {
  solicitacao: string;
  historico: string;
  anexos: string;
}

type Registro = Record<string, string>;

function extrairIds(texto: string, padrao: RegExp): number[] {
  return [...new Set([...texto.matchAll(padrao)].map((m) => Number(m[1])))];
}

export function idsCitadosNaAgenda(texto: string): number[] {
  return extrairIds(texto, ID_NA_AGENDA);
}

export function idsCitadosNaSolicitacao(texto: string): number[] {
  return extrairIds(texto, ID_NA_SOLICITACAO);
}

/** `{ fields, result }` posicional para registros por nome de campo. */
function lerRegistros(json: string): Registro[] {
  let dados: { fields?: unknown; result?: unknown };
  try {
    dados = JSON.parse(json) as typeof dados;
  } catch {
    throw new RespostaDoSankhyaInvalidaError();
  }
  if (!Array.isArray(dados.fields)) {
    throw new RespostaDoSankhyaInvalidaError();
  }
  const campos = dados.fields as string[];
  const linhas = Array.isArray(dados.result) ? (dados.result as unknown[][]) : [];
  return linhas.map((linha) =>
    Object.fromEntries(campos.map((campo, i) => [campo, String(linha[i] ?? '').trim()])),
  );
}

/** `dd/MM/yyyy HH:mm:ss` para `yyyyMMddHHmmss`, que ordena como texto. */
function ordenavel(data: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) ?(.*)$/.exec(data);
  return m ? `${m[3]}${m[2]}${m[1]}${m[4]}` : data;
}

function tipoPeloNome(nome: string): string {
  const extensao = nome.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSOES_PREVISUALIZAVEIS[extensao] ?? 'application/octet-stream';
}

function anexo(
  dados: Pick<AnexoDaSolicitacao, 'origem' | 'nome'> & Partial<AnexoDaSolicitacao>,
): AnexoDaSolicitacao {
  const tipo = tipoPeloNome(dados.nome);
  return {
    descricao: '',
    usuario: '',
    data: '',
    nuAttach: '',
    chave: '',
    ...dados,
    tipo,
    previsualizavel: tipo !== 'application/octet-stream',
  };
}

/** O campo ANEXODOC guarda `{"name":...}` do arquivo, não o arquivo. */
function anexoDoFormulario(valor: string): AnexoDaSolicitacao[] {
  if (!valor) return [];
  try {
    const nome = String((JSON.parse(valor) as { name?: unknown }).name ?? '');
    return nome ? [anexo({ origem: 'formulario', nome, descricao: 'Anexo do formulário' })] : [];
  } catch {
    return [];
  }
}

function camposVisiveis(r: Registro): CampoDaSolicitacao[] {
  const comCodigo = (codigo: string, nome: string) => (nome ? `${codigo} - ${nome}` : codigo);
  const campos: CampoDaSolicitacao[] = [
    {
      rotulo: 'Tipo',
      valor: TIPOS_DE_SOLICITACAO[r['TIPOSOLICITACAO'] ?? ''] ?? r['TIPOSOLICITACAO'] ?? '',
    },
    {
      rotulo: 'Status do orçamento',
      valor: STATUS_DO_ORCAMENTO[r['MOVORC'] ?? ''] ?? r['MOVORC'] ?? '',
    },
    { rotulo: 'Origem', valor: ORIGENS[r['ORIGBASE'] ?? ''] ?? r['ORIGBASE'] ?? '' },
    {
      rotulo: 'Parceiro',
      valor: r['CODPARC'] ? comCodigo(r['CODPARC'], r['Parceiro.NOMEPARC'] ?? '') : '',
    },
    {
      rotulo: 'Solicitante',
      valor: [[r['Usuario.NOMEUSU'], r['CARGOSOL']].filter(Boolean).join(' - '), r['Usuario.EMAIL']]
        .filter(Boolean)
        .join(' · '),
    },
    { rotulo: 'Unidade/BP', valor: r['UNIDADEBP'] ?? '' },
    { rotulo: 'Executante', valor: r['Usuario_AD001.NOMEUSU'] ?? '' },
    { rotulo: 'Orçado por', valor: r['ORCADOPOR'] ?? '' },
    { rotulo: 'Horas estimadas', valor: r['HORASESTSTR'] ?? '' },
    {
      rotulo: 'Responsável técnico (cliente)',
      valor: [r['NOMECTTTEC'], r['CONTATOTECC']].filter(Boolean).join(' - '),
    },
    { rotulo: 'Abertura', valor: r['DTABERTURA'] ?? '' },
    { rotulo: 'Aprovação', valor: r['DTAPROVACAO'] ?? '' },
    { rotulo: 'Envio do cronograma', valor: r['DTENVIOCRON'] ?? '' },
    { rotulo: 'Primeira agenda', valor: r['DTPRIAGENDA'] ?? '' },
  ];
  return campos.filter((c) => c.valor);
}

function relacionadosDoTexto(
  codigo: number,
  descricao: string,
  historico: OcorrenciaDoHistorico[],
): SolicitacaoRelacionada[] {
  const origem = `citado na DS ${codigo}`;
  const textos = [descricao, ...historico.map((h) => h.observacao)].join('\n');
  return idsCitadosNaSolicitacao(textos)
    .filter((id) => id !== codigo)
    .map((id) => ({ codigo: id, origem }));
}

export function interpretarSolicitacao(
  codigo: number,
  bruta: SolicitacaoBruta,
): SolicitacaoDeServico {
  const registro = lerRegistros(bruta.solicitacao)[0];
  if (!registro) throw new SolicitacaoNaoEncontradaError(`DS ${codigo} não encontrada.`);

  const historico = lerRegistros(bruta.historico)
    .sort((a, b) => ordenavel(b['DTGER'] ?? '').localeCompare(ordenavel(a['DTGER'] ?? '')))
    .map((h) => ({
      data: h['DTGER'] ?? '',
      movimentacao: h['MOVIMENTACAO'] ?? '',
      usuario: h['NOMEUSUMOV'] ?? '',
      observacao: h['OBSERVACAO'] ?? '',
    }));

  const anexosDoBotao = lerRegistros(bruta.anexos).map((a) =>
    anexo({
      origem: 'sistema',
      nome: a['NOMEARQUIVO'] ?? '',
      descricao: a['DESCRICAO'] ?? '',
      usuario: a['Usuario.NOMEUSU'] ?? '',
      data: a['DHCAD'] ?? '',
      nuAttach: a['NUATTACH'] ?? '',
      chave: a['CHAVEARQUIVO'] ?? '',
    }),
  );

  const descricao = registro['DESCRSOL'] ?? '';
  const parceiro = registro['Parceiro.NOMEPARC'] ?? '';
  return {
    codigo,
    titulo: parceiro ? `DS ${codigo} - ${parceiro}` : `DS ${codigo}`,
    campos: camposVisiveis(registro),
    descricao,
    historico,
    anexos: [...anexoDoFormulario(registro['ANEXODOC'] ?? ''), ...anexosDoBotao],
    relacionados: relacionadosDoTexto(codigo, descricao, historico),
    solicitante: solicitanteDaDs(registro),
  };
}

/** `EVERTON.MENDES` para `Everton Mendes`: o login é o único nome quando falta o completo. */
export function nomeDoLogin(login: string): string {
  return login
    .toLowerCase()
    .split(/[.\s_]+/)
    .filter(Boolean)
    .map((parte) => parte[0]!.toUpperCase() + parte.slice(1))
    .join(' ');
}

function solicitanteDaDs(r: Registro): SolicitanteDaDs | null {
  const nome = r['Usuario.NOMEUSUCPLT'] || nomeDoLogin(r['Usuario.NOMEUSU'] ?? '');
  if (!nome) return null;
  return { nome, cargo: r['CARGOSOL'] ?? '', email: r['Usuario.EMAIL'] ?? '' };
}

export interface PedidoDeAnexo {
  codigo: number;
  origem: 'formulario' | 'sistema';
  nomeArquivo: string;
  nuAttach?: string;
  chave?: string;
}

export interface ArquivoDoAnexo {
  conteudo: Buffer;
  tipo: string;
}

/** Busca e guarda as DS consultadas; "atualizar" na tela descarta e busca de novo. */
export class SolicitacoesDeServico {
  readonly #credenciais: Credenciais;
  readonly #cache = new CacheComValidade<number, SolicitacaoDeServico>(VALIDADE_DO_CACHE_MS);

  constructor(credenciais: Credenciais) {
    this.#credenciais = credenciais;
  }

  consultar(codigo: number, atualizar = false): Promise<SolicitacaoDeServico> {
    if (atualizar) this.#cache.descartarTudo();
    return this.#cache.obter(codigo, async () =>
      interpretarSolicitacao(codigo, await this.#credenciais.consultarSolicitacao(codigo)),
    );
  }

  async baixarAnexo(pedido: PedidoDeAnexo): Promise<ArquivoDoAnexo> {
    const { conteudo } = await this.#credenciais.baixarAnexoDaSolicitacao(pedido);
    return { conteudo: Buffer.from(conteudo, 'base64'), tipo: tipoPeloNome(pedido.nomeArquivo) };
  }
}
