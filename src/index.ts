/** Bootstrap do sankhya-hub: config -> store -> engine -> HTTP. */
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
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
import { registerRoutesWildfly } from './routesWildfly.ts';
import { registerRoutesFerramentas } from './routesFerramentas.ts';
import { Ferramentas } from './ferramentas.ts';
import { NATIVO, Wildfly } from './wildfly.ts';
import { Pastas } from './pastas.ts';
import { registerRoutesSankhya } from './routesSankhya.ts';
import { registerRoutesGitAutosync } from './routesGitAutosync.ts';
import { registerRoutesExperience } from './routesExperience.ts';
import { registerRoutesAgenda } from './routesAgenda.ts';
import { registerRoutesCartao } from './routesCartao.ts';
import { registerRoutesEmail } from './routesEmail.ts';
import { CartaoClientes } from './sankhya/cartao.ts';
import { EmailInterno } from './sankhya/emailInterno.ts';
import { MonitorBases } from './sankhya/monitorBases.ts';
import { GitAutosync } from './gitAutosync.ts';
import { GitAutosyncCli } from './gitAutosyncCli.ts';
import { EvidenciaIa } from './evidenciaIa.ts';
import { ResumoAnotacoes } from './resumoAnotacoes.ts';
import { Pendencias } from './pendencias.ts';
import { Experience } from './sankhya/experience.ts';
import { AgendaRecursos } from './sankhya/agenda.ts';
import { HubHelper } from './sankhya/helper.ts';
import { Credenciais } from './sankhya/credenciais.ts';
import { Cifra } from './sankhya/cifra.ts';
import { migrarSegredosParaShell } from './sankhya/migracaoSegredos.ts';
import { Clientes } from './sankhya/clientes.ts';
import { DesktopBridge } from './sankhya/desktopBridge.ts';
import { SessaoDesktopStore } from './sankhya/sessaoDesktop.ts';

const here = dirname(fileURLToPath(import.meta.url));
/** `src/` em dev, `dist/` no container — a raiz do projeto e sempre o pai. */
const projectRoot = resolve(here, '..');

const PORT = Number(process.env['PORT'] ?? 4000);
const HOST = process.env['HOST'] ?? '0.0.0.0';
const CONFIG_PATH = process.env['CONFIG_PATH'] ?? join(projectRoot, 'config', 'services.yaml');
const DATA_DIR = process.env['DATA_DIR'] ?? join(projectRoot, 'data');
// Unix socket no container; named pipe quando o backend roda nativo no Windows, sob o
// shell desktop. Ver o cliente em `src/docker.ts`.
const DOCKER_SOCKET =
  process.env['DOCKER_SOCKET'] ??
  (process.platform === 'win32' ? '\\\\.\\pipe\\docker_engine' : '/var/run/docker.sock');
const PUBLIC_DIR = join(projectRoot, 'public');

// `scripts/hub-helper.ps1`, rodando nativamente no Windows: DPAPI e git-autosync, que
// nao existem dentro do container Linux. O token e escrito pelo helper e chega aqui
// por bind mount read-only — ver docker-compose.yml.
const HELPER_URL = process.env['HUB_HELPER_URL'] ?? 'http://host.docker.internal:4102';
const HELPER_TOKEN_FILE = process.env['HUB_HELPER_TOKEN_FILE'] ?? '/app/helper-ipc/token.txt';

// Caminhos do WildFly escolhidos na tela da aba Infra. Mesmo arquivo que o
// `wildfly-helper.ps1` sempre leu — rodando nativo, o backend passa a le-lo direto.
// `%APPDATA%` no Windows; no Linux a convencao e' XDG (`~/.config`), e cair no
// `projectRoot` deixaria a escolha da instalacao dentro do pacote instalado, que e'
// substituido a cada atualizacao.
const WILDFLY_CONFIG_FILE =
  process.env['WILDFLY_CONFIG_FILE'] ??
  join(
    process.env['APPDATA'] ??
      process.env['XDG_CONFIG_HOME'] ??
      (process.env['HOME'] ? join(process.env['HOME'], '.config') : projectRoot),
    'sankhya-hub',
    'wildfly.json',
  );
