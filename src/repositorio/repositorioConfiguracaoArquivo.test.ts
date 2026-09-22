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
  });

  it('grava dentro do envelope e relê o que gravou', async () => {
    await repositorio.salvar({
      scriptPadrao: '  git fetch --all  ',
      intervaloDeExecucaoAutomaticaSegundos: 60,
      tempoLimiteSegundos: 10,
      caminhoDoSchemaMcp: '  C:\\Workspace\\mcp  ',
      atalhos: [{ nome: '  DataGrip  ', caminhoDoExecutavel: '  C:\\datagrip.exe  ' }],
    });

    const gravado = JSON.parse(await readFile(caminhoDoArquivo(), 'utf8'));
    assert.equal(gravado.versaoDoEsquema, VERSAO_ATUAL_DO_ESQUEMA);

    repositorio.descartarCache();
    const configuracao = await repositorio.ler();

    assert.equal(configuracao.scriptPadrao, 'git fetch --all');
    assert.equal(configuracao.caminhoDoSchemaMcp, 'C:\\Workspace\\mcp');
    assert.equal(configuracao.atalhos[0]?.nome, 'DataGrip');
  });

  it('dá um id ao atalho cadastrado sem id', async () => {
    const configuracao = await repositorio.salvar({
      scriptPadrao: '',
      intervaloDeExecucaoAutomaticaSegundos: 30,
      tempoLimiteSegundos: 5,
      caminhoDoSchemaMcp: '',
      atalhos: [{ nome: 'DataGrip', caminhoDoExecutavel: 'C:\\datagrip.exe' }],
    });

    assert.match(configuracao.atalhos[0]?.id ?? '', /^[0-9a-f-]{36}$/);
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
