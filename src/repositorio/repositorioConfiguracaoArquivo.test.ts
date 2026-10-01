import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { VERSAO_ATUAL_DO_ESQUEMA } from './arquivoDeDados.ts';
import { RepositorioConfiguracaoArquivo } from './repositorioConfiguracaoArquivo.ts';

let diretorio: string;
let repositorio: RepositorioConfiguracaoArquivo;

beforeEach(async () => {
  diretorio = await mkdtemp(join(tmpdir(), 'hub-snk-configuracao-'));
  repositorio = new RepositorioConfiguracaoArquivo(diretorio);
});

afterEach(async () => {
  await rm(diretorio, { recursive: true, force: true });
});

function caminhoDoArquivo(): string {
  return join(diretorio, 'configuracao.json');
}

describe('RepositorioConfiguracaoArquivo', () => {
  it('devolve os padrões quando o arquivo ainda não existe', async () => {
    const configuracao = await repositorio.ler();

    assert.equal(configuracao.scriptPadrao, '');
    assert.equal(configuracao.intervaloDeExecucaoAutomaticaSegundos, 30);
    assert.equal(configuracao.tempoLimiteSegundos, 5);
    assert.deepEqual(configuracao.atalhos, []);
    assert.equal(configuracao.destinoDosLinks, 'hub');
    assert.equal(configuracao.caminhoDoExecutavelDaIde, '');
    assert.equal(configuracao.experiencePersonId, '');
    assert.equal(configuracao.sankhyaOmCodUsu, '');
  });

  it('grava dentro do envelope e relê o que gravou', async () => {
    await repositorio.salvar({
      scriptPadrao: '  git fetch --all  ',
      intervaloDeExecucaoAutomaticaSegundos: 60,
      tempoLimiteSegundos: 10,
      caminhoDoSchemaMcp: '  C:\\Workspace\\mcp  ',
      atalhos: [{ nome: '  DataGrip  ', caminhoDoExecutavel: '  C:\\datagrip.exe  ' }],
      destinoDosLinks: 'navegador-padrao',
      caminhoDoExecutavelDaIde: '  C:\\idea64.exe  ',
    });

    const gravado = JSON.parse(await readFile(caminhoDoArquivo(), 'utf8'));
    assert.equal(gravado.versaoDoEsquema, VERSAO_ATUAL_DO_ESQUEMA);

    repositorio.descartarCache();
    const configuracao = await repositorio.ler();

    assert.equal(configuracao.scriptPadrao, 'git fetch --all');
    assert.equal(configuracao.caminhoDoSchemaMcp, 'C:\\Workspace\\mcp');
    assert.equal(configuracao.atalhos[0]?.nome, 'DataGrip');
    assert.equal(configuracao.destinoDosLinks, 'navegador-padrao');
    assert.equal(configuracao.caminhoDoExecutavelDaIde, 'C:\\idea64.exe');
  });

  it('dá um id ao atalho cadastrado sem id', async () => {
    const configuracao = await repositorio.salvar({
      scriptPadrao: '',
      intervaloDeExecucaoAutomaticaSegundos: 30,
      tempoLimiteSegundos: 5,
      caminhoDoSchemaMcp: '',
      atalhos: [{ nome: 'DataGrip', caminhoDoExecutavel: 'C:\\datagrip.exe' }],
      destinoDosLinks: 'hub',
      caminhoDoExecutavelDaIde: '',
    });

    assert.match(configuracao.atalhos[0]?.id ?? '', /^[0-9a-f-]{36}$/);
  });

  it('preserva o experiencePersonId entre chamadas de salvar (sem campo na tela)', async () => {
    await repositorio.definirExperiencePersonId('99999');

    await repositorio.salvar({
      scriptPadrao: '',
      intervaloDeExecucaoAutomaticaSegundos: 30,
      tempoLimiteSegundos: 5,
      caminhoDoSchemaMcp: '',
      atalhos: [],
      destinoDosLinks: 'hub',
      caminhoDoExecutavelDaIde: '',
    });

    repositorio.descartarCache();
    const configuracao = await repositorio.ler();
    assert.equal(configuracao.experiencePersonId, '99999');
  });

  it('grava o CODUSU à parte e o preserva ao salvar o formulário', async () => {
    await repositorio.definirSankhyaOmCodUsu('  4817  ');

    await repositorio.salvar({
      scriptPadrao: '',
      intervaloDeExecucaoAutomaticaSegundos: 30,
      tempoLimiteSegundos: 5,
      caminhoDoSchemaMcp: '',
      atalhos: [],
      destinoDosLinks: 'hub',
      caminhoDoExecutavelDaIde: '',
    });

    repositorio.descartarCache();
    const configuracao = await repositorio.ler();
    assert.equal(configuracao.sankhyaOmCodUsu, '4817');
  });

  it('não perde um campo quando dois são gravados ao mesmo tempo', async () => {
    await Promise.all([
      repositorio.definirExperiencePersonId('99999'),
      repositorio.definirSankhyaOmCodUsu('4817'),
    ]);

    repositorio.descartarCache();
    const configuracao = await repositorio.ler();
    assert.equal(configuracao.experiencePersonId, '99999');
    assert.equal(configuracao.sankhyaOmCodUsu, '4817');
  });
});

