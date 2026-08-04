/**
 * API HTTP do hub.
 *
 * `GET /api/stream` e a via principal: o dashboard abre um SSE, recebe o snapshot
 * completo uma vez e depois so deltas por check. Os endpoints REST existem para
 * scripts, para o primeiro paint e para quem preferir polling.
 */
import type { FastifyInstance } from 'fastify';
import { loadConfig, ConfigError } from './config.ts';
import type { Engine } from './engine.ts';
import type { DockerClient } from './docker.ts';
import { executeAction, ActionNotFoundError } from './actions.ts';
import type { Cofre } from './segredos.ts';
import type { Desativados } from './desativados.ts';
import type { ConfiguracoesCheck } from './configuracoesCheck.ts';
import type { Alert, CheckSnapshot } from './types.ts';

/** Piso e teto aceitos no formulário de configurações do check, em segundos. */
const INTERVALO_MIN_S = 2;
const TIMEOUT_MIN_S = 1;
const TIMEOUT_MAX_S = 120;

export interface RouteDeps {
  engine: Engine;
  docker: DockerClient;
  configPath: string;
  startedAt: number;
  cofre: Cofre;
  desativados: Desativados;
  configuracoes: ConfiguracoesCheck;
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { engine, docker, configPath, startedAt, cofre, desativados, configuracoes } = deps;

  /**
   * Recarrega a config. Cada servico e interpolado com o ambiente global mais os
   * segredos DO PROPRIO projeto.
   *
   * O cofre VENCE `process.env`: se voce digitou o valor no painel, foi a coisa mais
   * explicita que aconteceu — sem isso, uma senha errada herdada do `.env` seria
   * impossivel de corrigir pela tela.
   */
  const recarregar = () => loadConfig(configPath, process.env, cofre);

  app.get('/api/healthz', async () => ({
    ok: true,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    services: engine.config.services.length,
    dockerAvailable: docker.available,
  }));

  app.get('/api/state', async () => engine.snapshot());

  app.get('/api/stream', (request, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Sem isto, um proxy com buffer segura os eventos e a tela parece travada.
      'x-accel-buffering': 'no',
    });

    const send = (event: string, data: unknown) => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send('snapshot', engine.snapshot());

    const onCheck = (snapshot: CheckSnapshot) => send('check', snapshot);
    const onReload = () => send('snapshot', engine.snapshot());
    const onAlert = (alert: Alert) => send('alert', alert);
    engine.on('check', onCheck);
    engine.on('reload', onReload);
    engine.on('alert', onAlert);

