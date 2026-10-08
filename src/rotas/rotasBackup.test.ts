import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { ServicoDeBackup } from '../backup/servicoDeBackup.ts';
import { ErroDoDrive, type ArquivoGuardado } from '../drive/clienteDoDrive.ts';
import { RepositorioConfiguracaoArquivo } from '../repositorio/arquivo/repositorioConfiguracaoArquivo.ts';
import { PonteDoDesktopIndisponivelError } from '../sankhya/ponteDoDesktop.ts';
import { registrarRotasDeBackup } from './rotasBackup.ts';

let raiz: string;
let dados: string;
let destino: string;
let servidor: FastifyInstance;
let configuracao: RepositorioConfiguracaoArquivo;
let copiasNoDrive: Map<string, Buffer>;
let arquivoEscolhido: string | null;
let reinicios: number;
let shellNoAr: boolean;
let driveForaDoAr: boolean;

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), 'hub-snk-rotas-backup-'));
  dados = join(raiz, 'dados');
  destino = join(raiz, 'destino');
  await mkdir(dados, { recursive: true });
  await writeFile(join(dados, 'clientes.json'), '{"versaoDoEsquema":1,"clientes":[]}');

  configuracao = new RepositorioConfiguracaoArquivo(dados);
  copiasNoDrive = new Map();
  arquivoEscolhido = null;
  reinicios = 0;
  shellNoAr = true;
  driveForaDoAr = false;

  const falharSeForaDoAr = () => {
    if (driveForaDoAr) {
      throw new ErroDoDrive('Não foi possível falar com o Google Drive: sem rede.', 503, 'rede');
    }
  };
  const backup = new ServicoDeBackup({
    diretorioDeDados: dados,
    pastaDeEstado: join(raiz, 'estado'),
    versaoDoAplicativo: '2.7.0',
    nomeDaMaquina: 'PC',
    lerConfiguracao: async () => (await configuracao.ler()).backup,
    conta: {
      situacao: async () => ({
        configurado: true,
        cofreDisponivel: true,
        conectado: true,
        email: 'ana@exemplo.com',
        podeGuardarCopia: true,
        autorizando: false,
        erro: '',
      }),
    },
    drive: {
      garantirPastaDoHub: async () => {
        falharSeForaDoAr();
        return 'pasta';
      },
      listarArquivosGuardados: async (): Promise<ArquivoGuardado[]> =>
        [...copiasNoDrive].map(([id, conteudo]) => ({
          id,
          nome: 'hub-snk-dados-PC.zip',
          tamanho: conteudo.length,
          modificadoEm: '2026-10-07T12:00:00.000Z',
        })),
      enviarArquivo: async ({ idDoArquivo, conteudo }) => {
        const id = idDoArquivo ?? '1CopiaDoHubNoDrive';
        copiasNoDrive.set(id, conteudo);
        return id;
      },
      baixarArquivo: async (id) => copiasNoDrive.get(id) ?? Buffer.alloc(0),
    },
    agora: () => new Date(2026, 9, 7, 9, 0, 0),
    registrador: { info: () => {}, warn: () => {} },
  });

  servidor = Fastify();
  registrarRotasDeBackup(servidor, {
    backup,
    configuracao,
    selecionarArquivoDeBackup: async () => arquivoEscolhido,
    reiniciarAplicativo: async () => {
      if (!shellNoAr) {
        throw new PonteDoDesktopIndisponivelError('shell fora do ar');
      }
      reinicios += 1;
    },
  });
});

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

function salvar(payload: Record<string, unknown>) {
  return servidor.inject({ method: 'PUT', url: '/api/backup/configuracao', payload });
}

function configuracaoValida(extra: Record<string, unknown> = {}) {
  return {
    ativo: true,
    pasta: destino,
    intervaloHoras: 12,
    copiasMantidas: 5,
    espelharNoDrive: false,
    ...extra,
  };
}

