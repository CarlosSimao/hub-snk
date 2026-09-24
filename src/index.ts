import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { FSWatcher } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { configuracao } from './configuracao.ts';
import { ArquivoDeDadosInvalidoError, EsquemaMaisNovoError } from './repositorio/arquivoDeDados.ts';
import { RepositorioClientesArquivo } from './repositorio/repositorioClientesArquivo.ts';
import { RepositorioConfiguracaoArquivo } from './repositorio/repositorioConfiguracaoArquivo.ts';
import { RepositorioLocalArquivo } from './repositorio/repositorioLocalArquivo.ts';
import { registrarProtecaoDeOrigem } from './rotas/protecaoDeOrigem.ts';
import { registrarRotasDeAtalhos } from './rotas/rotasAtalhos.ts';
import { registrarRotasDeClientes } from './rotas/rotasClientes.ts';
import { registrarRotasDeConfiguracao } from './rotas/rotasConfiguracao.ts';
import { registrarRotasDeGit } from './rotas/rotasGit.ts';
import { registrarRotasDeAgenda } from './rotas/rotasAgenda.ts';
import { registrarRotasDeLocal } from './rotas/rotasLocal.ts';
import { registrarRotasDeSankhya } from './rotas/rotasSankhya.ts';
import { registrarRotasDeSistema } from './rotas/rotasSistema.ts';
import { AgendaRecursos } from './sankhya/agenda.ts';
import { Credenciais } from './sankhya/credenciais.ts';
import { Experience } from './sankhya/experience.ts';
import { PonteDoDesktop } from './sankhya/ponteDoDesktop.ts';
import { SessaoDoDesktop } from './sankhya/sessaoDoDesktop.ts';
import { observarAlteracoesNosDados, type CacheDescartavel } from './sistema/observadorDeDados.ts';

async function iniciarServidor(): Promise<void> {
  const servidor = Fastify({
    /*
     * Sem terminal, o log vai para arquivo (o shell desktop grava a saída em
     * `backend.log`), e os códigos de cor ANSI só atrapalhariam a leitura.
     */
    logger: {
      transport: {
        target: 'pino-pretty',
        options: { colorize: Boolean(process.stdout.isTTY) },
      },
    },
    /*
     * Sem isso, uma conexão de log ao vivo (SSE) aberta seguraria o `close()`
     * do encerramento para sempre.
     */
    forceCloseConnections: true,
  });

  /* Antes de qualquer rota: vale também para os arquivos estáticos. */
  registrarProtecaoDeOrigem(servidor);

  await servidor.register(fastifyStatic, { root: configuracao.diretorioPublico });

  const repositorioDeClientes = new RepositorioClientesArquivo(configuracao.diretorioDeDados);
  const repositorioDeConfiguracao = new RepositorioConfiguracaoArquivo(
    configuracao.diretorioDeDados,
  );
  const repositorioLocal = new RepositorioLocalArquivo(configuracao.diretorioDeDados);
  const ponteDoDesktop = new PonteDoDesktop(
    configuracao.ponteDoDesktopUrl,
    configuracao.ponteDoDesktopTokenFile,
  );
  const sessaoDoDesktop = new SessaoDoDesktop();
  const credenciaisSankhya = new Credenciais(ponteDoDesktop, sessaoDoDesktop);
  const agendaDeRecursos = new AgendaRecursos(configuracao.diretorioDeDados);
  const experience = new Experience(credenciaisSankhya);

  registrarRotasDeClientes(
    servidor,
    repositorioDeClientes,
    repositorioDeConfiguracao,
    configuracao.ponteDoDesktopTokenFile,
  );
  registrarRotasDeConfiguracao(servidor, repositorioDeConfiguracao);
  registrarRotasDeGit(servidor, repositorioDeClientes, repositorioDeConfiguracao);
  registrarRotasDeLocal(servidor, repositorioLocal, repositorioDeConfiguracao);
  registrarRotasDeAtalhos(servidor, repositorioDeConfiguracao);
  let observadorDosDados: FSWatcher | null = null;
  const encerrarOHub = criarEncerramento(async () => {
    observadorDosDados?.close();
    await servidor.close();
    agendaDeRecursos.close();
  });
  process.once('SIGINT', encerrarOHub);
  process.once('SIGTERM', encerrarOHub);

  registrarRotasDeSistema(servidor, {
    arquivoTokenDoDesktop: configuracao.ponteDoDesktopTokenFile,
    encerrar: encerrarOHub,
  });
  registrarRotasDeSankhya(
    servidor,
    credenciaisSankhya,
    sessaoDoDesktop,
    configuracao.ponteDoDesktopTokenFile,
  );
  registrarRotasDeAgenda(
    servidor,
    agendaDeRecursos,
    repositorioDeClientes,
    credenciaisSankhya,
    experience,
  );

  /*
   * Leitura antecipada dos três arquivos: arquivo em esquema desconhecido e
   * migração pendente aparecem no terminal, na largada, em vez de virarem erro
   * na primeira tela que o usuário abrir.
   */
  await Promise.all([
    repositorioDeClientes.listar(),
    repositorioDeConfiguracao.ler(),
    repositorioLocal.listarBases(),
  ]);

  await servidor.listen({ port: configuracao.porta, host: configuracao.host });
  servidor.log.info(`Dados em ${configuracao.diretorioDeDados}`);

  /*
   * A pasta precisa existir para ser vigiada, e numa instalação nova ela só
   * nasceria na primeira gravação.
   */
  await mkdir(configuracao.diretorioDeDados, { recursive: true });

  observadorDosDados = observarAlteracoesNosDados({
    diretorioDeDados: configuracao.diretorioDeDados,
    cachesPorArquivo: new Map<string, CacheDescartavel>([
      ['clientes.json', repositorioDeClientes],
      ['configuracao.json', repositorioDeConfiguracao],
      ['local.json', repositorioLocal],
    ]),
    registrador: {
      info: (mensagem) => servidor.log.info(mensagem),
      warn: (mensagem) => servidor.log.warn(mensagem),
    },
  });
}

/**
 * Encerramento limpo: fecha as conexões e o SQLite antes de sair, em vez de
 * deixar o processo morrer no meio de uma gravação. Disparado pelo Ctrl+C do
 * terminal, pelo `SIGTERM` do Linux e do `node --watch`, e pelo shell desktop
 * via `POST /api/sistema/encerrar` — no Windows o `kill()` não entrega sinal.
 *
 * Roda uma vez só: um sinal que chegue durante o pedido do shell não fecha o
 * servidor duas vezes.
 */
function criarEncerramento(fecharRecursos: () => Promise<void>): () => void {
  let jaEncerrando = false;

  return () => {
    if (jaEncerrando) {
      return;
    }
    jaEncerrando = true;

    fecharRecursos()
      .catch((erro: unknown) => {
        console.error('Falha ao encerrar o HUB SNK:', erro);
        process.exitCode = 1;
      })
      .finally(() => process.exit());
  };
}

iniciarServidor().catch((erro: unknown) => {
  /* Problema no arquivo de dados é recado para o usuário, não pilha de chamadas. */
  if (erro instanceof EsquemaMaisNovoError || erro instanceof ArquivoDeDadosInvalidoError) {
    console.error(erro.message);
  } else {
    console.error('Falha ao iniciar o HUB SNK:', erro);
  }

  process.exitCode = 1;
});
