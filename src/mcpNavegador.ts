/**
 * Servidor MCP do navegador do hub, falado por stdio.
 *
 * E' o que a skill do Claude Code usa para navegar no Sankhya e tirar as evidencias
 * DENTRO do hub: as abas do shell ja' estao autenticadas, entao nao ha segundo navegador
 * nem login repetido. Sem isto, a skill de documento de entrega cai no Playwright, que
 * sobe um Chromium proprio e pede login de novo.
 *
 * Este processo nao enxerga aba nenhuma: quem tem `webContents` e' o shell Electron. Aqui
 * so' ha traducao entre o protocolo MCP e o bridge em 127.0.0.1 (ver
 * `desktop/src/navegacaoSkill.ts`), autenticado pelo mesmo arquivo de token que o resto
 * do hub usa.
 *
 * O protocolo e' implementado a mao — sao tres metodos (`initialize`, `tools/list`,
 * `tools/call`) e uma moldura JSON-RPC por linha. Trazer um SDK para isso adicionaria
 * dependencia de producao ao pacote inteiro para economizar cem linhas.
 */
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';

const BRIDGE = process.env['SANKHYA_DESKTOP_BRIDGE_URL'] ?? 'http://127.0.0.1:4103';
const ARQUIVO_TOKEN = process.env['DESKTOP_BRIDGE_TOKEN_FILE'] ?? '';

const VERSAO_PROTOCOLO = '2024-11-05';

interface Ferramenta {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  chamar: (args: Record<string, unknown>) => Promise<unknown>;
}

function token(): string {
  if (!ARQUIVO_TOKEN) return '';
  try {
    return readFileSync(ARQUIVO_TOKEN, 'utf8').trim();
  } catch {
    return '';
  }
}

async function bridge(rota: string, corpo?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const resposta = await fetch(`${BRIDGE}${rota}`, {
    method: corpo ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-hub-token': token() },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
    signal: AbortSignal.timeout(60_000),
  });

  const dados = (await resposta.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resposta.ok) {
    const erro = typeof dados['erro'] === 'string' ? dados['erro'] : `HTTP ${resposta.status}`;
    throw new Error(erro);
  }
  return dados;
}

const texto = (args: Record<string, unknown>, chave: string) =>
  typeof args[chave] === 'string' ? (args[chave] as string) : '';
const numero = (args: Record<string, unknown>, chave: string) =>
  typeof args[chave] === 'number' ? (args[chave] as number) : 0;

