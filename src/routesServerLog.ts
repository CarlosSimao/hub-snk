/**
 * Log do WildFly das bases de cliente.
 *
 * O hub não alcança o disco do cliente e não pode instalar nada por lá por arquivo. O que
 * viabiliza isto é o módulo Java `serverlog`, instalado pela própria tela do Sankhya, que
 * registra `LerLogAction` como Botão de Ação — e botão de ação é chamável por serviço.
 * A chamada sai de dentro da aba já logada da base, pelo shell desktop; por isso tudo aqui
 * depende do `desktopBridge` e não existe caminho alternativo por HTTP direto.
 *
 * Como o módulo fica na base DO CLIENTE só durante a demanda, estas rotas também mantêm o
 * registro de onde ele está e até quando (`ServerLogInstalacoes`), e a baixa só acontece
 * depois de uma verificação confirmar que ele saiu mesmo.
 *
 * Ver `desktop/src/serverLog.ts` para o contrato medido (`offset`/`maxLinhas` ->
 * `linhas`/`novoOffset`) e para a armadilha do `maxLinhas` baixo.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { DesktopBridgeError, DesktopBridgeIndisponivelError, type DesktopBridge } from './sankhya/desktopBridge.ts';
import type { ServerLogInstalacoes } from './sankhya/serverLogInstalacoes.ts';
import type { StatusServerLog } from './types.ts';

export interface RouteServerLogDeps {
  /** Só existe com o shell desktop no ar — sem ele não há aba logada para executar a leitura. */
  desktopBridge?: DesktopBridge;
  instalacoes: ServerLogInstalacoes;
  /**
   * A base cadastrada dona do origin: nome legível (cliente · ambiente) para o aviso, e o
   * fim da demanda do cliente, que vira o prazo de remoção de uma instalação nova.
   */
  baseDoOrigin: (origin: string) => { nome: string; demandaFim: string };
}

function responderErro(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof DesktopBridgeIndisponivelError) {
    return reply.code(503).send({ error: err.message, helperIndisponivel: true });
  }
  if (err instanceof DesktopBridgeError) {
    return reply.code(err.status).send({ error: err.message });
  }
  throw err;
}

/** Só `http(s)` e só origin puro: o valor vira alvo de execução de script no shell. */
function origemValida(valor: string): boolean {
  try {
    const u = new URL(valor);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.origin === valor;
  } catch {
    return false;
  }
}

/** O que ainda existe do módulo na base — é a lista do que falta tirar. */
function restante(status: StatusServerLog): string[] {
  const itens: string[] = [];
  if (status.modulo) {
    itens.push(`módulo ${status.modulo.resourceId || status.modulo.descricao} (cód. ${status.modulo.cod})`);
  }
  if (status.botaoLer) itens.push(`botão "${status.botaoLer.descricao}" (id ${status.botaoLer.id}, LerLogAction)`);
  if (status.botaoMonitor) {
    itens.push(`botão "${status.botaoMonitor.descricao}" (id ${status.botaoMonitor.id}, MonitorLogAction)`);
  }
  return itens;
}

/** Uma frase para a coluna "última verificação" — o que o usuário lê no cartão. */
function resumir(status: StatusServerLog): string {
  if (!status.modulo && !status.botaoLer && !status.botaoMonitor) return 'nada do serverlog instalado';
  if (!status.botaoLer) return 'módulo sem o botão LerLogAction registrado';
  if (!status.modulo) return 'botão registrado, mas módulo não identificado';
  if (status.leituraOk === false) return `leitura falhou: ${status.erroLeitura ?? 'erro desconhecido'}`;
  return 'configurado e lendo';
}

