/**
 * Solicitação de Serviços DS e a atualização automática da agenda.
 *
 * O snapshot local (`sankhya/solicitacoes.ts`) responde a tela; o download de um arquivo
 * vai sempre ao ERP na hora, pela aba logada do shell — arquivo não fica guardado no DS.
 */
import type { FastifyInstance } from 'fastify';
import { DesktopBridgeError, DesktopBridgeIndisponivelError, type DesktopBridge } from './sankhya/desktopBridge.ts';
import type { Solicitacoes } from './sankhya/solicitacoes.ts';
import type { SincronizacaoAgenda } from './sankhya/sincronizacaoAgenda.ts';

export interface RouteSolicitacoesDeps {
  solicitacoes: Solicitacoes;
  sincronizacao: SincronizacaoAgenda;
  desktopBridge?: DesktopBridge;
}

/** `filename*` em UTF-8: nome de anexo do ERP vem com acento e espaço. */
function disposicao(nome: string, inline: boolean): string {
  const ascii = nome.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`;
}

/**
 * O visualizador de anexos do ERP responde `application/octet-stream` para tudo; sem o
 * tipo certo, o navegador não mostra o PDF nem a imagem na pré-visualização.
 */
const TIPO_POR_EXTENSAO: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  json: 'application/json',
  xml: 'text/xml',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function tipoDoArquivo(nome: string, tipo: string): string {
  if (tipo && tipo !== 'application/octet-stream') return tipo;
  const ext = (/\.([a-z0-9]+)$/i.exec(nome)?.[1] ?? '').toLowerCase();
  return TIPO_POR_EXTENSAO[ext] ?? 'application/octet-stream';
}

/**
 * Cache curto do que veio do ERP: abrir a pré-visualização e depois baixar o mesmo
 * arquivo não precisa atravessar a aba e o ERP duas vezes. Só em memória.
 */
const CACHE_MS = 10 * 60_000;
const CACHE_MAX_BYTES = 150 * 1024 * 1024;
const cache = new Map<string, { nome: string; tipo: string; dados: Buffer; em: number }>();

function guardar(chave: string, item: { nome: string; tipo: string; dados: Buffer }): void {
  const agora = Date.now();
  for (const [k, v] of cache) if (agora - v.em > CACHE_MS) cache.delete(k);
  cache.set(chave, { ...item, em: agora });
  let total = [...cache.values()].reduce((soma, v) => soma + v.dados.length, 0);
  // Map guarda a ordem de inserção: os primeiros são os mais antigos.
  for (const [k, v] of cache) {
    if (total <= CACHE_MAX_BYTES) break;
    cache.delete(k);
    total -= v.dados.length;
  }
}

export function registerRoutesSolicitacoes(app: FastifyInstance, deps: RouteSolicitacoesDeps): void {
  const { solicitacoes, sincronizacao, desktopBridge } = deps;

  app.get('/api/agenda/sincronizacao', async () => sincronizacao.estado());

  /** Atualiza agora, sem esperar a próxima janela de 4 horas. */
  app.post('/api/agenda/sincronizar', async () => sincronizacao.atualizar());

  app.get<{ Querystring: { codigos?: string } }>('/api/solicitacoes', async (request) => {
    const codigos = String(request.query.codigos ?? '')
      .split(',')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
    return { solicitacoes: solicitacoes.obter(codigos) };
  });

  /** Sem `?nuAttach=`, o arquivo do campo Anexo; com, um dos anexos do clipe. */
  //
  // `?inline=1` é a pré-visualização: o navegador mostra em vez de salvar.
  app.get<{ Params: { codigo: string }; Querystring: { nuAttach?: string; inline?: string } }>(
    '/api/solicitacoes/:codigo/arquivo',
    async (request, reply) => {
      const codigo = Number(request.params.codigo);
      const nuAttach = request.query.nuAttach ? Number(request.query.nuAttach) : undefined;
      const inline = request.query.inline === '1';
      if (!Number.isInteger(codigo) || codigo <= 0 || (nuAttach !== undefined && !Number.isInteger(nuAttach))) {
        return reply.code(400).send({ error: 'código ou anexo inválido' });
      }
      if (!desktopBridge) {
        return reply.code(503).send({ error: 'baixar arquivo do ERP exige o Sankhya Hub Desktop' });
      }

      const chave = `${codigo}:${nuAttach ?? 'campo'}`;
      try {
        let item = cache.get(chave);
        if (!item || Date.now() - item.em > CACHE_MS) {
          const arquivo = await desktopBridge.baixarArquivoSolicitacao(codigo, nuAttach);
          const nome = arquivo.nome || `solicitacao-${codigo}`;
          guardar(chave, { nome, tipo: tipoDoArquivo(nome, arquivo.tipo), dados: Buffer.from(arquivo.base64, 'base64') });
          item = cache.get(chave)!;
        }
        return reply
          .header('content-type', item.tipo)
          .header('content-disposition', disposicao(item.nome, inline))
          .header('cache-control', 'private, max-age=600')
          .send(item.dados);
      } catch (err) {
        if (err instanceof DesktopBridgeIndisponivelError) {
          return reply.code(503).send({ error: err.message });
        }
        if (err instanceof DesktopBridgeError) {
          return reply.code(err.status).send({ error: err.message, sessaoExpirada: err.expirou });
        }
        throw err;
      }
    },
  );
}
