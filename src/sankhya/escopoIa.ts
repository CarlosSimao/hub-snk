/**
 * Documento de escopo -> tarefas de desenvolvimento, pelo `claude` instalado na máquina.
 *
 * Mesmo desenho de segurança do resumo de entrega (`src/evidenciaIa.ts`): o conteúdo vai
 * EMBUTIDO no prompt e o agente roda num diretório temporário vazio, com as ferramentas
 * desligadas. A exceção é o PDF, que o hub não sabe ler sem dependência nova: ele vai
 * sozinho para o diretório isolado e só a ferramenta de LEITURA fica ligada — nada de
 * escrever, executar comando ou acessar a rede.
 *
 * A resposta é JSON estrito. O agente às vezes cerca o JSON com texto ou com crases, e o
 * parser tolera isso; o que ele não tolera é faltar a lista de tarefas.
 */
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executar, noPath } from '../evidenciaIa.ts';
import type { TarefaEntrada } from './escopo.ts';
import { TIPOS_TAREFA } from '../types.ts';

export class AnaliseEscopoError extends Error {}

/** Documento de escopo grande ainda cabe; acima disto é anexo, não escopo. */
const LIMITE_TEXTO = 150_000;
/** Escopo de verdade leva minutos para decompor; o limite do resumo de entrega (2 min) não serve. */
const TIMEOUT_ANALISE_MS = 8 * 60_000;

const FERRAMENTAS_BLOQUEADAS = 'Bash,Edit,Write,Glob,Grep,WebFetch,WebSearch,NotebookEdit';

export interface ResultadoAnalise {
  resumo: string;
  duvidas: string[];
  tarefas: TarefaEntrada[];
}

function instrucoes(origem: string): string {
  return `Você é analista técnico de desenvolvimento para o ERP Sankhya OM (customizações em
Java — Módulo Java/Addon Studio —, telas, tabelas adicionais AD_, relatórios Jasper,
dashboards/BI, integrações).

${origem}

Decomponha o escopo em TAREFAS DE DESENVOLVIMENTO executáveis por um consultor técnico.

Regras:
- Só o que o escopo pede. Não invente funcionalidade. Se algo estiver ambíguo ou faltar
  informação, NÃO chute: registre em "duvidas".
- Cada tarefa entre 1 e 16 horas. Se passar disso, quebre em mais tarefas.
- "grupo" é a funcionalidade/entregável a que a tarefa pertence (use o mesmo nome para
  tarefas da mesma funcionalidade).
- "tipo" deve ser exatamente um de: ${TIPOS_TAREFA.join(', ')}.
- "prioridade" deve ser alta, media ou baixa (alta = bloqueia outras ou é o núcleo do escopo).
- Inclua, quando o escopo implicar: estrutura de dados (tabelas/campos), testes e
  homologação com o cliente, e documentação de entrega.
- "criteriosAceite": como saber que a tarefa está pronta, em frases curtas separadas por "\\n".
- Escreva em português.

Responda SOMENTE com um JSON válido, sem texto antes ou depois, neste formato:
{
  "resumo": "2 a 5 frases sobre o que o escopo entrega",
  "duvidas": ["pergunta em aberto para o cliente", "..."],
  "tarefas": [
    {
      "titulo": "verbo no infinitivo + objeto",
      "descricao": "o que fazer, com os nomes de tabela/tela/rotina que o escopo citar",
      "grupo": "funcionalidade",
      "tipo": "backend",
      "estimativaHoras": 4,
      "prioridade": "alta",
      "criteriosAceite": "critério 1\\ncritério 2"
    }
  ]
}`;
}

