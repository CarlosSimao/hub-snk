/**
 * Solicitação de Serviços DS do corporativo, lida de dentro da aba ERP logada.
 *
 * Medido em 2026-09-28 no skw.sankhya.com.br:
 *  - entidade `SolicitacaoServicos` (TSDCAB), chave `CODIGO` — o mesmo número que a
 *    Agenda de Recursos traz no texto do evento ("TECH | ID 2996 - ...");
 *  - `CRUDServiceProvider.loadRecords` OMITE o campo de arquivo `ANEXODOC`; o
 *    `DatasetSP.loadRecords` que a própria tela usa devolve o campo como JSON
 *    `{name,size,type}`. Critério com `parameters` tipados dá NPE no servidor, por isso
 *    os códigos vão literais na expressão (só inteiros, validados aqui);
 *  - os anexos do botão "Anexo" ficam em `AnexoSistema`, com `PKREGISTRO` no formato
 *    `<CODIGO>_SolicitacaoServicos`.
 *
 * Só leitura. Os downloads voltam em base64 para o backend, que entrega à tela.
 */
import type { WebContents, WebContentsView } from 'electron';
import { carregarRegistros, chamarNaAba } from './chamarNaAba';
import { DOMINIOS_ERP } from './config';

const ENTIDADE = 'SolicitacaoServicos';
const CAMPOS = [
  'CODIGO',
  'CODPARC',
  'DESCRSOL',
  'HORASESTSTR',
  'MOVORC',
  'TIPOSOLICITACAO',
  'DTABERTURA',
  'DTAPROVACAO',
  'ANEXODOC',
] as const;

/** Teto de códigos por consulta: a expressão vai literal, e ninguém tem 200 demandas. */
const MAX_CODIGOS = 200;
/** Teto de download: um anexo maior que isso não cabe bem em base64 pelo canal local. */
const MAX_BYTES_ARQUIVO = 60 * 1024 * 1024;

export interface SolicitacaoBruta {
  codigo: number;
  codparc: number | null;
  descricao: string;
  horasEstimadas: number | null;
  statusOrcamento: string;
  tipo: string;
  dtAbertura: string;
  dtAprovacao: string;
  /** Arquivo do campo "Anexo" da tela; vazio quando não há. */
  anexoNome: string;
  anexoTamanho: number | null;
  anexoTipo: string;
}

export interface AnexoBruto {
  nuAttach: number;
  codigo: number;
  nome: string;
  descricao: string;
  link: string;
  dhCad: string;
}

export interface ResultadoSolicitacoes {
  ok: boolean;
  solicitacoes?: SolicitacaoBruta[];
  anexos?: AnexoBruto[];
  erro?: string;
  expirou?: boolean;
}

export interface ArquivoBaixado {
  ok: boolean;
  nome?: string;
  tipo?: string;
  base64?: string;
  erro?: string;
  expirou?: boolean;
}

function codigosValidos(codigos: unknown[]): number[] {
  const unicos = new Set<number>();
  for (const c of codigos) {
    const n = Number(c);
    if (Number.isInteger(n) && n > 0) unicos.add(n);
  }
  return [...unicos].slice(0, MAX_CODIGOS);
}

function numeroOuNulo(valor: string): number | null {
  const n = Number(String(valor ?? '').replace(',', '.'));
  return valor !== '' && Number.isFinite(n) ? n : null;
}

/** O campo de arquivo vem como JSON em texto; qualquer outra coisa é "sem arquivo". */
function lerArquivoDoCampo(valor: string): { nome: string; tamanho: number | null; tipo: string } {
  try {
    const j = JSON.parse(valor) as { name?: unknown; size?: unknown; type?: unknown };
    if (typeof j.name === 'string' && j.name) {
      return { nome: j.name, tamanho: numeroOuNulo(String(j.size ?? '')), tipo: String(j.type ?? '') };
    }
  } catch {
    /* campo vazio */
  }
  return { nome: '', tamanho: null, tipo: '' };
}