export function registerRoutesServerLog(app: FastifyInstance, deps: RouteServerLogDeps): void {
  const { desktopBridge, instalacoes, baseDoOrigin } = deps;

  const semShell = (reply: FastifyReply) =>
    reply.code(503).send({
      error: 'exige o Sankhya Hub Desktop no ar — é ele que tem a aba logada da base',
    });

  app.post<{ Body: { origin?: unknown; offset?: unknown; maxLinhas?: unknown; actionId?: unknown } }>(
    '/api/serverlog/ler',
    async (request, reply) => {
      if (!desktopBridge) return semShell(reply);

      const origin = String(request.body?.origin ?? '');
      if (!origemValida(origin)) {
        return reply.code(400).send({ error: 'informe { origin } da base, como https://cliente.sankhyacloud.com.br' });
      }

      const offsetBruto = Number(request.body?.offset ?? 0);
      const offset = Number.isFinite(offsetBruto) && offsetBruto >= 0 ? Math.floor(offsetBruto) : 0;

      const maxBruto = Number(request.body?.maxLinhas ?? 0);
      const maxLinhas = Number.isFinite(maxBruto) && maxBruto > 0 ? Math.floor(maxBruto) : undefined;

      const actionId = String(request.body?.actionId ?? '').trim();

      let resposta;
      try {
        resposta = await desktopBridge.lerServerLog({
          origin,
          offset,
          ...(maxLinhas ? { maxLinhas } : {}),
          ...(actionId ? { actionId } : {}),
        });
      } catch (err) {
        return responderErro(reply, err);
      }

      // Leitura que deu certo PROVA que o módulo está lá. Registrar aqui é o que garante o
      // aviso de remoção para quem nunca clicou em "Verificar" — o caso mais provável de
      // esquecer. `registrarDeteccao` não mexe no prazo de instalação já ativa.
      const dona = baseDoOrigin(origin);
      instalacoes.registrarDeteccao(origin, {
        clienteNome: dona.nome,
        botaoId: resposta.actionId,
        removerAtePadrao: dona.demandaFim,
      });
      return resposta;
    },
  );

  /** Verifica o que está instalado e atualiza o registro. */
  app.post<{ Body: { origin?: unknown } }>('/api/serverlog/verificar', async (request, reply) => {
    if (!desktopBridge) return semShell(reply);
    const origin = String(request.body?.origin ?? '');
    if (!origemValida(origin)) return reply.code(400).send({ error: 'informe { origin } da base' });

    let status: StatusServerLog;
    try {
      status = await desktopBridge.statusServerLog(origin);
    } catch (err) {
      return responderErro(reply, err);
    }

    const achouAlgo = Boolean(status.modulo || status.botaoLer || status.botaoMonitor);
    if (achouAlgo) {
      const dona = baseDoOrigin(origin);
      instalacoes.registrarDeteccao(origin, {
        clienteNome: dona.nome,
        removerAtePadrao: dona.demandaFim,
        modulo: status.modulo ? status.modulo.resourceId || status.modulo.descricao : '',
        botaoId: status.botaoLer?.id ?? '',
        botaoMonitorId: status.botaoMonitor?.id ?? '',
      });
    }
    // Mesmo sem nada instalado, a verificação é registrada se já havia instalação: é
    // assim que o cartão mostra "não encontrado desde tal hora" e oferece a baixa.
    if (instalacoes.obter(origin)) instalacoes.registrarVerificacao(origin, resumir(status));

    return {
      status,
      resumo: resumir(status),
      configurado: Boolean(status.modulo && status.botaoLer && status.leituraOk !== false),
      restante: restante(status),
      instalacao: instalacoes.obter(origin) ?? null,
    };
  });

  app.get<{ Querystring: { origin?: string } }>('/api/serverlog/instalacoes', async (request) => {
    const origin = request.query.origin;
    if (origin) return { instalacao: instalacoes.obter(origin) ?? null };
    return { instalacoes: instalacoes.listar() };
  });

  app.put<{ Body: { origin?: unknown; removerAte?: unknown; demanda?: unknown } }>(
    '/api/serverlog/instalacoes',
    async (request, reply) => {
      const origin = String(request.body?.origin ?? '');
      const removerAte = request.body?.removerAte;
      const demanda = request.body?.demanda;

      if (removerAte !== undefined && (typeof removerAte !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(removerAte))) {
        return reply.code(400).send({ error: 'removerAte deve estar em YYYY-MM-DD' });
      }
      if (demanda !== undefined && typeof demanda !== 'string') {
        return reply.code(400).send({ error: 'demanda deve ser texto' });
      }

      const atualizada = instalacoes.atualizar(origin, {
        ...(removerAte !== undefined ? { removerAte: removerAte as string } : {}),
        ...(demanda !== undefined ? { demanda: (demanda as string).slice(0, 200) } : {}),
      });
      if (!atualizada) return reply.code(404).send({ error: 'nenhuma instalação registrada para essa base' });
      return { instalacao: atualizada };
    },
  );

  /**
   * Dá baixa na instalação — mas só depois de conferir na base.
   *
   * Marcar como removido sem olhar seria confiar na memória de quem clicou, que é
   * exatamente o que este registro existe para não fazer. Se algo ficou, a resposta diz
   * o quê.
   */
  app.post<{ Body: { origin?: unknown } }>('/api/serverlog/removido', async (request, reply) => {
    if (!desktopBridge) return semShell(reply);
    const origin = String(request.body?.origin ?? '');
    if (!origemValida(origin)) return reply.code(400).send({ error: 'informe { origin } da base' });
    if (!instalacoes.obter(origin)) {
      return reply.code(404).send({ error: 'nenhuma instalação registrada para essa base' });
    }

    let status: StatusServerLog;
    try {
      status = await desktopBridge.statusServerLog(origin);
    } catch (err) {
      return responderErro(reply, err);
    }

    const falta = restante(status);
    instalacoes.registrarVerificacao(origin, resumir(status));
    if (falta.length) {
      return reply.code(409).send({ error: `ainda está na base: ${falta.join('; ')}`, restante: falta });
    }
    return { instalacao: instalacoes.marcarRemovido(origin) };
  });

  /** Instalações com prazo vencido — o shell notifica ao abrir. */
  app.get('/api/serverlog/pendencias', async () => ({ pendencias: instalacoes.pendencias() }));
}