/** Tira o JSON do meio do que o agente devolveu — com ou sem cerca de código. */
export function extrairResultado(saida: string): ResultadoAnalise {
  const semCerca = saida.replace(/```(?:json)?/gi, '');
  const inicio = semCerca.indexOf('{');
  const fim = semCerca.lastIndexOf('}');
  if (inicio < 0 || fim <= inicio) {
    throw new AnaliseEscopoError('a IA não devolveu JSON — tente analisar de novo');
  }

  let bruto: unknown;
  try {
    bruto = JSON.parse(semCerca.slice(inicio, fim + 1));
  } catch (err) {
    throw new AnaliseEscopoError(`a IA devolveu JSON inválido: ${(err as Error).message}`);
  }

  const obj = (bruto ?? {}) as Record<string, unknown>;
  const lista = Array.isArray(obj['tarefas']) ? (obj['tarefas'] as Record<string, unknown>[]) : [];
  if (!lista.length) throw new AnaliseEscopoError('a IA não encontrou tarefas no documento');

  const texto = (v: unknown): string =>
    Array.isArray(v) ? v.map((x) => String(x)).join('\n') : typeof v === 'string' ? v : v == null ? '' : String(v);

  return {
    resumo: texto(obj['resumo']).trim(),
    duvidas: Array.isArray(obj['duvidas']) ? (obj['duvidas'] as unknown[]).map((d) => String(d).trim()).filter(Boolean) : [],
    tarefas: lista.map((t) => ({
      titulo: texto(t['titulo']),
      descricao: texto(t['descricao']),
      grupo: texto(t['grupo']),
      tipo: texto(t['tipo']),
      estimativaHoras: Number(t['estimativaHoras'] ?? t['horas'] ?? 0),
      prioridade: texto(t['prioridade']),
      criteriosAceite: texto(t['criteriosAceite']),
    })),
  };
}

/** Resumo + dúvidas num texto só: é o que o documento mostra no topo do quadro. */
export function resumoComDuvidas(r: ResultadoAnalise): string {
  if (!r.duvidas.length) return r.resumo;
  return `${r.resumo}\n\nPontos a esclarecer com o cliente:\n${r.duvidas.map((d) => `- ${d}`).join('\n')}`;
}

export async function analisarEscopo(documento: {
  texto: string;
  tipo: string;
  arquivo: string;
  nome: string;
}): Promise<ResultadoAnalise> {
  const claude = noPath('claude', ['.exe', '']);
  if (!claude) throw new AnaliseEscopoError('o Claude Code (`claude`) não foi encontrado no PATH desta máquina');

  const isolado = mkdtempSync(join(tmpdir(), 'hub-escopo-'));
  try {
    let prompt: string;
    let args: string[];

    if (documento.tipo === 'pdf') {
      // Só o PDF no diretório, com nome fixo — o nome original vem do usuário e não
      // entra no prompt como caminho.
      copyFileSync(documento.arquivo, join(isolado, 'escopo.pdf'));
      prompt = instrucoes(
        'O documento de escopo está no arquivo `escopo.pdf`, no diretório atual. Leia o arquivo inteiro com a ferramenta Read antes de responder.',
      );
      args = ['-p', '--output-format', 'text', '--allowedTools', 'Read', '--disallowedTools', FERRAMENTAS_BLOQUEADAS];
    } else {
      if (!documento.texto.trim()) throw new AnaliseEscopoError('o documento não tem texto para analisar');
      const texto =
        documento.texto.length > LIMITE_TEXTO
          ? `${documento.texto.slice(0, LIMITE_TEXTO)}\n\n[... documento truncado: excedeu ${LIMITE_TEXTO} caracteres ...]`
          : documento.texto;
      prompt = instrucoes(`Documento de escopo "${documento.nome}":\n\n<<<ESCOPO\n${texto}\nESCOPO>>>`);
      args = ['-p', '--output-format', 'text', '--disallowedTools', `Read,${FERRAMENTAS_BLOQUEADAS}`];
    }

    const { ok, saida } = await executar(claude, args, { cwd: isolado, entrada: prompt, timeoutMs: TIMEOUT_ANALISE_MS });
    if (!ok) {
      const detalhe = saida.trim().split('\n').slice(-3).join(' ').slice(0, 300);
      throw new AnaliseEscopoError(`o Claude não concluiu a análise${detalhe ? `: ${detalhe}` : ' (tempo esgotado ou erro)'}`);
    }
    return extrairResultado(saida);
  } finally {
    rmSync(isolado, { recursive: true, force: true });
  }
}
