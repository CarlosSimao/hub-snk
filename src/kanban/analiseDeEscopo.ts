/**
 * Documento de escopo para tarefas de desenvolvimento, pelo assistente de IA escolhido
 * nas configurações.
 *
 * O texto do documento vai embutido no prompt e o assistente roda numa pasta
 * temporária vazia. A exceção é o PDF para quem o lê sozinho (Claude, OpenCode e
 * Gemini): ele vai para a pasta isolada, com nome fixo, e o assistente o abre. Para o
 * Codex e o Cursor, o texto do PDF é extraído aqui (`textoDoPdf.ts`) e vai no prompt.
 *
 * A resposta é JSON estrito. O assistente às vezes cerca o JSON com texto ou crases, e
 * o parser tolera isso; o que ele não tolera é faltar a lista de tarefas.
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assistenteLePdf,
  nomeDoAssistente,
  perguntarAoAssistente,
  resolverAssistente,
} from './assistentesDeIa.ts';
import type { ConteudoDoDocumento, DadosDeTarefa } from './kanbanDosProjetos.ts';
import { PdfIlegivelError, textoDoPdf } from './textoDoPdf.ts';
import {
  TIPOS_DE_TAREFA,
  type AssistenteDeIa,
  type ConfiguracaoDoAssistenteDeIa,
} from './tiposDoKanban.ts';

export class AnaliseDeEscopoError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'AnaliseDeEscopoError';
  }
}

/** Documento de escopo grande ainda cabe; acima disto é anexo, não escopo. */
const LIMITE_DO_TEXTO = 150_000;
/** Escopo de verdade leva minutos para decompor. */
export const TEMPO_LIMITE_DA_ANALISE_MS = 8 * 60_000;
const NOME_DO_PDF_ISOLADO = 'escopo.pdf';

export interface ResultadoDaAnalise {
  resumo: string;
  duvidas: string[];
  tarefas: DadosDeTarefa[];
}