describe('GET /api/backup', () => {
  it('numa instalação nova vem desligado, sem pasta e sem nada feito', async () => {
    const resposta = await servidor.inject({ method: 'GET', url: '/api/backup' });

    assert.deepEqual(resposta.json(), {
      configuracao: {
        ativo: false,
        pasta: '',
        intervaloHoras: 24,
        copiasMantidas: 10,
        espelharNoDrive: false,
      },
      local: { ultimoEm: '', arquivo: '', erro: '' },
      drive: { ultimoEm: '', erro: '', nomeDoArquivo: 'hub-snk-dados-PC.zip' },
      restauracaoPendente: null,
    });
  });
});

describe('PUT /api/backup/configuracao', () => {
  it('grava e devolve a situação com a configuração nova', async () => {
    const resposta = await salvar(configuracaoValida({ espelharNoDrive: true }));

    assert.equal(resposta.statusCode, 200);
    assert.deepEqual(resposta.json().configuracao, configuracaoValida({ espelharNoDrive: true }));
    assert.deepEqual(
      (await configuracao.ler()).backup,
      configuracaoValida({ espelharNoDrive: true }),
    );
  });

  it('não é apagada quando as configurações gerais são salvas depois', async () => {
    await salvar(configuracaoValida());

    await configuracao.salvar({
      scriptPadrao: '',
      intervaloDeExecucaoAutomaticaSegundos: 30,
      tempoLimiteSegundos: 5,
      caminhoDoSchemaMcp: '',
      atalhos: [],
      destinoDosLinks: 'hub',
      caminhoDoExecutavelDaIde: '',
    });

    assert.deepEqual((await configuracao.ler()).backup, configuracaoValida());
  });

  it('recusa ligar sem pasta, caminho relativo e números fora do aceito', async () => {
    const recusadas = [
      configuracaoValida({ pasta: '' }),
      configuracaoValida({ pasta: 'backups' }),
      configuracaoValida({ intervaloHoras: 0 }),
      configuracaoValida({ intervaloHoras: 1.5 }),
      configuracaoValida({ copiasMantidas: 0 }),
      configuracaoValida({ copiasMantidas: 9999 }),
      { ativo: true },
    ];
    for (const payload of recusadas) {
      assert.equal((await salvar(payload)).statusCode, 400, JSON.stringify(payload));
    }
    assert.equal((await configuracao.ler()).backup.ativo, false);
  });

  it('aceita desligado e sem pasta', async () => {
    assert.equal((await salvar(configuracaoValida({ ativo: false, pasta: '' }))).statusCode, 200);
  });
});

describe('POST /api/backup/local', () => {
  it('grava o backup na pasta configurada e devolve onde ficou', async () => {
    await salvar(configuracaoValida());

    const resposta = await servidor.inject({ method: 'POST', url: '/api/backup/local' });

    assert.equal(resposta.statusCode, 200);
    assert.deepEqual(await readdir(destino), ['hub-snk-backup-2026-10-07-0900.zip']);
    assert.equal(
      resposta.json().local.arquivo,
      join(destino, 'hub-snk-backup-2026-10-07-0900.zip'),
    );
  });

  it('sem pasta escolhida responde 400', async () => {
    const resposta = await servidor.inject({ method: 'POST', url: '/api/backup/local' });

    assert.equal(resposta.statusCode, 400);
    assert.match(resposta.json().mensagem, /Escolha a pasta/);
  });

  it('pasta que não dá para gravar responde com o motivo', async () => {
    await writeFile(destino, 'um arquivo no lugar da pasta');
    await salvar(configuracaoValida());

    const resposta = await servidor.inject({ method: 'POST', url: '/api/backup/local' });

    assert.equal(resposta.statusCode, 500);
    assert.match(resposta.json().mensagem, /Não foi possível gravar o backup/);
  });
});