async function lerSolicitacoes(wc: WebContents, codigos: number[]): Promise<ResultadoSolicitacoes> {
  const r = await chamarNaAba<{ result?: unknown[][] }>(wc, 'DatasetSP.loadRecords', {
    dataSetID: 'hub',
    entityName: ENTIDADE,
    standAlone: false,
    fields: CAMPOS,
    tryJoinedFields: true,
    parallelLoader: true,
    criteria: { expression: `this.CODIGO IN (${codigos.join(', ')})`, parameters: [] },
    ignoreListenerMethods: '',
    useDefaultRowsLimit: false,
  });
  if (!r.ok) return { ok: false, erro: r.erro, expirou: r.expirou };

  const solicitacoes = (r.corpo?.result ?? []).map((linha) => {
    const v = (campo: (typeof CAMPOS)[number]) => String(linha[CAMPOS.indexOf(campo)] ?? '');
    const arquivo = lerArquivoDoCampo(v('ANEXODOC'));
    return {
      codigo: Number(v('CODIGO')),
      codparc: numeroOuNulo(v('CODPARC')),
      descricao: v('DESCRSOL'),
      horasEstimadas: numeroOuNulo(v('HORASESTSTR')),
      statusOrcamento: v('MOVORC'),
      tipo: v('TIPOSOLICITACAO'),
      dtAbertura: v('DTABERTURA'),
      dtAprovacao: v('DTAPROVACAO'),
      anexoNome: arquivo.nome,
      anexoTamanho: arquivo.tamanho,
      anexoTipo: arquivo.tipo,
    };
  });
  return { ok: true, solicitacoes };
}

async function lerAnexos(wc: WebContents, codigos: number[], nuAttach?: number) {
  const chaves = codigos.map((c) => `'${c}_${ENTIDADE}'`).join(', ');
  const filtroAnexo = nuAttach ? ` AND this.NUATTACH = ${nuAttach}` : '';
  return carregarRegistros(
    wc,
    'AnexoSistema',
    'NUATTACH,PKREGISTRO,NOMEARQUIVO,DESCRICAO,CHAVEARQUIVO,LINK,DHCAD',
    `this.NOMEINSTANCIA = '${ENTIDADE}' AND this.PKREGISTRO IN (${chaves})${filtroAnexo}`,
  );
}

async function buscar(wc: WebContents, codigosBrutos: unknown[]): Promise<ResultadoSolicitacoes> {
  const codigos = codigosValidos(codigosBrutos);
  if (!codigos.length) return { ok: true, solicitacoes: [], anexos: [] };

  const sol = await lerSolicitacoes(wc, codigos);
  if (!sol.ok) return sol;

  const anx = await lerAnexos(wc, codigos);
  if (!anx.ok) return { ok: false, erro: anx.erro, expirou: anx.expirou };

  const anexos = (anx.corpo ?? []).map((a) => ({
    nuAttach: Number(a['NUATTACH']),
    codigo: Number(String(a['PKREGISTRO'] ?? '').split('_')[0]),
    nome: a['NOMEARQUIVO'] ?? '',
    descricao: a['DESCRICAO'] ?? '',
    link: a['LINK'] ?? '',
    dhCad: a['DHCAD'] ?? '',
  }));
  return { ok: true, solicitacoes: sol.solicitacoes, anexos };
}

/** Baixa pela página, com os cookies dela, e devolve em base64. */
async function baixarNaPagina(wc: WebContents, url: string): Promise<ArquivoBaixado> {
  const script = `(async () => {
    try {
      const r = await fetch(${JSON.stringify(url)}, { credentials: 'same-origin' });
      const tipo = (r.headers.get('content-type') || '').split(';')[0];
      if (!r.ok) return { ok: false, erro: 'HTTP ' + r.status };
      if (tipo === 'text/html') return { ok: false, expirou: true, erro: 'o ERP devolveu uma página em vez do arquivo — sessão caída?' };
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.length > ${MAX_BYTES_ARQUIVO}) return { ok: false, erro: 'arquivo grande demais para trazer pelo DS' };
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return { ok: true, tipo: tipo, base64: btoa(bin) };
    } catch (e) {
      return { ok: false, erro: String(e) };
    }
  })()`;
  return (await wc.executeJavaScript(script, true)) as ArquivoBaixado;
}

/**
 * Um arquivo da solicitação: sem `nuAttach`, o do campo "Anexo"; com, um dos anexos.
 *
 * Nome, chave e registro saem de uma leitura nova no ERP, e não do pedido: quem chama
 * só aponta QUAL arquivo, nunca monta a URL de download.
 */