describe('RepositorioConfiguracaoArquivo com arquivo no formato antigo', () => {
  it('converte os nomes anteriores dos campos, e o tempo limite de milissegundos para segundos', async () => {
    await writeFile(
      caminhoDoArquivo(),
      JSON.stringify({
        scriptPadrao: 'git fetch --all',
        intervaloDeAtualizacaoDoStatusDoBancoSegundos: 45,
        tempoLimiteDeStatusDaBaseMs: 8000,
      }),
      'utf8',
    );

    const configuracao = await repositorio.ler();

    assert.equal(configuracao.intervaloDeExecucaoAutomaticaSegundos, 45);
    assert.equal(configuracao.tempoLimiteSegundos, 8);
    /* Campo que ainda não existia nasce desligado, sem quebrar a leitura. */
    assert.equal(configuracao.caminhoDoSchemaMcp, '');
    assert.equal(configuracao.destinoDosLinks, 'hub');
  });

  it('volta ao padrão um destino desconhecido', async () => {
    await writeFile(
      caminhoDoArquivo(),
      JSON.stringify({
        versaoDoEsquema: VERSAO_ATUAL_DO_ESQUEMA,
        configuracao: {
          scriptPadrao: '',
          destinoDosLinks: 'firefox',
        },
      }),
      'utf8',
    );

    const configuracao = await repositorio.ler();

    assert.equal(configuracao.destinoDosLinks, 'hub');
  });

  it('migra o arquivo e guarda o original', async () => {
    const conteudoAntigo = { scriptPadrao: 'git status', atalhos: [] };
    await writeFile(caminhoDoArquivo(), JSON.stringify(conteudoAntigo), 'utf8');

    await repositorio.ler();

    const gravado = JSON.parse(await readFile(caminhoDoArquivo(), 'utf8'));
    assert.equal(gravado.versaoDoEsquema, VERSAO_ATUAL_DO_ESQUEMA);
    assert.equal(gravado.configuracao.scriptPadrao, 'git status');

    const copia = JSON.parse(await readFile(`${caminhoDoArquivo()}.esquema0`, 'utf8'));
    assert.deepEqual(copia, conteudoAntigo);
  });
});