// So usado fora do Windows (container), onde controlar processo do host e impossivel.
const WILDFLY_HELPER_URL = process.env['WILDFLY_HELPER_URL'] ?? 'http://host.docker.internal:4100';

// Shell desktop (desktop/), quando estiver rodando: mesma pasta helper-ipc, token
// proprio (desktop-token.txt) — ver "Decisao de transporte" na especificacao de
// Fase 2. Sem a URL configurada, o hub se comporta exatamente como hoje.
const DESKTOP_BRIDGE_URL = process.env['SANKHYA_DESKTOP_BRIDGE_URL'] ?? '';
const DESKTOP_BRIDGE_TOKEN_FILE =
  process.env['DESKTOP_BRIDGE_TOKEN_FILE'] ?? '/app/helper-ipc/desktop-token.txt';

/**
 * Log legivel em desenvolvimento, JSON cru em producao.
 *
 * O `pino-pretty` e dependencia de DESENVOLVIMENTO, entao ele nao existe no pacote
 * instalado (`npm ci --omit=dev`). Pedir o transport sem ele derruba o boot inteiro com
 * "unable to determine transport target" — erro que nao diz nada sobre o que fazer.
 * Quem sobe o backend empacotado normalmente define `NODE_ENV=production` (o shell
 * define), mas quem nao definir merece um log feio, nao um hub que nao abre.
 */
function transporteDeLog(): { target: string; options: Record<string, string> } | undefined {
  if (process.env['NODE_ENV'] === 'production') return undefined;
  try {
    createRequire(import.meta.url).resolve('pino-pretty');
  } catch {
    return undefined;
  }
  return { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } };
}