describe('cópia no Google Drive', () => {
  it('envia agora e lista a cópia guardada', async () => {
    const envio = await servidor.inject({ method: 'POST', url: '/api/backup/drive' });
    assert.equal(envio.statusCode, 200);
    assert.notEqual(envio.json().drive.ultimoEm, '');

    const copias = await servidor.inject({ method: 'GET', url: '/api/backup/drive/copias' });
    assert.deepEqual(
      copias.json().copias.map((copia: ArquivoGuardado) => copia.nome),
      ['hub-snk-dados-PC.zip'],
    );
  });

  it('falha do Drive responde 502 com a mensagem dele', async () => {
    driveForaDoAr = true;

    const resposta = await servidor.inject({ method: 'POST', url: '/api/backup/drive' });

    assert.equal(resposta.statusCode, 502);
    assert.match(resposta.json().mensagem, /Não foi possível falar com o Google Drive/);
  });
});

describe('restauração', () => {
  function pedir(payload: Record<string, unknown>) {
    return servidor.inject({ method: 'POST', url: '/api/backup/restauracao', payload });
  }

  it('prepara a restauração da cópia do Drive, que fica à espera do reinício', async () => {
    await servidor.inject({ method: 'POST', url: '/api/backup/drive' });
    const [id] = [...copiasNoDrive.keys()];

    const resposta = await pedir({ origem: 'drive', idDoArquivo: id });

    assert.equal(resposta.statusCode, 200);
    assert.notEqual(resposta.json().restauracaoPendente, null);
  });

  it('prepara a restauração do arquivo escolhido no seletor do sistema', async () => {
    await salvar(configuracaoValida());
    const backup = await servidor.inject({ method: 'POST', url: '/api/backup/local' });
    arquivoEscolhido = backup.json().local.arquivo;

    const resposta = await pedir({ origem: 'arquivo' });

    assert.equal(resposta.statusCode, 200);
    assert.notEqual(resposta.json().restauracaoPendente, null);
  });

  it('cancelar o seletor responde 204, sem agendar nada', async () => {
    const resposta = await pedir({ origem: 'arquivo' });

    assert.equal(resposta.statusCode, 204);
    const situacao = await servidor.inject({ method: 'GET', url: '/api/backup' });
    assert.equal(situacao.json().restauracaoPendente, null);
  });

  it('arquivo que não é backup responde 400', async () => {
    arquivoEscolhido = join(raiz, 'outro.zip');
    await writeFile(arquivoEscolhido, 'não é zip');

    const resposta = await pedir({ origem: 'arquivo' });

    assert.equal(resposta.statusCode, 400);
    assert.match(resposta.json().mensagem, /não é um backup do HUB SNK/);
  });

  it('cópia do Drive desconhecida responde 404, e origem inválida, 400', async () => {
    assert.equal(
      (await pedir({ origem: 'drive', idDoArquivo: '1NaoExisteNoDrive' })).statusCode,
      404,
    );
    assert.equal((await pedir({ origem: 'drive', idDoArquivo: '../x' })).statusCode, 400);
    assert.equal((await pedir({ origem: 'caminho', caminho: 'C:\\x.zip' })).statusCode, 400);
  });

  it('DELETE tira a restauração da espera', async () => {
    await servidor.inject({ method: 'POST', url: '/api/backup/drive' });
    await pedir({ origem: 'drive', idDoArquivo: [...copiasNoDrive.keys()][0] });

    const resposta = await servidor.inject({ method: 'DELETE', url: '/api/backup/restauracao' });

    assert.equal(resposta.json().restauracaoPendente, null);
  });
});

describe('POST /api/backup/reiniciar', () => {
  it('pede o reinício ao aplicativo', async () => {
    const resposta = await servidor.inject({ method: 'POST', url: '/api/backup/reiniciar' });

    assert.equal(resposta.statusCode, 202);
    assert.equal(reinicios, 1);
  });

  it('sem o aplicativo no ar responde 503 com shellIndisponivel', async () => {
    shellNoAr = false;

    const resposta = await servidor.inject({ method: 'POST', url: '/api/backup/reiniciar' });

    assert.equal(resposta.statusCode, 503);
    assert.equal(resposta.json().shellIndisponivel, true);
  });
});