const FERRAMENTAS: Ferramenta[] = [
  {
    name: 'abas',
    description:
      'Lista as abas do Sankhya Hub (hub, erp, experience, evidencias) com título e URL atual. ' +
      'As abas já estão autenticadas no Sankhya — não é preciso fazer login.',
    inputSchema: { type: 'object', properties: {} },
    chamar: () => bridge('/navegacao/abas'),
  },
  {
    name: 'abrir',
    description:
      'Abre uma URL na aba de evidências do hub, criando-a se necessário, e espera o carregamento. ' +
      'Use esta ferramenta para começar: ela devolve o id da aba para as chamadas seguintes.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL http(s) a abrir' } },
      required: ['url'],
    },
    chamar: (args) => bridge('/navegacao/abrir', { url: texto(args, 'url') }),
  },
  {
    name: 'navegar',
    description: 'Navega uma aba existente para outra URL e espera o carregamento.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        aba: { type: 'string', description: 'id da aba; o padrão é evidencias' },
      },
      required: ['url'],
    },
    chamar: (args) => bridge('/navegacao/navegar', { url: texto(args, 'url'), aba: texto(args, 'aba') }),
  },
  {
    name: 'capturar',
    description:
      'Captura a aba em PNG e grava em disco, devolvendo o caminho do arquivo. Informe o caminho ' +
      'absoluto de destino (por exemplo a pasta de evidências do documento). Captura o conteúdo da ' +
      'aba, então não depende de a janela estar na frente.',
    inputSchema: {
      type: 'object',
      properties: {
        caminho: { type: 'string', description: 'caminho absoluto do PNG a gravar' },
        aba: { type: 'string' },
      },
    },
    chamar: (args) => bridge('/navegacao/capturar', { caminho: texto(args, 'caminho'), aba: texto(args, 'aba') }),
  },
  {
    name: 'clicar',
    description: 'Clica em coordenadas da página (x, y em pixels, a partir do topo esquerdo da aba).',
    inputSchema: {
      type: 'object',
      properties: { x: { type: 'number' }, y: { type: 'number' }, aba: { type: 'string' } },
      required: ['x', 'y'],
    },
    chamar: (args) =>
      bridge('/navegacao/clicar', { x: numero(args, 'x'), y: numero(args, 'y'), aba: texto(args, 'aba') }),
  },
  {
    name: 'digitar',
    description: 'Digita texto no elemento que está com o foco na aba.',
    inputSchema: {
      type: 'object',
      properties: { texto: { type: 'string' }, aba: { type: 'string' } },
      required: ['texto'],
    },
    chamar: (args) => bridge('/navegacao/digitar', { texto: texto(args, 'texto'), aba: texto(args, 'aba') }),
  },
  {
    name: 'tecla',
    description: 'Pressiona uma tecla na aba (Enter, Tab, Escape, ArrowDown...).',
    inputSchema: {
      type: 'object',
      properties: { tecla: { type: 'string' }, aba: { type: 'string' } },
      required: ['tecla'],
    },
    chamar: (args) => bridge('/navegacao/tecla', { tecla: texto(args, 'tecla'), aba: texto(args, 'aba') }),
  },
  {
    name: 'texto_da_pagina',
    description:
      'Devolve o texto visível da aba. Use para confirmar onde a navegação parou antes de capturar — ' +
      'ler texto custa muito menos que interpretar uma imagem.',
    inputSchema: { type: 'object', properties: { aba: { type: 'string' } } },
    chamar: (args) => bridge('/navegacao/texto', { aba: texto(args, 'aba') }),
  },
];

interface Requisicao {
  jsonrpc: string;
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

function responder(id: number | string | undefined, resultado: unknown): void {
  if (id === undefined) return; // Notificação: o protocolo pede silêncio.
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result: resultado })}\n`);
}

function responderErro(id: number | string | undefined, mensagem: string): void {
  if (id === undefined) return;
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: mensagem } })}\n`);
}

async function tratar(requisicao: Requisicao): Promise<void> {
  const { id, method, params } = requisicao;

  if (method === 'initialize') {
    responder(id, {
      protocolVersion: VERSAO_PROTOCOLO,
      capabilities: { tools: {} },
      serverInfo: { name: 'sankhya-hub-navegador', version: '1.0.0' },
    });
    return;
  }

  if (method === 'tools/list') {
    responder(
      id,
      { tools: FERRAMENTAS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) },
    );
    return;
  }

  if (method === 'tools/call') {
    const nome = typeof params?.['name'] === 'string' ? (params['name'] as string) : '';
    const args = (params?.['arguments'] ?? {}) as Record<string, unknown>;
    const ferramenta = FERRAMENTAS.find((item) => item.name === nome);

    if (!ferramenta) {
      responderErro(id, `ferramenta desconhecida: ${nome}`);
      return;
    }

    try {
      const resultado = await ferramenta.chamar(args);
      // O conteúdo vai como texto JSON: é o formato que todo cliente MCP sabe ler, e a
      // skill precisa do caminho do arquivo mais do que de uma imagem no contexto.
      responder(id, { content: [{ type: 'text', text: JSON.stringify(resultado) }] });
    } catch (err) {
      responder(id, {
        content: [{ type: 'text', text: `falhou: ${(err as Error).message}` }],
        isError: true,
      });
    }
    return;
  }

  // `notifications/*` e o que mais vier: responder erro a uma notificação quebraria o
  // cliente, e `id` ausente já garante silêncio.
  if (method.startsWith('notifications/')) return;
  responderErro(id, `método não suportado: ${method}`);
}

createInterface({ input: process.stdin }).on('line', (linha) => {
  if (!linha.trim()) return;
  let requisicao: Requisicao;
  try {
    requisicao = JSON.parse(linha) as Requisicao;
  } catch {
    return;
  }
  void tratar(requisicao);
});