async function baixar(wc: WebContents, codigoBruto: unknown, nuAttachBruto?: unknown): Promise<ArquivoBaixado> {
  const [codigo] = codigosValidos([codigoBruto]);
  if (!codigo) return { ok: false, erro: 'código da solicitação inválido' };

  if (nuAttachBruto === undefined || nuAttachBruto === null || nuAttachBruto === '') {
    const sol = await lerSolicitacoes(wc, [codigo]);
    if (!sol.ok) return { ok: false, erro: sol.erro, expirou: sol.expirou };
    const nome = sol.solicitacoes?.[0]?.anexoNome;
    if (!nome) return { ok: false, erro: 'a solicitação não tem arquivo no campo Anexo' };
    const busca = new URLSearchParams({
      fileName: 'sab://ANEXODOC',
      downloadFileName: nome,
      pkValues: JSON.stringify({ CODIGO: codigo }),
      tableName: 'TSDCAB',
    });
    const r = await baixarNaPagina(wc, `/mge/download.mge?${busca}`);
    return r.ok ? { ...r, nome, tipo: sol.solicitacoes?.[0]?.anexoTipo || r.tipo } : r;
  }

  const nuAttach = Number(nuAttachBruto);
  if (!Number.isInteger(nuAttach) || nuAttach <= 0) return { ok: false, erro: 'anexo inválido' };
  const anx = await lerAnexos(wc, [codigo], nuAttach);
  if (!anx.ok) return { ok: false, erro: anx.erro, expirou: anx.expirou };
  const anexo = anx.corpo?.[0];
  if (!anexo) return { ok: false, erro: 'anexo não encontrado nesta solicitação' };
  if (anexo['LINK']) return { ok: false, erro: 'este anexo é um link, não um arquivo' };

  // A chave de `CHAVEARQUIVO` não abre o visualizador direto (devolve HTML); a tela do
  // ERP pede uma chave de download ao `AnexoSistemaSP.baixar` e é essa que serve.
  const chave = await chamarNaAba<{ chave?: { valor?: string } }>(wc, 'AnexoSistemaSP.baixar', {
    paramsDown: {
      nuAttach: String(nuAttach),
      pkEntity: `${codigo}_${ENTIDADE}`,
      nameEntity: ENTIDADE,
      nameAttach: anexo['NOMEARQUIVO'] ?? '',
      keyAttach: anexo['CHAVEARQUIVO'] ?? '',
    },
  });
  if (!chave.ok) return { ok: false, erro: chave.erro, expirou: chave.expirou };
  const valor = chave.corpo?.chave?.valor;
  if (!valor) return { ok: false, erro: 'o ERP não devolveu a chave de download do anexo' };

  const busca = new URLSearchParams({ chaveArquivo: valor, forcarDownload: 'S' });
  const r = await baixarNaPagina(wc, `/mge/visualizadorArquivos.mge?${busca}`);
  return r.ok ? { ...r, nome: anexo['NOMEARQUIVO'] ?? `anexo-${nuAttach}` } : r;
}

export class SolicitacoesFetcher {
  constructor(private readonly obterAbaErp: () => WebContentsView | undefined) {}

  /** A aba ERP, só se ela está no corporativo — nunca rodar a leitura em outra origem. */
  #aba(): { wc: WebContents } | { erro: string } {
    const wc = this.obterAbaErp()?.webContents;
    if (!wc) return { erro: 'aba ERP não existe' };
    let host = '';
    try {
      host = new URL(wc.getURL()).hostname;
    } catch {
      /* URL vazia */
    }
    if (!DOMINIOS_ERP.some((d) => host === d || host.endsWith(`.${d}`))) {
      return { erro: 'aba ERP não está no Sankhya — faça login nela' };
    }
    return { wc };
  }

  async buscar(codigos: unknown[]): Promise<ResultadoSolicitacoes> {
    const aba = this.#aba();
    if ('erro' in aba) return { ok: false, erro: aba.erro };
    return buscar(aba.wc, codigos);
  }

  async baixar(codigo: unknown, nuAttach?: unknown): Promise<ArquivoBaixado> {
    const aba = this.#aba();
    if ('erro' in aba) return { ok: false, erro: aba.erro };
    return baixar(aba.wc, codigo, nuAttach);
  }
}
