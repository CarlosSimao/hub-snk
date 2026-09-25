/**
 * O Hub e WebContentsView sem preload. Um token efemero injetado somente no WebContents
 * da aba Hub autoriza seis operacoes fechadas no bridge local. O token geral x-hub-token
 * pertence ao backend e nao entra no renderer. Origin e token sao exigidos juntos;
 * ERP, Experience e abas de clientes nao recebem a injecao. Nenhuma operacao revela a chave.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { app, type WebContents } from 'electron';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HUB_URL, BRIDGE_PORT } from './config';
import * as cofre from './integracaoCofre';
import { FilaIntegracao } from './integracaoFila';
import { validarConfig, type EventoApi } from './integracaoValidacao';

const token = randomBytes(32).toString('hex');
const origem = new URL(HUB_URL).origin;
const fila = new FilaIntegracao(join(app.getPath('userData'), 'integracao-fila.json'));
/** Entrada para os adaptadores no processo principal. Sem rota HTTP de enfileiramento. */
export function enfileirarEventos(eventos: EventoApi[]): number {
  const cfg = cofre.estado();
  validarConfig(cfg.apiUrl, cfg.installationId);
  return fila.enfileirarLote(eventos, cfg.apiUrl, cfg.installationId);
}
const responder = (res: ServerResponse, codigo: number, valor: unknown) => { res.writeHead(codigo, { 'content-type': 'application/json', 'access-control-allow-origin': origem, 'vary': 'Origin' }); res.end(JSON.stringify(valor)); };
const tokenValido = (valor: unknown) => typeof valor === 'string' && valor.length === token.length && timingSafeEqual(Buffer.from(valor), Buffer.from(token));

export function instalarNoHub(webContents: WebContents): void {
  const injetar = () => {
    try {
      const u = new URL(webContents.getURL());
      if (u.origin !== origem || u.searchParams.get('desktop') !== '1') return;
    } catch { return; }
    const script = `(() => {
      const segredo = ${JSON.stringify(token)};
      const base = 'http://127.0.0.1:${BRIDGE_PORT}/integracao-api/';
      const chamar = async (acao, dados) => {
        const r = await fetch(base + acao, { method: 'POST', headers: { 'content-type': 'application/json', 'x-integracao-token': segredo }, body: JSON.stringify(dados || {}) });
        const resposta = await r.json();
        if (!r.ok) throw new Error(resposta.erro || 'Falha na integracao');
        return resposta;
      };
      Object.defineProperty(window, 'integracaoDesktop', { configurable: false, value: Object.freeze({
        estado: () => chamar('estado'), salvar: d => chamar('salvar', d), trocarChave: chave => chamar('trocar-chave', { chave }),
        removerChave: () => chamar('remover-chave'), validar: () => chamar('validar'), enviarPendencias: () => chamar('enviar-pendencias')
      }) });
      window.dispatchEvent(new Event('integracao-desktop-pronta'));
    })();`;
    void webContents.executeJavaScript(script).catch(() => {});
  };
  webContents.on('did-finish-load', injetar);
  injetar();
}

export async function tratarIntegracao(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.headers.origin !== origem) {
    responder(res, 403, { erro: 'Acesso negado' }); return;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': origem, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type,x-integracao-token', 'vary': 'Origin' }); res.end(); return;
  }
  if (!tokenValido(req.headers['x-integracao-token'])) {
    responder(res, 403, { erro: 'Acesso negado' }); return;
  }
  if (req.method !== 'POST') { responder(res, 405, { erro: 'Metodo nao permitido' }); return; }
  let corpo = '';
  try {
    for await (const parte of req) { corpo += parte; if (corpo.length > 8192) throw new Error('Corpo muito grande'); }
    let dados: Record<string, unknown>;
    try { dados = JSON.parse(corpo || '{}') as Record<string, unknown>; }
    catch { throw new Error('JSON invalido'); }
    const acao = req.url?.split('?')[0]?.slice('/integracao-api/'.length);
    if (acao === 'estado') { responder(res, 200, { ...cofre.estado(), ...fila.estado() }); return; }
    if (acao === 'salvar') {
      const apiUrl = String(dados.apiUrl ?? '').trim(); const installationId = String(dados.installationId ?? '').trim();
      validarConfig(apiUrl, installationId);
      if (!fila.podeAlterarIdentidade(apiUrl, installationId)) throw new Error('Fila pendente pertence a URL e instalacao anteriores');
      cofre.salvarConfig(apiUrl, installationId, false); // envio automatico aguarda adaptadores e homologacao
      fila.definirIdentidade(apiUrl, installationId);
    } else if (acao === 'trocar-chave') cofre.trocarChave(String(dados.chave ?? ''));
    else if (acao === 'remover-chave') cofre.removerChave();
    else if (acao === 'validar') cofre.validar();
    else if (acao === 'enviar-pendencias') {
      const cfg = cofre.estado(); validarConfig(cfg.apiUrl, cfg.installationId);
      await fila.enviar(cfg.apiUrl, cfg.installationId, cofre.chave(), true);
    } else { responder(res, 404, { erro: 'Operacao desconhecida' }); return; }
    responder(res, 200, { ...cofre.estado(), ...fila.estado() });
  } catch (erro) {
    // Apenas mensagens locais e controladas. Erros de fetch, URLs e corpos remotos nao saem daqui.
    const mensagem = erro instanceof Error ? erro.message : 'Operacao invalida';
    responder(res, 400, { erro: mensagem.replace(/dsk_[A-Za-z0-9._:-]+/g, '[segredo]') });
  }
}

export function iniciarRemetente(): void {
  const timer = setInterval(() => {
    // Fila vazia não lê o arquivo nem decifra a chave: sem isto, eram as duas coisas por
    // segundo, o app inteiro aberto.
    if (fila.estado().pendentes === 0) return;
    const cfg = cofre.estado();
    if (cfg.habilitada) void fila.enviar(cfg.apiUrl, cfg.installationId, cofre.chave());
  }, 1000);
  timer.unref();
}