async function main(): Promise<void> {
  const startedAt = Date.now();

  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
      transport: transporteDeLog(),
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

  // Nativo no Windows (shell desktop) controla o processo direto; em container delega
  // ao `wildfly-helper.ps1`, como sempre. Ver src/wildfly.ts.
  const helper = new HubHelper(HELPER_URL, HELPER_TOKEN_FILE);
  // O `hubHelper` so serve ao modo container: as rotas de CONFIG do WildFly moram no
  // hub-helper.ps1 (4102), nao no wildfly-helper.ps1 (4100) que controla o processo.
  const wildfly = new Wildfly(WILDFLY_CONFIG_FILE, WILDFLY_HELPER_URL, helper);
  const pastas = new Pastas(helper);

  const clientes = new Clientes(DATA_DIR);
  const agenda = new AgendaRecursos(DATA_DIR);
  const desktopBridge = DESKTOP_BRIDGE_URL
    ? new DesktopBridge(DESKTOP_BRIDGE_URL, DESKTOP_BRIDGE_TOKEN_FILE)
    : undefined;
  // Independente do bridge de Agenda: o shell desktop empurra a sessão da Experience
  // mesmo sem SANKHYA_DESKTOP_BRIDGE_URL configurado (esse env só liga a busca de
  // Agenda). O arquivo de token é o mesmo — o shell o cria sozinho no primeiro boot.
  const sessaoDesktop = new SessaoDesktopStore();

  await app.register(fastifyStatic, { root: PUBLIC_DIR, index: ['index.html'] });
  registerRoutes(app, {
    engine,
    docker,
    wildfly,
    configPath: CONFIG_PATH,
    startedAt,
    cofre,
    desativados,
    configuracoes,
  });
  registerRoutesWildfly(app, wildfly);
  // Terminal, IntelliJ e Claude Code na pasta do repositorio do cliente. Nao depende do
  // git-autosync nem do shell desktop: e' spawn de programa local.
  registerRoutesFerramentas(app, { ferramentas: new Ferramentas() });
  // O bridge entra como caminho preferencial das credenciais: o cofre do shell desktop
  // (safeStorage) substitui as rotas /credentials do hub-helper.ps1 — ver Fase 3 em
  // docs/specs/sankhya-hub-sem-docker-plano.md. Sem shell no ar, cai para o helper.
  const credenciais = new Credenciais(helper, sessaoDesktop, desktopBridge);
  // Senha de base de cliente e senha do app do Gmail: mesmo desenho das credenciais —
  // shell na frente, helper como retaguarda. O blob carrega a marca de quem cifrou.
  const cifra = new Cifra(helper, desktopBridge);
  registerRoutesSankhya(app, {
    helper,
    credenciais,
    clientes,
    agenda,
    pastas,
    wildfly,
    sessaoDesktop,
    desktopBridgeTokenFile: DESKTOP_BRIDGE_TOKEN_FILE,
  });
  // Nativo (Windows ou Linux fora de container) chama o CLI direto, sem shell; dentro do
  // container continua pelo hub-helper.ps1, que e' quem enxerga a maquina do usuario.
  // O agendamento lido difere: Agendador de Tarefas no Windows, crontab no Linux.
  // Ver src/gitAutosyncCli.ts.
  const transporteAutosync = NATIVO ? new GitAutosyncCli() : helper;
  registerRoutesGitAutosync(app, { gitAutosync: new GitAutosync(transporteAutosync) });
  const experience = new Experience(credenciais);
  registerRoutesExperience(app, { experience, clientes, agenda });
  registerRoutesAgenda(app, { agenda, helper, desktopBridge });

  // Criado depois de `Clientes`: as tabelas do cartao e a migracao dos campos unicos
  // moram no construtor dele, e o mesmo arquivo SQLite e aberto pelos dois.
  const cartao = new CartaoClientes(DATA_DIR, helper, cifra);
  registerRoutesCartao(app, { cartao, clientes, monitor: new MonitorBases(cartao) });

  // Mesmo motivo do cartao: as tabelas de contatos/config de e-mail moram no construtor
  // de `Clientes`, e `EmailInterno` so abre o mesmo `sankhya.db`.
  const emailInterno = new EmailInterno(
    DATA_DIR,
    helper,
    undefined,
    cifra,
    // O agente de IA roda na maquina do usuario; em container, quem o alcanca e o helper.
    NATIVO ? new EvidenciaIa() : undefined,
  );
  // Resumo diario das anotacoes marcadas: um e-mail por dia, no horario da config, para
  // o proprio endereco do SMTP. Ver src/resumoAnotacoes.ts.
  // As pendencias entram no mesmo resumo: tarefa atrasada, dia sem OS e e-mail de
  // finalizacao nao enviado sao a mesma pergunta que a anotacao marcada responde.
  const pendencias = new Pendencias(clientes, experience);
  const resumo = new ResumoAnotacoes(clientes, emailInterno, pendencias);
  resumo.iniciar((err) => app.log.warn({ err }, 'resumo diário de anotações falhou'));
  registerRoutesEmail(app, { emailInterno, clientes, experience, resumo });

  // Recifra no formato do shell o que o hub-helper.ps1 gravou. Depois da janela de
  // transicao, e o que permite apagar o helper sem deixar senha ilegivel para tras.
  // Best-effort e idempotente — ver src/sankhya/migracaoSegredos.ts.
  if (desktopBridge) {
    void migrarSegredosParaShell(DATA_DIR, cifra)
      .then(({ migrados, pendentes }) => {
        if (migrados || pendentes) app.log.info({ migrados, pendentes }, 'segredos recifrados para o shell');
      })
      .catch((err: unknown) => app.log.warn({ err }, 'migração de segredos adiada'));
  }

  engine.start();

  const shutdown = async (signal: string) => {
    app.log.info(`recebi ${signal}, encerrando`);
    engine.stop();
    resumo.parar();
    await app.close().catch(() => {});
    store.close();
    clientes.close();
    agenda.close();
    emailInterno.close();
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