    // Comentario SSE periodico: mantem viva a conexao atras de proxy com idle timeout.
    const keepAlive = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(': keep-alive\n\n');
    }, 20000);
    keepAlive.unref();

    const cleanup = () => {
      clearInterval(keepAlive);
      engine.off('check', onCheck);
      engine.off('reload', onReload);
      engine.off('alert', onAlert);
    };
    request.raw.on('close', cleanup);
    reply.raw.on('close', cleanup);
  });

  app.post<{ Params: { serviceId: string; checkId: string } }>(
    '/api/services/:serviceId/checks/:checkId/run',
    async (request, reply) => {
      const { serviceId, checkId } = request.params;
      const snapshot = await engine.runNow(serviceId, checkId);
      if (!snapshot) return reply.code(404).send({ error: `check "${serviceId}/${checkId}" não existe` });
      return snapshot;
    },
  );

  /**
   * Liga/desliga o monitoramento do projeto inteiro: checks param de rodar, sem I/O,
   * outcome congelado — e nao contam para o semaforo global enquanto desabilitados.
   */
  app.post<{ Params: { serviceId: string }; Body: { enabled: boolean } }>(
    '/api/services/:serviceId/enabled',
    async (request, reply) => {
      const { serviceId } = request.params;
      const { enabled } = request.body ?? {};

      if (!engine.config.services.some((s) => s.id === serviceId)) {
        return reply.code(404).send({ error: `projeto "${serviceId}" não existe` });
      }
      if (typeof enabled !== 'boolean') {
        return reply.code(400).send({ error: 'envie { enabled: boolean }' });
      }

      desativados.definirServico(serviceId, !enabled);
      engine.refreshDisabled();

      const servico = engine.snapshot().services.find((s) => s.id === serviceId);
      return { ok: true, service: servico };
    },
  );

  /** Mesma ideia, mas so para um check — o resto do projeto continua rodando. */
  app.post<{ Params: { serviceId: string; checkId: string }; Body: { enabled: boolean } }>(
    '/api/services/:serviceId/checks/:checkId/enabled',
    async (request, reply) => {
      const { serviceId, checkId } = request.params;
      const { enabled } = request.body ?? {};

      const service = engine.config.services.find((s) => s.id === serviceId);
      if (!service) return reply.code(404).send({ error: `projeto "${serviceId}" não existe` });
      if (!service.checks.some((c) => c.id === checkId)) {
        return reply.code(404).send({ error: `check "${serviceId}/${checkId}" não existe` });
      }
      if (typeof enabled !== 'boolean') {
        return reply.code(400).send({ error: 'envie { enabled: boolean }' });
      }

      desativados.definirCheck(serviceId, checkId, !enabled);
      engine.refreshDisabled();

      const snapshot = engine.snapshot().services.find((s) => s.id === serviceId)?.checks
        .find((c) => c.checkId === checkId);
      return { ok: true, check: snapshot };
    },
  );

  /**
   * Grava o intervalo e o timeout deste check, vindos do formulário "Configurações", e
   * reagenda so ele com o valor novo — sem esperar o ciclo em curso terminar.
   */
  app.post<{
    Params: { serviceId: string; checkId: string };
    Body: { intervalSeconds: number; timeoutSeconds: number };
  }>('/api/services/:serviceId/checks/:checkId/settings', async (request, reply) => {
    const { serviceId, checkId } = request.params;
    const { intervalSeconds, timeoutSeconds } = request.body ?? {};

    const service = engine.config.services.find((s) => s.id === serviceId);
    if (!service) return reply.code(404).send({ error: `projeto "${serviceId}" não existe` });
    if (!service.checks.some((c) => c.id === checkId)) {
      return reply.code(404).send({ error: `check "${serviceId}/${checkId}" não existe` });
    }
    if (!Number.isInteger(intervalSeconds) || intervalSeconds < INTERVALO_MIN_S) {
      return reply.code(400).send({ error: `intervalo mínimo é ${INTERVALO_MIN_S} segundos` });
    }
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < TIMEOUT_MIN_S || timeoutSeconds > TIMEOUT_MAX_S) {
      return reply
        .code(400)
        .send({ error: `timeout precisa estar entre ${TIMEOUT_MIN_S} e ${TIMEOUT_MAX_S} segundos` });
    }

    configuracoes.definir(serviceId, checkId, {
      intervalMs: intervalSeconds * 1000,
      timeoutMs: timeoutSeconds * 1000,
    });
    engine.refreshCheckConfig(serviceId, checkId);

    const snapshot = engine.snapshot().services.find((s) => s.id === serviceId)?.checks
      .find((c) => c.checkId === checkId);
    return { ok: true, check: snapshot };
  });

  app.post<{ Params: { serviceId: string; actionId: string } }>(
    '/api/services/:serviceId/actions/:actionId',
    async (request, reply) => {
      const { serviceId, actionId } = request.params;
      try {
        const result = await executeAction(
          engine.config,
          serviceId,
          actionId,
          docker,
          (sid, cid) => engine.runNow(sid, cid),
        );
        return reply.code(result.ok ? 200 : 502).send(result);
      } catch (err) {
        if (err instanceof ActionNotFoundError) return reply.code(404).send({ error: err.message });
        throw err;
      }
    },
  );

  app.get<{ Querystring: { limit?: string } }>('/api/alerts', async (request) => ({
    alerts: engine.recentAlerts(Math.min(200, Number(request.query.limit) || 50)),
  }));

  /**
   * Emite um alerta sintetico. Existe para voce validar a permissao do navegador e o
   * visual da notificacao sem precisar derrubar um servico de producao para testar.
   */
  app.post('/api/alerts/test', async () => {
    const alert = engine.emitTestAlert();
    return { ok: true, alert };
  });

  app.post('/api/reload', async (_request, reply) => {
    try {
      const config = await recarregar();
      engine.reload(config);
      return { ok: true, services: config.services.length };
    } catch (err) {
      if (err instanceof ConfigError) {
        // Config ruim nao derruba o que ja esta rodando: o engine segue com a anterior.
        return reply.code(400).send({ ok: false, error: err.message });
      }
      throw err;
    }
  });

  /**
   * Valor atual de cada variavel de um projeto, na mesma precedencia da interpolacao
   * real: cofre venceria `process.env`, que vence o default embutido em `${VAR:default}`
   * no YAML.
   *
   * Rota separada do `/api/state` de proposito: o snapshot geral viaja em todo GET e em
   * todo evento SSE (reconexao, reload, cada ciclo de check) — colocar o valor la faria
   * a senha trafegar a cada atualizacao do dashboard. Aqui so quando o formulario abre.
   */
  app.get<{ Params: { serviceId: string } }>(
    '/api/services/:serviceId/env',
    async (request, reply) => {
      const { serviceId } = request.params;

      const nomes = engine.config.envVarsByService[serviceId];
      if (!nomes) return reply.code(404).send({ error: `projeto "${serviceId}" não existe` });

      const doCofre = cofre.valoresDe(serviceId);
      const defaults = engine.config.envVarDefaultsByService[serviceId] ?? {};

      const valores = Object.fromEntries(
        nomes.map((nome) => [nome, doCofre[nome] ?? process.env[nome] ?? defaults[nome] ?? '']),
      );

      return { valores };
    },
  );

  /**
   * Grava as variaveis de um projeto e ja aplica.
   *
   * Aceita apenas variaveis que o YAML do proprio projeto cita — um POST arbitrario
   * nao planta nome nenhum. Cada projeto grava no proprio espaco de nomes, entao
   * configurar um nunca alcanca a credencial de outro.
   */
  app.post<{ Params: { serviceId: string }; Body: Record<string, unknown> }>(
    '/api/services/:serviceId/env',
    async (request, reply) => {
      const { serviceId } = request.params;

      const permitidas = engine.config.envVarsByService[serviceId];
      if (!permitidas) return reply.code(404).send({ error: `projeto "${serviceId}" não existe` });

      const corpo = request.body;
      if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
        return reply.code(400).send({ error: 'envie um objeto { VARIAVEL: "valor" }' });
      }

      const aceitas = new Set(permitidas);
      const entradas: Record<string, string> = {};
      const recusadas: string[] = [];

      for (const [nome, valor] of Object.entries(corpo)) {
        if (!aceitas.has(nome)) {
          recusadas.push(nome);
          continue;
        }
        if (typeof valor !== 'string') {
          return reply.code(400).send({ error: `o valor de ${nome} precisa ser texto` });
        }
        // Espaco em volta e quase sempre acidente de copiar e colar, e uma senha com
        // espaco invisivel no fim falha a autenticacao sem dar pista nenhuma.
        entradas[nome] = valor.trim();
      }

      if (recusadas.length) {
        return reply
          .code(400)
          .send({ error: `variáveis não usadas por "${serviceId}": ${recusadas.join(', ')}` });
      }

      cofre.gravar(serviceId, entradas);

      // Aplica na hora: sem isto o formulario salvaria e o semaforo continuaria cinza
      // ate alguem recarregar a config na mao.
      try {
        engine.reload(await recarregar());
      } catch (err) {
        if (err instanceof ConfigError) {
          return reply.code(400).send({ ok: false, error: err.message });
        }
        throw err;
      }

      // Mede de novo agora. Sem isto o check afetado seguiria mostrando "defina a
      // variavel X" ate o proximo ciclo — um minuto inteiro de mensagem errada logo
      // depois de o usuario ter preenchido exatamente aquilo. O resultado chega pelo SSE.
      engine.runService(serviceId);

      const servico = engine.snapshot().services.find((s) => s.id === serviceId);
      return { ok: true, envVars: servico?.envVars ?? [] };
    },
  );
}