describe('RepositorioConfiguracaoArquivo — acessos', () => {
  const CONFIGURACAO_SEM_ACESSOS = {
    scriptPadrao: '',
    intervaloDeExecucaoAutomaticaSegundos: 30,
    tempoLimiteSegundos: 5,
    caminhoDoSchemaMcp: '',
    atalhos: [],
    destinoDosLinks: 'hub' as const,
    caminhoDoExecutavelDaIde: '',
  };

  it('sem perfil do instalador, nasce desenvolvedor com tudo visível', async () => {
    const configuracao = await repositorio.ler();

    assert.equal(configuracao.perfil, 'desenvolvedor');
    assert.deepEqual(configuracao.funcionalidadesOcultas, []);
  });

  it('aplica o preset do perfil escolhido no instalador', async () => {
    const doGerente = new RepositorioConfiguracaoArquivo(diretorio, {
      perfil: 'gerente-de-projeto',
      terceiro: false,
      autosyncInstalado: true,
    });

    const configuracao = await doGerente.ler();

    assert.equal(configuracao.perfil, 'gerente-de-projeto');
    assert.deepEqual(configuracao.funcionalidadesOcultas, [
      'cliente.repositorios',
      'local',
      'autosync',
      'cliente.autosync',
    ]);
  });

  it('sem o Git AutoSync no instalador, oculta a aba Git e a seção do cliente', async () => {
    const semAutosync = new RepositorioConfiguracaoArquivo(diretorio, {
      perfil: 'desenvolvedor',
      terceiro: false,
      autosyncInstalado: false,
    });

    const configuracao = await semAutosync.ler();

    assert.deepEqual(configuracao.funcionalidadesOcultas, ['autosync', 'cliente.autosync']);
  });

  it('sem o Git AutoSync no instalador, não repete o que o preset já oculta', async () => {
    const consultorSemAutosync = new RepositorioConfiguracaoArquivo(diretorio, {
      perfil: 'consultor',
      terceiro: false,
      autosyncInstalado: false,
    });

    const configuracao = await consultorSemAutosync.ler();

    assert.deepEqual(configuracao.funcionalidadesOcultas, [
      'cliente.repositorios',
      'autosync',
      'cliente.autosync',
    ]);
  });

  it('aplica as caixas desmarcadas no instalador no lugar do preset do perfil', async () => {
    const consultorAjustado = new RepositorioConfiguracaoArquivo(diretorio, {
      perfil: 'consultor',
      terceiro: false,
      autosyncInstalado: true,
      funcionalidadesOcultas: ['os', 'cliente.projetos'],
    });

    const configuracao = await consultorAjustado.ler();

    assert.equal(configuracao.perfil, 'consultor');
    assert.deepEqual(configuracao.funcionalidadesOcultas, ['os', 'cliente.projetos']);
  });

  it('lista vazia do instalador deixa tudo visível, mesmo com preset', async () => {
    const gerenteComTudo = new RepositorioConfiguracaoArquivo(diretorio, {
      perfil: 'gerente-de-projeto',
      terceiro: false,
      autosyncInstalado: true,
      funcionalidadesOcultas: [],
    });

    const configuracao = await gerenteComTudo.ler();

    assert.deepEqual(configuracao.funcionalidadesOcultas, []);
  });

  it('descarta funcionalidade desconhecida vinda do instalador', async () => {
    const comChaveAntiga = new RepositorioConfiguracaoArquivo(diretorio, {
      perfil: 'consultor',
      terceiro: false,
      autosyncInstalado: true,
      funcionalidadesOcultas: ['os', 'nao-existe-mais'],
    });

    const configuracao = await comChaveAntiga.ler();

    assert.deepEqual(configuracao.funcionalidadesOcultas, ['os']);
  });

  it('sem o Git AutoSync, oculta a aba Git por cima das caixas do instalador', async () => {
    const semAutosync = new RepositorioConfiguracaoArquivo(diretorio, {
      perfil: 'desenvolvedor',
      terceiro: false,
      autosyncInstalado: false,
      funcionalidadesOcultas: ['os'],
    });

    const configuracao = await semAutosync.ler();

    assert.deepEqual(configuracao.funcionalidadesOcultas, ['os', 'autosync', 'cliente.autosync']);
  });

  it('com outro perfil gravado, ignora as caixas do instalador e usa o preset dele', async () => {
    await writeFile(
      caminhoDoArquivo(),
      JSON.stringify({
        versaoDoEsquema: VERSAO_ATUAL_DO_ESQUEMA,
        configuracao: { perfil: 'analista' },
      }),
      'utf8',
    );

    const configuracao = await new RepositorioConfiguracaoArquivo(diretorio, {
      perfil: 'desenvolvedor',
      terceiro: false,
      autosyncInstalado: true,
      funcionalidadesOcultas: ['os'],
    }).ler();

    assert.equal(configuracao.perfil, 'analista');
    assert.deepEqual(configuracao.funcionalidadesOcultas, [
      'cliente.repositorios',
      'autosync',
      'cliente.autosync',
    ]);
  });

  it('ignora o Git AutoSync do instalador quando o arquivo já tem acessos', async () => {
    await repositorio.salvar({
      ...CONFIGURACAO_SEM_ACESSOS,
      perfil: 'desenvolvedor',
      funcionalidadesOcultas: [],
    });

    const configuracao = await new RepositorioConfiguracaoArquivo(diretorio, {
      perfil: 'desenvolvedor',
      terceiro: false,
      autosyncInstalado: false,
    }).ler();

    assert.deepEqual(configuracao.funcionalidadesOcultas, []);
  });

  it('ignora o perfil do instalador quando o arquivo já tem acessos', async () => {
    await repositorio.salvar({
      ...CONFIGURACAO_SEM_ACESSOS,
      perfil: 'desenvolvedor',
      funcionalidadesOcultas: ['os'],
    });

    const configuracao = await new RepositorioConfiguracaoArquivo(diretorio, {
      perfil: 'consultor',
      terceiro: false,
      autosyncInstalado: true,
    }).ler();

    assert.equal(configuracao.perfil, 'desenvolvedor');
    assert.deepEqual(configuracao.funcionalidadesOcultas, ['os']);
  });

  it('preserva os acessos gravados quando o salvar não os manda', async () => {
    await repositorio.salvar({
      ...CONFIGURACAO_SEM_ACESSOS,
      perfil: 'consultor',
      funcionalidadesOcultas: ['cliente.repositorios'],
    });

    await repositorio.salvar(CONFIGURACAO_SEM_ACESSOS);

    repositorio.descartarCache();
    const configuracao = await repositorio.ler();
    assert.equal(configuracao.perfil, 'consultor');
    assert.deepEqual(configuracao.funcionalidadesOcultas, ['cliente.repositorios']);
  });

  it('sem Terceiro no instalador, nasce sem o acesso de terceiro', async () => {
    const configuracao = await repositorio.ler();

    assert.equal(configuracao.terceiro, false);
  });

  it('aplica o Terceiro do instalador a arquivo que já tem perfil mas não tem o campo', async () => {
    await writeFile(
      caminhoDoArquivo(),
      JSON.stringify({
        versaoDoEsquema: VERSAO_ATUAL_DO_ESQUEMA,
        configuracao: { perfil: 'analista', funcionalidadesOcultas: [] },
      }),
      'utf8',
    );

    const configuracao = await new RepositorioConfiguracaoArquivo(diretorio, {
      perfil: 'desenvolvedor',
      terceiro: true,
      autosyncInstalado: true,
    }).ler();

    assert.equal(configuracao.terceiro, true);
    assert.equal(configuracao.perfil, 'analista');
  });

  it('ignora o Terceiro do instalador quando o arquivo já tem o campo', async () => {
    await repositorio.salvar({ ...CONFIGURACAO_SEM_ACESSOS, terceiro: false });

    const configuracao = await new RepositorioConfiguracaoArquivo(diretorio, {
      perfil: 'desenvolvedor',
      terceiro: true,
      autosyncInstalado: true,
    }).ler();

    assert.equal(configuracao.terceiro, false);
  });

  it('preserva o Terceiro gravado quando o salvar não o manda', async () => {
    await repositorio.salvar({ ...CONFIGURACAO_SEM_ACESSOS, terceiro: true });

    await repositorio.salvar(CONFIGURACAO_SEM_ACESSOS);

    repositorio.descartarCache();
    assert.equal((await repositorio.ler()).terceiro, true);
  });

  it('descarta funcionalidade repetida ou desconhecida lida do arquivo', async () => {
    await writeFile(
      caminhoDoArquivo(),
      JSON.stringify({
        versaoDoEsquema: VERSAO_ATUAL_DO_ESQUEMA,
        configuracao: {
          perfil: 'analista',
          funcionalidadesOcultas: ['agenda', 'agenda', 'removida-numa-versao-nova'],
        },
      }),
      'utf8',
    );

    const configuracao = await repositorio.ler();

    assert.equal(configuracao.perfil, 'analista');
    assert.deepEqual(configuracao.funcionalidadesOcultas, ['agenda']);
  });

  it('nasce com o SMTP vazio e o alerta da agenda desligado', async () => {
    const configuracao = await repositorio.ler();

    assert.equal(configuracao.smtp.host, '');
    assert.equal(configuracao.smtp.porta, 587);
    assert.equal(configuracao.smtp.seguranca, 'starttls');
    assert.equal(configuracao.alertaDaAgenda.ativo, false);
    assert.equal(configuracao.alertaDaAgenda.toleranciaMinutos, 30);
  });

  it('preserva o SMTP gravado quando a tela não o manda', async () => {
    const base = {
      scriptPadrao: '',
      intervaloDeExecucaoAutomaticaSegundos: 30,
      tempoLimiteSegundos: 5,
      caminhoDoSchemaMcp: '',
      atalhos: [],
      destinoDosLinks: 'hub' as const,
      caminhoDoExecutavelDaIde: '',
    };
    await repositorio.salvar({
      ...base,
      smtp: {
        host: '  smtp.empresa.com.br  ',
        porta: 465,
        seguranca: 'ssl',
        usuario: 'eu@empresa.com.br',
        senha: ' segredo ',
        remetente: 'eu@empresa.com.br',
        destinatario: 'eu@empresa.com.br',
      },
      alertaDaAgenda: { ativo: true, toleranciaMinutos: 10, enviarEmail: false },
    });

    await repositorio.salvar(base);
    repositorio.descartarCache();
    const configuracao = await repositorio.ler();

    assert.equal(configuracao.smtp.host, 'smtp.empresa.com.br');
    assert.equal(configuracao.smtp.senha, ' segredo ');
    assert.equal(configuracao.alertaDaAgenda.ativo, true);
    assert.equal(configuracao.alertaDaAgenda.toleranciaMinutos, 10);
  });

  it('descarta a segurança do SMTP editada à mão com valor desconhecido', async () => {
    await writeFile(
      caminhoDoArquivo(),
      JSON.stringify({
        versaoDoEsquema: VERSAO_ATUAL_DO_ESQUEMA,
        configuracao: { smtp: { host: 'smtp.x', seguranca: 'tls13', porta: 'errada' } },
      }),
      'utf8',
    );

    const { smtp } = await repositorio.ler();

    assert.equal(smtp.host, 'smtp.x');
    assert.equal(smtp.seguranca, 'starttls');
    assert.equal(smtp.porta, 587);
  });
});
