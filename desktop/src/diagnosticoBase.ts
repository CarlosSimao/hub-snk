/**
 * Diagnóstico de uma base de cliente: o que está instalado e configurado nela, lido de
 * DENTRO da aba logada (`chamarNaAba.ts`) — sem acesso ao servidor do cliente, e só o que o
 * usuário logado já pode ver (a ACL do Sankhya vale).
 *
 *  - módulos Java adicionais (`ModuloAdicional`);
 *  - botões de ação (`BotaoAcao`, TSIBTA) — tipo e, para Rotina Java, a classe;
 *  - parâmetros do sistema (`ParametroSistema`, TSIPAR) — SÓ as chaves pedidas.
 *
 * Parâmetro de texto pode guardar segredo (senha de integração, token). Por isso não há
 * "listar todos": vêm só as chaves que o usuário digitou, e o valor sai mascarado quando a
 * chave ou a descrição falam em senha/token/segredo.
 */
import type { WebContents } from 'electron';
import { carregarRegistros } from './chamarNaAba';

export interface ModuloBase {
  cod: string;
  resourceId: string;
  descricao: string;
}

export interface BotaoBase {
  id: string;
  descricao: string;
  /** `LC` Lançador, `RJ` Rotina Java, `SC` Script, `SP` Rotina no banco (dicionário TSIBTA). */
  tipo: string;
  instancia: string;
  codModulo: string;
  /** Só para `RJ`: a classe Java do botão, extraída do CONFIG. */
  classe: string;
}

export interface ParametroBase {
  chave: string;
  descricao: string;
  tipo: string;
  valor: string;
  mascarado: boolean;
}

export interface DiagnosticoBase {
  ok: boolean;
  erro?: string;
  expirou?: boolean;
  modulos: ModuloBase[];
  botoes: BotaoBase[];
  parametros: ParametroBase[];
  /** Chaves pedidas que não existem na base (ou que o usuário não enxerga). */
  parametrosAusentes: string[];
}

const SEGREDO = /senha|password|passwd|token|secret|segredo|api.?key|chave.?api|credencial/i;

/**
 * Campo do valor por TIPO — medido em TSIPAR (2026-09-25): I=INTEIRO, F=NUMDEC,
 * D=DATA, T=TEXTO, L=LOGICO; C (lista) grava em TEXTO ou INTEIRO.
 */
function valorDoParametro(p: Record<string, string>): string {
  switch (p['TIPO']) {
    case 'L':
      return p['LOGICO'] === 'S' ? 'Sim' : 'Não';
    case 'I':
      return p['INTEIRO'] ?? '';
    case 'F':
      return p['NUMDEC'] ?? '';
    case 'D':
      return p['DATA'] ?? '';
    case 'C':
      return p['TEXTO'] || p['INTEIRO'] || '';
    default:
      return p['TEXTO'] ?? '';
  }
}

/** Chaves digitadas ("A, B C") -> lista em maiúsculo, só com os caracteres de chave. */
export function chavesPedidas(texto: string): string[] {
  return [
    ...new Set(
      texto
        .split(/[\s,;]+/)
        .map((c) => c.trim().toUpperCase())
        .filter((c) => /^[A-Z0-9_.#@$]{1,15}$/.test(c)),
    ),
  ].slice(0, 50);
}

function classeDoBotao(config: string): string {
  let xml = '';
  try {
    xml = Buffer.from(config.replace(/\s/g, ''), 'base64').toString('latin1');
  } catch {
    return '';
  }
  return /className\s*=\s*["']([^"']+)["']/.exec(xml)?.[1] ?? /<className>([^<]+)</.exec(xml)?.[1] ?? '';
}

export async function diagnosticar(wc: WebContents, parametros = ''): Promise<DiagnosticoBase> {
  const vazio = { modulos: [], botoes: [], parametros: [], parametrosAusentes: [] };

  const modulos = await carregarRegistros(wc, 'ModuloAdicional', 'CODMODULO,RESOURCEID,DESCRMODULO');
  if (!modulos.ok) return { ok: false, erro: modulos.erro, expirou: modulos.expirou, ...vazio };

  const botoes = await carregarRegistros(wc, 'BotaoAcao', 'IDBTNACAO,DESCRICAO,TIPO,NOMEINSTANCIA,CODMODULO,CONFIG');
  if (!botoes.ok) return { ok: false, erro: botoes.erro, expirou: botoes.expirou, ...vazio };

  const chaves = chavesPedidas(parametros);
  let lidos: ParametroBase[] = [];
  if (chaves.length) {
    // As chaves já passaram por `chavesPedidas` (sem aspas nem espaço): seguro no critério.
    const lista = chaves.map((c) => `'${c}'`).join(',');
    const r = await carregarRegistros(
      wc,
      'ParametroSistema',
      'CHAVE,DESCRICAO,TIPO,LOGICO,INTEIRO,NUMDEC,DATA,TEXTO',
      `this.CODUSU = 0 AND this.CHAVE IN (${lista})`,
    );
    if (!r.ok) return { ok: false, erro: r.erro, expirou: r.expirou, ...vazio };
    lidos = (r.corpo ?? []).map((p) => {
      const mascarado = SEGREDO.test(`${p['CHAVE']} ${p['DESCRICAO']}`);
      return {
        chave: p['CHAVE'] ?? '',
        descricao: p['DESCRICAO'] ?? '',
        tipo: p['TIPO'] ?? '',
        valor: mascarado ? '••••••' : valorDoParametro(p),
        mascarado,
      };
    });
  }

  return {
    ok: true,
    modulos: (modulos.corpo ?? []).map((m) => ({
      cod: m['CODMODULO'] ?? '',
      resourceId: m['RESOURCEID'] ?? '',
      descricao: m['DESCRMODULO'] ?? '',
    })),
    botoes: (botoes.corpo ?? []).map((b) => ({
      id: b['IDBTNACAO'] ?? '',
      descricao: b['DESCRICAO'] ?? '',
      tipo: b['TIPO'] ?? '',
      instancia: b['NOMEINSTANCIA'] ?? '',
      codModulo: b['CODMODULO'] ?? '',
      classe: b['TIPO'] === 'RJ' ? classeDoBotao(b['CONFIG'] ?? '') : '',
    })),
    parametros: lidos,
    parametrosAusentes: chaves.filter((c) => !lidos.some((p) => p.chave.toUpperCase() === c)),
  };
}
