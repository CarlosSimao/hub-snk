/** Bootstrap do sankhya-hub: config -> store -> engine -> HTTP. */
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { loadConfig, ConfigError } from './config.ts';
import { Store } from './store.ts';
import { DockerClient } from './docker.ts';
import { Engine } from './engine.ts';
import { Cofre } from './segredos.ts';
import { Desativados } from './desativados.ts';
import { ConfiguracoesCheck } from './configuracoesCheck.ts';
import { registerRoutes } from './routes.ts';
import { registerRoutesSankhya } from './routesSankhya.ts';
import { registerRoutesGitAutosync } from './routesGitAutosync.ts';
import { registerRoutesExperience } from './routesExperience.ts';
import { registerRoutesAgenda } from './routesAgenda.ts';
import { GitAutosync } from './gitAutosync.ts';
import { Experience } from './sankhya/experience.ts';
import { AgendaRecursos } from './sankhya/agenda.ts';
import { HubHelper } from './sankhya/helper.ts';
import { Credenciais } from './sankhya/credenciais.ts';
import { Clientes } from './sankhya/clientes.ts';

const here = dirname(fileURLToPath(import.meta.url));
/** `src/` em dev, `dist/` no container — a raiz do projeto e sempre o pai. */
const projectRoot = resolve(here, '..');

const PORT = Number(process.env['PORT'] ?? 4000);
const HOST = process.env['HOST'] ?? '0.0.0.0';
const CONFIG_PATH = process.env['CONFIG_PATH'] ?? join(projectRoot, 'config', 'services.yaml');
const DATA_DIR = process.env['DATA_DIR'] ?? join(projectRoot, 'data');
const DOCKER_SOCKET = process.env['DOCKER_SOCKET'] ?? '/var/run/docker.sock';
const PUBLIC_DIR = join(projectRoot, 'public');

// `scripts/hub-helper.ps1`, rodando nativamente no Windows: DPAPI e git-autosync, que
// nao existem dentro do container Linux. O token e escrito pelo helper e chega aqui
// por bind mount read-only — ver docker-compose.yml.
const HELPER_URL = process.env['HUB_HELPER_URL'] ?? 'http://host.docker.internal:4102';
const HELPER_TOKEN_FILE = process.env['HUB_HELPER_TOKEN_FILE'] ?? '/app/helper-ipc/token.txt';

async function main(): Promise<void> {
  const startedAt = Date.now();

  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
      transport:
        process.env['NODE_ENV'] === 'production'
          ? undefined
          : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
    },
    // O SSE e o polling do dashboard gerariam uma linha de log por request; só o que
    // o app loga interessa. (Fastify 5 marca esta opção como deprecated em favor de
    // `logController`, mas o substituto exige implementar o controller inteiro —
    // trocar quando formos para o Fastify 6.)
    disableRequestLogging: true,
  });

  // Carregado antes da config: os valores preenchidos pelo painel entram na
  // interpolacao junto com o ambiente, e vencem em caso de conflito.
  const cofre = new Cofre(DATA_DIR);
  const desativados = new Desativados(DATA_DIR);
  const configuracoes = new ConfiguracoesCheck(DATA_DIR);

  let config;
  try {
    config = await loadConfig(CONFIG_PATH, process.env, cofre);
  } catch (err) {
    if (err instanceof ConfigError) {
      // Sem config valida nao ha o que monitorar — falha alto e claro em vez de subir vazio.
      app.log.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const store = new Store(DATA_DIR);
  const docker = new DockerClient(DOCKER_SOCKET);
  const engine = new Engine(config, store, docker, cofre, desativados, configuracoes);

  const helper = new HubHelper(HELPER_URL, HELPER_TOKEN_FILE);
  const clientes = new Clientes(DATA_DIR);
  const agenda = new AgendaRecursos(DATA_DIR);

  await app.register(fastifyStatic, { root: PUBLIC_DIR, index: ['index.html'] });
  registerRoutes(app, {
    engine,
    docker,
    configPath: CONFIG_PATH,
    startedAt,
    cofre,
    desativados,
    configuracoes,
  });
  const credenciais = new Credenciais(helper);
  registerRoutesSankhya(app, { helper, credenciais, clientes });
  registerRoutesGitAutosync(app, { gitAutosync: new GitAutosync(helper) });
  registerRoutesExperience(app, { experience: new Experience(credenciais), clientes });
  registerRoutesAgenda(app, { agenda });

  engine.start();

  const shutdown = async (signal: string) => {
    app.log.info(`recebi ${signal}, encerrando`);
    engine.stop();
    await app.close().catch(() => {});
    store.close();
    clientes.close();
    agenda.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: PORT, host: HOST });
  app.log.info(
    `sankhya-hub em http://localhost:${PORT} — ${config.services.length} serviço(s), ` +
      `docker ${docker.available ? 'disponível' : 'indisponível'}`,
  );
}

main().catch((err) => {
  console.error('falha ao subir o sankhya-hub:', err);
  process.exit(1);
});
