import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { FSWatcher } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CliDoAutosyncProcesso } from './autosync/cliDoAutosyncProcesso.ts';
import { baixarPacoteDoAutosync } from './autosync/pacoteDoGithub.ts';
import { ServicoDoAutosync } from './autosync/servicoDoAutosync.ts';
import { configuracao } from './configuracao.ts';
import { ArquivoDeDadosInvalidoError, EsquemaMaisNovoError } from './repositorio/arquivoDeDados.ts';
import { RepositorioClientesArquivo } from './repositorio/repositorioClientesArquivo.ts';
import { RepositorioConfiguracaoArquivo } from './repositorio/repositorioConfiguracaoArquivo.ts';
import { RepositorioLembretesArquivo } from './repositorio/repositorioLembretesArquivo.ts';
import { RepositorioContatosArquivo } from './repositorio/repositorioContatosArquivo.ts';
import { RepositorioLocalArquivo } from './repositorio/repositorioLocalArquivo.ts';
import { RepositorioNotificacoesArquivo } from './repositorio/repositorioNotificacoesArquivo.ts';
import { AgendadorDeLembretes } from './notificacoes/agendadorDeLembretes.ts';
import { CentralDeNotificacoes } from './notificacoes/centralDeNotificacoes.ts';
import { EnviadorDeEmail } from './notificacoes/enviadorDeEmail.ts';
import { VerificadorDaAgendaDoDia } from './notificacoes/verificadorDaAgendaDoDia.ts';
import { registrarAutenticacaoDoPainel } from './rotas/autenticacaoDoPainel.ts';
import { registrarProtecaoDeOrigem } from './rotas/protecaoDeOrigem.ts';
import { registrarRotasDeAtalhos } from './rotas/rotasAtalhos.ts';
import { registrarRotasDeAutosync } from './rotas/rotasAutosync.ts';
import { registrarRotasDeClientes } from './rotas/rotasClientes.ts';
import { registrarRotasDeConfiguracao } from './rotas/rotasConfiguracao.ts';
import { registrarRotasDeContatos } from './rotas/rotasContatos.ts';
import { registrarRotasDeGit } from './rotas/rotasGit.ts';
import { registrarRotasDeKanban } from './rotas/rotasKanban.ts';
import { registrarRotasDeMcp } from './rotas/rotasMcp.ts';
import { registrarRotasDeAgenda } from './rotas/rotasAgenda.ts';
import { registrarRotasDeLembretes } from './rotas/rotasLembretes.ts';
import { registrarRotasDeLocal } from './rotas/rotasLocal.ts';
import { registrarRotasDeNotificacoes } from './rotas/rotasNotificacoes.ts';
import { registrarRotasDeOs } from './rotas/rotasOs.ts';
import { registrarRotasDeSankhya } from './rotas/rotasSankhya.ts';
import { registrarRotasDeSistema } from './rotas/rotasSistema.ts';
import { analisarEscopo } from './kanban/analiseDeEscopo.ts';
import { ArquivoDeTarefas } from './kanban/arquivoDeTarefas.ts';
import { KanbanDosProjetos } from './kanban/kanbanDosProjetos.ts';
import { AgendaRecursos } from './sankhya/agenda.ts';
import { importarAgendaDoPeriodo, situacaoDoDiaDoParceiro } from './sankhya/consultasDaAgenda.ts';
import { Credenciais } from './sankhya/credenciais.ts';
import { Experience } from './sankhya/experience.ts';
import { PonteDoDesktop } from './sankhya/ponteDoDesktop.ts';
import { SessaoDoDesktop } from './sankhya/sessaoDoDesktop.ts';
import { abrirShellNaPasta } from './sistema/abrirShell.ts';
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
  registrarAutenticacaoDoPainel(servidor, {
    arquivoTokenDoDesktop: configuracao.ponteDoDesktopTokenFile,
    desligada: configuracao.autenticacaoDoPainelDesligada,
  });

  await servidor.register(fastifyStatic, { root: configuracao.diretorioPublico });

  const repositorioDeClientes = new RepositorioClientesArquivo(configuracao.diretorioDeDados);
  const repositorioDeConfiguracao = new RepositorioConfiguracaoArquivo(
    configuracao.diretorioDeDados,
    configuracao.acessosIniciais,
  );
  const repositorioLocal = new RepositorioLocalArquivo(configuracao.diretorioDeDados);
  const ponteDoDesktop = new PonteDoDesktop(
    configuracao.ponteDoDesktopUrl,
    configuracao.ponteDoDesktopTokenFile,
  );
  const sessaoDoDesktop = new SessaoDoDesktop();
  const credenciaisSankhya = new Credenciais(ponteDoDesktop, sessaoDoDesktop);
  const agendaDeRecursos = new AgendaRecursos(configuracao.diretorioDeDados);
  const kanbanDosProjetos = new KanbanDosProjetos(configuracao.diretorioDeDados);
  const arquivoDeTarefas = new ArquivoDeTarefas(kanbanDosProjetos, async (clienteId, projetoId) => {
    const cliente = await repositorioDeClientes.buscarPorId(clienteId);
    const projeto = cliente?.projetos.find((item) => item.id === projetoId);
    return { cliente: cliente?.nome ?? '', projeto: projeto?.nome ?? '' };
  });
  const experience = new Experience(credenciaisSankhya);
  const repositorioDeLembretes = new RepositorioLembretesArquivo(configuracao.diretorioDeDados);
  const repositorioDeContatos = new RepositorioContatosArquivo(configuracao.diretorioDeDados);
  const enviadorDeEmail = new EnviadorDeEmail(repositorioDeConfiguracao);
  const registradorDasNotificacoes = {
    info: (mensagem: string) => servidor.log.info(mensagem),
    warn: (mensagem: string) => servidor.log.warn(mensagem),
  };
  const centralDeNotificacoes = new CentralDeNotificacoes(
    new RepositorioNotificacoesArquivo(configuracao.diretorioDeDados),
    enviadorDeEmail,
    registradorDasNotificacoes,
  );
  const agendadorDeLembretes = new AgendadorDeLembretes({
    lembretes: repositorioDeLembretes,
    clientes: repositorioDeClientes,
    contatos: repositorioDeContatos,
    caminhoDaLogo: join(configuracao.diretorioPublico, 'img', 'icone-192.png'),
    emitir: (dados) => centralDeNotificacoes.emitir(dados),
    agora: () => new Date(),
    registrador: registradorDasNotificacoes,
  });
  const verificadorDaAgenda = new VerificadorDaAgendaDoDia({
    configuracao: repositorioDeConfiguracao,
    emitir: (dados) => centralDeNotificacoes.emitir(dados),
    jaEmitida: (chave) => centralDeNotificacoes.jaEmitida(chave),
    atualizarAgendaDoDia: async (dia, codusuAlvo) => {
      await importarAgendaDoPeriodo({
        agenda: agendaDeRecursos,
        credenciais: credenciaisSankhya,
        periodo: { de: dia, ate: dia },
        codusuAlvo,
      });
    },
    eventosDoDia: (dia) => agendaDeRecursos.eventos(`${dia} 00:00:00`, `${dia} 23:59:59`),
    situacaoDoDia: async (codparc, dia) => {
      const { situacao } = await situacaoDoDiaDoParceiro({
        credenciais: credenciaisSankhya,
        experience,
        codparc,
        dia,
      });
      return situacao;
    },
    agora: () => new Date(),
    registrador: registradorDasNotificacoes,
  });

  registrarRotasDeClientes(
    servidor,
    repositorioDeClientes,
    repositorioDeConfiguracao,
    configuracao.ponteDoDesktopTokenFile,
    async (clienteId) => {
      await repositorioDeContatos.desvincularDoCliente(clienteId);
      kanbanDosProjetos.removerDoCliente(clienteId);
    },
    {
      quantos: (idDoCliente, idDoProjeto) =>
        kanbanDosProjetos.demandasDoProjeto(idDoCliente, idDoProjeto).length,
      manterOrfaos: (idDoCliente, idDoProjeto) =>
        kanbanDosProjetos.desvincularDoProjeto(idDoCliente, idDoProjeto),
      excluir: (idDoCliente, idDoProjeto) =>
        kanbanDosProjetos.removerDoProjeto(idDoCliente, idDoProjeto),
    },
  );
  registrarRotasDeKanban(servidor, {
    kanban: kanbanDosProjetos,
    clientes: repositorioDeClientes,
    configuracao: repositorioDeConfiguracao,
    analisar: analisarEscopo,
    registrador: servidor.log,
    arquivoDeTarefas,
  });
  registrarRotasDeMcp(servidor, {
    kanban: kanbanDosProjetos,
    clientes: repositorioDeClientes,
    enderecoDoHub: `http://${configuracao.host}:${configuracao.porta}`,
    arquivoDoToken: configuracao.autenticacaoDoPainelDesligada
      ? ''
      : configuracao.ponteDoDesktopTokenFile,
  });
  registrarRotasDeConfiguracao(servidor, repositorioDeConfiguracao);
  registrarRotasDeGit(servidor, repositorioDeClientes, repositorioDeConfiguracao);
  registrarRotasDeLocal(servidor, repositorioLocal, repositorioDeConfiguracao);
  registrarRotasDeAtalhos(servidor, repositorioDeConfiguracao);
  registrarRotasDeAutosync(
    servidor,
    new ServicoDoAutosync({
      cli: new CliDoAutosyncProcesso({
        pasta: configuracao.pastaDoAutosync,
        pacote: configuracao.pacoteDoAutosync,
        baixarPacote: () => baixarPacoteDoAutosync(),
        pastaDoInstalador: configuracao.pastaDoInstalador,
      }),
      listarClientes: () => repositorioDeClientes.listar(),
      abrirTerminal: async (caminho) => {
        const { scriptPadrao } = await repositorioDeConfiguracao.ler();
        await abrirShellNaPasta(caminho, scriptPadrao);
      },
    }),
  );
  let observadorDosDados: FSWatcher | null = null;
  const encerrarOHub = criarEncerramento(async () => {
    agendadorDeLembretes.parar();
    verificadorDaAgenda.parar();
    observadorDosDados?.close();
    await servidor.close();
    agendaDeRecursos.close();
    arquivoDeTarefas.fechar();
    kanbanDosProjetos.close();
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
    experience,
    repositorioDeConfiguracao,
  );
  registrarRotasDeAgenda(
    servidor,
    agendaDeRecursos,
    repositorioDeClientes,
    repositorioDeConfiguracao,
    credenciaisSankhya,
    experience,
  );
  registrarRotasDeOs(servidor, experience, repositorioDeClientes, repositorioDeConfiguracao);
  registrarRotasDeNotificacoes(servidor, centralDeNotificacoes, enviadorDeEmail);
  registrarRotasDeLembretes(
    servidor,
    repositorioDeLembretes,
    repositorioDeClientes,
    repositorioDeContatos,
  );
  registrarRotasDeContatos(servidor, repositorioDeContatos, repositorioDeClientes);

  /*
   * Leitura antecipada dos arquivos: arquivo em esquema desconhecido e
   * migração pendente aparecem no terminal, na largada, em vez de virarem erro
   * na primeira tela que o usuário abrir.
   */
  await Promise.all([
    repositorioDeClientes.listar(),
    repositorioDeConfiguracao.ler(),
    repositorioLocal.listarBases(),
    repositorioDeLembretes.listar(),
    repositorioDeContatos.listar(),
    centralDeNotificacoes.listar(),
  ]);

  await servidor.listen({ port: configuracao.porta, host: configuracao.host });
  servidor.log.info(`Dados em ${configuracao.diretorioDeDados}`);

  agendadorDeLembretes.iniciar();
  verificadorDaAgenda.iniciar();
  // Importa o que os agentes mudaram nos arquivos de tarefas enquanto o HUB SNK estava fechado.
  void arquivoDeTarefas.iniciar();

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
      ['lembretes.json', repositorioDeLembretes],
      ['contatos.json', repositorioDeContatos],
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
