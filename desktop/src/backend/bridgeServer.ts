/**
 * Serviço local que o backend chama (`src/sankhya/ponteDoDesktop.ts`) para o que só a
 * guia autenticada do Electron consegue fazer: cofre de credenciais, captura de sessão e
 * consultas ao `service.sbr` de dentro da página logada. Porta fixa, token de arquivo
 * (`x-hub-token`) e só em 127.0.0.1.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dialog } from 'electron';
import { BRIDGE_HOST, BRIDGE_PORT } from '../config';
import { garantirToken } from './tokenStore';
import { logEvento } from '../log';
import * as cofre from '../sankhya/cofreCredenciais';
import * as navegador from '../sankhya/navegador';
import { autoLoginSankhya } from '../sankhya/autoLoginSankhya';
import type { ConsultorDeAgenda, ResultadoFetch } from '../sankhya/janelaAgendaOculta';
import type { TabManager } from '../interface/tabs';

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
 * Cofre de credenciais — ver `cofreCredenciais.ts`.
 *
 * O `ok` de transporte vai junto porque o cliente do backend (`ponteDoDesktop.ts`) o
 * espera; o estado da credencial em si são os outros campos.
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

/** Guias do Sankhya: abrir, login automático e captura da sessão — ver `navegador.ts`. */
async function tratarNavegador(
  req: IncomingMessage,
  res: ServerResponse,
  tabs: TabManager | null,
): Promise<void> {
  const partes = (req.url ?? '').split('?')[0]?.split('/').filter(Boolean) ?? [];
  const acao = partes[1] ?? '';
  const sistema = partes[2] ?? '';

  if (!cofre.ehSistemaValido(sistema)) {
    responderJson(res, 404, { ok: false, erro: `sistema desconhecido: ${sistema}` });
    return;
  }

  if (req.method === 'POST' && acao === 'abrir') {
    try {
      responderJson(res, 200, {
        ok: true,
        url: await navegador.abrir(tabs, sistema),
      });
    } catch (err) {
      responderJson(res, 400, { ok: false, erro: (err as Error).message });
    }
    return;
  }

  if (req.method === 'POST' && acao === 'autologin') {
    if (!cofre.disponivel()) {
      responderJson(res, 503, { ok: false, erro: cofre.motivoIndisponivel() });
      return;
    }
    try {
      responderJson(res, 200, await autoLoginSankhya(tabs, sistema));
    } catch (err) {
      responderJson(res, 502, {
        ok: false,
        erro: `falha no login automático: ${(err as Error).message}`,
      });
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
 * Consulta feita de dentro da aba ERP: falha dela (sessão expirada, tela fechada) é 409,
 * com a mensagem que a tela do hub mostra ao usuário.
 */
function responderConsultaNaGuia(
  res: ServerResponse,
  resultado: ResultadoFetch,
  consulta: string,
): void {
  if (!resultado.ok) {
    logEvento('bridge-consulta-na-guia-falhou', { consulta, erro: resultado.erro });
    responderJson(res, 409, { erro: resultado.erro ?? 'falha desconhecida' });
    return;
  }
  responderJson(res, 200, { conteudo: resultado.conteudo });
}

/**
 * @param tabs Lido a cada requisicao (funcao, nao valor): o servidor sobe junto com a
 *   janela, e guardar a referencia no boot deixaria o bridge preso a um TabManager que
 *   pode ser recriado (`activate` no macOS, janela fechada e reaberta).
 */
export function criarBridgeServer(
  agenda: ConsultorDeAgenda,
  tabs: () => TabManager | null,
): Server {
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

      if (req.url?.startsWith('/browser/')) {
        await tratarNavegador(req, res, tabs());
        return;
      }

      if (req.method === 'POST' && req.url === '/agenda/fetch') {
        try {
          const corpo = JSON.parse((await lerCorpo(req)) || '{}') as { de?: string; ate?: string };
          if (!corpo.de || !corpo.ate) {
            responderJson(res, 400, { erro: 'informe { de, ate } em DD/MM/YYYY' });
            return;
          }
          responderConsultaNaGuia(res, await agenda.buscar(corpo.de, corpo.ate), 'agenda');
        } catch (err) {
          responderJson(res, 500, { erro: String(err) });
        }
        return;
      }

      if (req.method === 'POST' && req.url === '/agenda/negociacoes') {
        try {
          const corpo = JSON.parse((await lerCorpo(req)) || '{}') as { codParceiro?: unknown };
          const codParceiro = String(corpo.codParceiro ?? '');
          if (!/^\d+$/.test(codParceiro)) {
            responderJson(res, 400, { erro: 'informe { codParceiro } numérico' });
            return;
          }
          responderConsultaNaGuia(res, await agenda.buscarNegociacoes(codParceiro), 'negociacoes');
        } catch (err) {
          responderJson(res, 500, { erro: String(err) });
        }
        return;
      }

      responderJson(res, 404, { erro: 'rota desconhecida' });
    })();
  });

  // Porta ocupada (outro HUB SNK aberto com as mesmas portas, por exemplo) viraria exceção
  // não tratada, e cofre, Agenda e login automático morreriam sem dizer por quê.
  servidor.once('error', (erro) => {
    logEvento('bridge-servidor-falhou', { erro: String(erro) });
    dialog.showErrorBox(
      'HUB SNK — a ponte com o backend não abriu',
      `A porta ${BRIDGE_PORT} de ${BRIDGE_HOST} não pôde ser aberta (${String(erro)}). ` +
        'Credenciais Sankhya, Agenda e login automático ficam indisponíveis. Feche o outro ' +
        'programa que usa essa porta e abra o HUB SNK de novo.',
    );
  });

  servidor.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
    // Gera o arquivo de token JÁ no boot. Antes ele só nascia na primeira chamada que
    // partisse do shell (o push da sessão da Experience), e num perfil que nunca logou
    // na Experience isso não acontecia nunca — o backend ficava sem token.
    garantirToken();
    logEvento('bridge-servidor-no-ar', { host: BRIDGE_HOST, porta: BRIDGE_PORT });
  });

  return servidor;
}