export interface AnaliseConcluida extends ResultadoDaAnalise {
  assistente: AssistenteDeIa;
  modelo: string;
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
- "tipo" deve ser exatamente um de: ${TIPOS_DE_TAREFA.join(', ')}.
- "prioridade" deve ser alta, media ou baixa (alta = bloqueia outras ou é o núcleo do escopo).
- Inclua, quando o escopo implicar: estrutura de dados (tabelas/campos), testes e
  homologação com o cliente, e documentação de entrega.
- "criteriosAceite": como saber que a tarefa está pronta, em frases curtas separadas por "\\n".
- Escreva em português.
- Não altere nem crie arquivos e não execute comandos: responda só com o texto pedido.

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

function comoTexto(valor: unknown): string {
  if (Array.isArray(valor)) {
    return valor.map((item) => String(item)).join('\n');
  }
  if (typeof valor === 'string') {
    return valor;
  }
  return valor === null || valor === undefined ? '' : String(valor);
}

/** Tira o JSON do meio do que o assistente devolveu, com ou sem cerca de código. */
export function extrairResultado(saida: string): ResultadoDaAnalise {
  const semCerca = saida.replace(/```(?:json)?/gi, '');
  const inicio = semCerca.indexOf('{');
  const fim = semCerca.lastIndexOf('}');
  if (inicio < 0 || fim <= inicio) {
    throw new AnaliseDeEscopoError('A IA não devolveu JSON. Tente analisar de novo.');
  }

  let bruto: unknown;
  try {
    bruto = JSON.parse(semCerca.slice(inicio, fim + 1));
  } catch (erro) {
    throw new AnaliseDeEscopoError(`A IA devolveu JSON inválido: ${(erro as Error).message}`);
  }

  const objeto = (bruto ?? {}) as Record<string, unknown>;
  const lista = Array.isArray(objeto['tarefas'])
    ? (objeto['tarefas'] as Record<string, unknown>[])
    : [];
  if (!lista.length) {
    throw new AnaliseDeEscopoError('A IA não encontrou tarefas no documento.');
  }

  return {
    resumo: comoTexto(objeto['resumo']).trim(),
    duvidas: Array.isArray(objeto['duvidas'])
      ? (objeto['duvidas'] as unknown[]).map((duvida) => String(duvida).trim()).filter(Boolean)
      : [],
    tarefas: lista.map((tarefa) => ({
      titulo: comoTexto(tarefa['titulo']),
      descricao: comoTexto(tarefa['descricao']),
      grupo: comoTexto(tarefa['grupo']),
      tipo: comoTexto(tarefa['tipo']),
      estimativaHoras: Number(tarefa['estimativaHoras'] ?? tarefa['horas'] ?? 0),
      prioridade: comoTexto(tarefa['prioridade']),
      criteriosDeAceite: comoTexto(tarefa['criteriosAceite'] ?? tarefa['criteriosDeAceite']),
    })),
  };
}

/** Resumo e dúvidas num texto só: é o que o kanban mostra no topo. */
export function resumoComDuvidas(resultado: ResultadoDaAnalise): string {
  if (!resultado.duvidas.length) {
    return resultado.resumo;
  }
  const duvidas = resultado.duvidas.map((duvida) => `- ${duvida}`).join('\n');
  return `${resultado.resumo}\n\nPontos a esclarecer com o cliente:\n${duvidas}`;
}

/** Abaixo disto o PDF é digitalizado ou só tem figuras: não há escopo para ler. */
const MINIMO_DE_LETRAS_NO_PDF = 40;

/** O texto do PDF para o assistente que não o lê sozinho. */
function textoDoPdfParaAnalise(documento: ConteudoDoDocumento, assistente: string): string {
  let texto: string;
  try {
    texto = textoDoPdf(readFileSync(documento.arquivo));
  } catch (erro) {
    if (erro instanceof PdfIlegivelError) {
      throw new AnaliseDeEscopoError(
        `Não consegui ler o PDF para o ${assistente}: ${erro.message}`,
      );
    }
    throw erro;
  }
  if ((texto.match(/\p{L}/gu) ?? []).length < MINIMO_DE_LETRAS_NO_PDF) {
    throw new AnaliseDeEscopoError(
      `O PDF não tem texto selecionável (parece digitalizado), e o ${assistente} não lê imagens. Envie o escopo em .docx, ou escolha Claude Code, OpenCode ou Gemini CLI nas configurações.`,
    );
  }
  return texto;
}

export async function analisarEscopo(
  documento: ConteudoDoDocumento,
  escolha: ConfiguracaoDoAssistenteDeIa,
): Promise<AnaliseConcluida> {
  const assistente = resolverAssistente(escolha.assistente);
  // Modelo escolhido para outro assistente não serve para o que o `auto` achou.
  const modelo = escolha.assistente === 'auto' ? '' : escolha.modelo.trim();
  const raciocinio = escolha.assistente === 'auto' ? '' : (escolha.raciocinio ?? '').trim();

  /*
   * Só quem não lê PDF recebe o texto extraído pelo HUB SNK: os outros ficam com o
   * original, que preserva tabelas e figuras melhor que a extração.
   */
  const lerOriginal = documento.tipo === 'pdf' && assistenteLePdf(assistente);
  const textoDoDocumento =
    documento.tipo === 'pdf' && !lerOriginal
      ? textoDoPdfParaAnalise(documento, nomeDoAssistente(assistente))
      : documento.texto;

  const pasta = mkdtempSync(join(tmpdir(), 'hub-snk-kanban-'));
  try {
    let prompt: string;
    let arquivoParaLer: string | undefined;

    if (lerOriginal) {
      // Nome fixo: o nome original vem do usuário e não entra no prompt como caminho.
      copyFileSync(documento.arquivo, join(pasta, NOME_DO_PDF_ISOLADO));
      arquivoParaLer = NOME_DO_PDF_ISOLADO;
      prompt = instrucoes(
        `O documento de escopo está no arquivo \`${NOME_DO_PDF_ISOLADO}\`, no diretório atual. Leia o arquivo inteiro antes de responder.`,
      );
    } else {
      if (!textoDoDocumento.trim()) {
        throw new AnaliseDeEscopoError('O documento não tem texto para analisar.');
      }
      const texto =
        textoDoDocumento.length > LIMITE_DO_TEXTO
          ? `${textoDoDocumento.slice(0, LIMITE_DO_TEXTO)}\n\n[... documento truncado: passou de ${LIMITE_DO_TEXTO} caracteres ...]`
          : textoDoDocumento;
      prompt = instrucoes(
        `Documento de escopo "${documento.nome}":\n\n<<<ESCOPO\n${texto}\nESCOPO>>>`,
      );
    }

    const resposta = await perguntarAoAssistente(assistente, {
      prompt,
      pasta,
      modelo,
      raciocinio,
      ...(arquivoParaLer ? { arquivoParaLer } : {}),
      tempoLimiteMs: TEMPO_LIMITE_DA_ANALISE_MS,
    });
    // O nível vai junto do modelo no registro: é o que diz como as tarefas foram geradas.
    const registro = raciocinio ? `${modelo || 'padrão'} · raciocínio ${raciocinio}` : modelo;
    return { ...extrairResultado(resposta), assistente, modelo: registro };
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}
