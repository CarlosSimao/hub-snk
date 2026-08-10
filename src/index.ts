import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
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
import { registrarRotasDeLocal } from './rotas/rotasLocal.ts';
import { registrarRotasDeSistema } from './rotas/rotasSistema.ts';
import { abrirJanelaDoAplicativo } from './sistema/abrirJanelaDoAplicativo.ts';
import { observarAlteracoesNosDados, type CacheDescartavel } from './sistema/observadorDeDados.ts';

async function iniciarServidor(): Promise<void> {
  const servidor = Fastify({ logger: { transport: { target: 'pino-pretty' } } });

  /* Antes de qualquer rota: vale também para os arquivos estáticos. */
  registrarProtecaoDeOrigem(servidor);

  await servidor.register(fastifyStatic, {
    root: configuracao.diretorioPublico,
    // O service worker precisa ser servido sem cache para que uma nova versão
    // do app seja detectada já na primeira visita após o deploy local.
    setHeaders(resposta, caminho) {
      if (caminho.endsWith('sw.js')) {
        resposta.header('cache-control', 'no-cache');
      }
    },
  });

  const repositorioDeClientes = new RepositorioClientesArquivo(configuracao.diretorioDeDados);
  const repositorioDeConfiguracao = new RepositorioConfiguracaoArquivo(
    configuracao.diretorioDeDados,
  );
  const repositorioLocal = new RepositorioLocalArquivo(configuracao.diretorioDeDados);

  registrarRotasDeClientes(servidor, repositorioDeClientes, repositorioDeConfiguracao);
  registrarRotasDeConfiguracao(servidor, repositorioDeConfiguracao);
  registrarRotasDeGit(servidor, repositorioDeClientes, repositorioDeConfiguracao);
  registrarRotasDeLocal(servidor, repositorioLocal, repositorioDeConfiguracao);
  registrarRotasDeAtalhos(servidor, repositorioDeConfiguracao);
  registrarRotasDeSistema(servidor);

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

  if (configuracao.abrirJanela) {
    await abrirJanelaDoAplicativo(
      `http://${configuracao.host}:${configuracao.porta}`,
      configuracao.navegador,
    );
  }

  /*
   * A pasta precisa existir para ser vigiada, e numa instalação nova ela só
   * nasceria na primeira gravação.
   */
  await mkdir(configuracao.diretorioDeDados, { recursive: true });

  observarAlteracoesNosDados({
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

iniciarServidor().catch((erro: unknown) => {
  /* Problema no arquivo de dados é recado para o usuário, não pilha de chamadas. */
  if (erro instanceof EsquemaMaisNovoError || erro instanceof ArquivoDeDadosInvalidoError) {
    console.error(erro.message);
  } else {
    console.error('Falha ao iniciar o HUB SNK:', erro);
  }

  process.exitCode = 1;
});
