/**
 * Serviço local que o backend chama (`src/sankhya/ponteDoDesktop.ts`) para o que só a
 * guia autenticada do Electron consegue fazer: cofre de credenciais, captura de sessão e
 * consultas ao `service.sbr` de dentro da página logada. Mesmo modelo e mesmo contrato
 * de `hub-helper.ps1` (porta fixa, token de arquivo, `x-hub-token`), só em 127.0.0.1.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { BRIDGE_HOST, BRIDGE_PORT } from './config';
import { garantirToken } from './tokenStore';
import { logEvento } from './log';
import * as cofre from './cofreCredenciais';
import * as navegador from './navegador';
import type { AgendaFetcher } from './agenda';
import type { TabManager } from './tabs';

function lerCorpo(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.on('data', (pedaco) => (dados += pedaco));
    req.on('end', () => resolve(dados));
    req.on('error', reject);
  });
}

function responderJson(res: ServerResponse, status: number, corpo: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(corpo));
}

/**
 * Mesmo contrato das rotas `/credentials` do `hub-helper.ps1`, para o backend não
 * precisar saber quem está do outro lado durante a transição — ver `cofreCredenciais.ts`.
 *
 * O `ok` de transporte vai junto porque o cliente do backend (`HubHelper`) o espera; o
 * estado da credencial em si são os outros campos.
 */
function tratarCredenciais(req: IncomingMessage, res: ServerResponse, corpo: string): void {
  // `/credentials/<sistema>` ou `/credentials/<sistema>/reveal`.
  const partes = (req.url ?? '').split('?')[0]?.split('/').filter(Boolean) ?? [];
  const sistema = partes[1] ?? '';
  const acao = partes[2] ?? '';

  if (!cofre.ehSistemaValido(sistema)) {
    responderJson(res, 404, { ok: false, erro: `sistema desconhecido: ${sistema}` });
    return;
  }

  if (!cofre.disponivel()) {
    // Sem criptografia real do sistema, gravar seria gravar em claro. Melhor recusar —
    // o motivo muda entre Windows (DPAPI) e Linux (chaveiro), ver cofreCredenciais.
    responderJson(res, 503, { ok: false, erro: cofre.motivoIndisponivel() });
    return;
  }

  if (req.method === 'GET' && acao === 'reveal') {
    responderJson(res, 200, { ok: true, ...cofre.revelar(sistema) });
    return;
  }

  if (req.method === 'GET' && !acao) {
    responderJson(res, 200, { ok: true, ...cofre.status(sistema) });
    return;
  }

  if (req.method === 'POST' && !acao) {
    let dados: { usuario?: string; senha?: string } = {};
    try {
      dados = JSON.parse(corpo || '{}') as { usuario?: string; senha?: string };
    } catch {
      responderJson(res, 400, { ok: false, erro: 'corpo não é JSON válido' });
      return;
    }
    if (!dados.usuario?.trim() || !dados.senha) {
      responderJson(res, 400, { ok: false, erro: 'envie { usuario, senha }' });
      return;
    }
    const status = cofre.gravar(sistema, dados.usuario, dados.senha);
    logEvento('credencial-gravada', { sistema });
    responderJson(res, 200, { ok: true, ...status });
    return;
  }

  if (req.method === 'DELETE' && !acao) {
    const status = cofre.remover(sistema);
    logEvento('credencial-removida', { sistema });
    responderJson(res, 200, { ok: true, ...status });
    return;
  }

  responderJson(res, 404, { ok: false, erro: `rota desconhecida: ${req.method} ${req.url}` });
}

/**
 * Mesmo contrato de `/secret/*` do `hub-helper.ps1`: POST { valor } -> { ok, valor }.
 *
 * O hub guarda estes blobs no SQLite dele — aqui só se empresta a criptografia do
 * sistema, sem nada ficar do lado do shell.
 */
function tratarSegredo(req: IncomingMessage, res: ServerResponse, corpo: string): void {
  const acao = (req.url ?? '').split('?')[0]?.split('/').filter(Boolean)[1] ?? '';

  if (req.method !== 'POST' || (acao !== 'encrypt' && acao !== 'decrypt')) {
    responderJson(res, 404, { ok: false, erro: 'use POST /secret/encrypt ou /secret/decrypt' });
    return;
  }

  if (!cofre.disponivel()) {
    responderJson(res, 503, { ok: false, erro: cofre.motivoIndisponivel() });
    return;
  }

  let valor = '';
  try {
    valor = String((JSON.parse(corpo || '{}') as { valor?: unknown }).valor ?? '');
  } catch {
    responderJson(res, 400, { ok: false, erro: 'corpo não é JSON válido' });
    return;
  }
  if (!valor) {
    responderJson(res, 400, { ok: false, erro: 'envie { valor }' });
    return;
  }

  try {
    const resultado =
      acao === 'encrypt' ? cofre.cifrarSegredo(valor) : cofre.decifrarSegredo(valor);
    responderJson(res, 200, { ok: true, valor: resultado });
  } catch (err) {
    // Blob de outro usuário/máquina, ou perfil do Windows recriado: o DPAPI não volta atrás.
    responderJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}

/**
 * Mesmo contrato de `/browser/*` do `hub-helper.ps1`, agora atendido pelo proprio shell
 * — ver `navegador.ts`. O backend nao precisa saber que o Chrome separado deixou de
 * existir.
 */
async function tratarNavegador(
  req: IncomingMessage,
  res: ServerResponse,
  corpo: string,
  tabs: TabManager | null,
): Promise<void> {
  const partes = (req.url ?? '').split('?')[0]?.split('/').filter(Boolean) ?? [];
  const acao = partes[1] ?? '';
  const sistema = partes[2] ?? '';
  const query = new URL(req.url ?? '/', 'http://local').searchParams;

  let dados: Record<string, unknown> = {};
  try {
    dados = JSON.parse(corpo || '{}') as Record<string, unknown>;
  } catch {
    dados = {};
  }
  const texto = (chave: string) =>
    typeof dados[chave] === 'string' ? (dados[chave] as string) : '';

  if (req.method === 'GET' && acao === 'status') {
    responderJson(res, 200, { ok: true, ...navegador.status(tabs) });
    return;
  }

  if (req.method === 'GET' && acao === 'favoritos') {
    responderJson(res, 200, {
      ok: true,
      favoritos: navegador.favoritos(query.get('navegador') ?? '', query.get('perfil') ?? ''),
    });
    return;
  }

  if (req.method === 'POST' && acao === 'favoritos') {
    // Nao ha mais para onde copiar: o perfil separado do Chrome existia so' porque o
    // hub precisava de uma janela propria com DevTools. A leitura (GET) continua
    // servindo ao cadastro de cliente, que era o uso real.
    responderJson(res, 200, {
      ok: true,
      mensagem: 'no aplicativo desktop os favoritos são lidos direto, sem precisar importar',
    });
    return;
  }

  if (req.method === 'POST' && acao === 'fechar') {
    // Antes fechava a janela do Chrome do hub. Aqui a janela e' o proprio aplicativo, e
    // fecha-la seria encerrar o hub inteiro.
    responderJson(res, 200, {
      ok: true,
      mensagem: 'as abas do Sankhya fazem parte do aplicativo — feche pela própria janela',
    });
    return;
  }

  if (!cofre.ehSistemaValido(sistema)) {
    responderJson(res, 404, { ok: false, erro: `sistema desconhecido: ${sistema}` });
    return;
  }

  if (req.method === 'POST' && acao === 'abrir') {
    try {
      responderJson(res, 200, { ok: true, url: navegador.abrir(tabs, sistema, texto('tela')) });
    } catch (err) {
      responderJson(res, 400, { ok: false, erro: (err as Error).message });
    }
    return;
  }

  if (req.method === 'POST' && acao === 'capturar') {
    if (!cofre.disponivel()) {
      responderJson(res, 503, { ok: false, erro: cofre.motivoIndisponivel() });
      return;
    }
    try {
      responderJson(res, 200, await navegador.capturar(tabs, sistema));
    } catch (err) {
      responderJson(res, 502, {
        ok: false,
        erro: `falha lendo a sessão: ${(err as Error).message}`,
      });
    }
    return;
  }

  responderJson(res, 404, { ok: false, erro: `rota desconhecida: ${req.method} ${req.url}` });
}

/**
 * @param tabs Lido a cada requisicao (funcao, nao valor): o servidor sobe junto com a
 *   janela, e guardar a referencia no boot deixaria o bridge preso a um TabManager que
 *   pode ser recriado (`activate` no macOS, janela fechada e reaberta).
 */
export function criarBridgeServer(agenda: AgendaFetcher, tabs: () => TabManager | null): Server {
  const servidor = createServer((req, res) => {
    void (async () => {
      if (req.headers['x-hub-token'] !== garantirToken()) {
        responderJson(res, 401, { erro: 'token inválido' });
        return;
      }

      if (req.method === 'GET' && req.url === '/health') {
        responderJson(res, 200, { ok: true, cofre: cofre.disponivel() });
        return;
      }

      if (req.url?.startsWith('/credentials/')) {
        tratarCredenciais(req, res, await lerCorpo(req));
        return;
      }

      if (req.url?.startsWith('/secret/')) {
        tratarSegredo(req, res, await lerCorpo(req));
        return;
      }

      if (req.url?.startsWith('/browser/')) {
        await tratarNavegador(req, res, await lerCorpo(req), tabs());
        return;
      }

      if (req.method === 'POST' && req.url === '/agenda/fetch') {
        try {
          const corpo = JSON.parse((await lerCorpo(req)) || '{}') as { de?: string; ate?: string };
          if (!corpo.de || !corpo.ate) {
            responderJson(res, 400, { erro: 'informe { de, ate } em DD/MM/YYYY' });
            return;
          }
          const resultado = await agenda.buscar(corpo.de, corpo.ate);
          if (!resultado.ok) {
            logEvento('bridge-agenda-fetch-falhou', { erro: resultado.erro });
            responderJson(res, 409, { erro: resultado.erro ?? 'falha desconhecida' });
            return;
          }
          responderJson(res, 200, { conteudo: resultado.conteudo });
        } catch (err) {
          responderJson(res, 500, { erro: String(err) });
        }
        return;
      }

      responderJson(res, 404, { erro: 'rota desconhecida' });
    })();
  });

  servidor.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
    // Gera o arquivo de token JÁ no boot, como o `hub-helper.ps1` faz. Antes ele só
    // nascia na primeira chamada que partisse do shell (o push da sessão da Experience),
    // e num perfil que nunca logou na Experience isso não acontecia nunca — o backend
    // ficava sem token e as credenciais caíam eternamente para o helper PowerShell.
    garantirToken();
    logEvento('bridge-servidor-no-ar', { host: BRIDGE_HOST, porta: BRIDGE_PORT });
  });

  return servidor;
}
