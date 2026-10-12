import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { ArquivoGuardado } from '../drive/clienteDoDrive.ts';
import type { SituacaoDaConta } from '../drive/contaDoGoogle.ts';
import type { DadosDeNotificacao } from '../notificacoes/centralDeNotificacoes.ts';
import type { ConfiguracaoDeBackup } from '../tipos.ts';
import { conferirPacote } from './pacoteDeDados.ts';
import { aplicarRestauracaoPendente } from './restauracaoPendente.ts';
import {
  BackupSemPastaError,
  CopiaDoDriveNaoEncontradaError,
  nomeDaCopiaNoDrive,
  nomeDoBackup,
  ServicoDeBackup,
} from './servicoDeBackup.ts';

const UMA_HORA_MS = 3_600_000;
const UM_MINUTO_MS = 60_000;

let raiz: string;
let dados: string;
let destino: string;
let estado: string;
let relogio: Date;
let configuracao: ConfiguracaoDeBackup;
let conta: SituacaoDaConta;
let notificacoes: DadosDeNotificacao[];
let drive: DriveFalso;

/** O Drive em memória: uma pasta só, com os arquivos que o HUB SNK guardou nela. */
class DriveFalso {
  readonly arquivos = new Map<string, { nome: string; conteudo: Buffer }>();
  envios = 0;
  falha: Error | null = null;

  async garantirPastaDoHub(): Promise<string> {
    return 'pasta-do-hub';
  }

  async listarArquivosGuardados(): Promise<ArquivoGuardado[]> {
    return [...this.arquivos].map(([id, arquivo]) => ({
      id,
      nome: arquivo.nome,
      tamanho: arquivo.conteudo.length,
      modificadoEm: '2026-10-07T12:00:00.000Z',
    }));
  }

  async enviarArquivo(parametros: {
    idDoArquivo?: string;
    nome: string;
    conteudo: Buffer;
  }): Promise<string> {
    if (this.falha) {
      throw this.falha;
    }
    this.envios += 1;
    const id = parametros.idDoArquivo ?? `arquivo-${this.arquivos.size + 1}`;
    this.arquivos.set(id, { nome: parametros.nome, conteudo: parametros.conteudo });
    return id;
  }

  async baixarArquivo(id: string): Promise<Buffer> {
    return this.arquivos.get(id)?.conteudo ?? Buffer.alloc(0);
  }
}

function criarServico(): ServicoDeBackup {
  return new ServicoDeBackup({
    diretorioDeDados: dados,
    pastaDeEstado: estado,
    versaoDoAplicativo: '2.7.0',
    nomeDaMaquina: 'NOTE-DA-ANA',
    lerConfiguracao: async () => configuracao,
    conta: { situacao: async () => conta },
    drive,
    agora: () => relogio,
    registrador: { info: () => {}, warn: () => {} },
    emitirNotificacao: async (dadosDaNotificacao) => {
      notificacoes.push(dadosDaNotificacao);
    },
  });
}

function avancar(milissegundos: number): void {
  relogio = new Date(relogio.getTime() + milissegundos);
}

/** Cada gravação muda o tamanho: a impressão não depende da resolução da data do disco. */
let gravacoes = 0;
async function alterarDados(): Promise<void> {
  gravacoes += 1;
  await writeFile(join(dados, 'clientes.json'), `{"clientes":"${'x'.repeat(gravacoes)}"}`);
}

async function backupsGravados(): Promise<string[]> {
  return (await readdir(destino).catch(() => [])).sort();
}

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), 'hub-snk-servico-backup-'));
  dados = join(raiz, 'dados');
  destino = join(raiz, 'destino');
  estado = join(raiz, 'estado');
  relogio = new Date(2026, 9, 7, 9, 0, 0);
  configuracao = {
    ativo: true,
    pasta: destino,
    intervaloHoras: 24,
    copiasMantidas: 3,
    espelharNoDrive: false,
  };
  conta = {
    configurado: true,
    cofreDisponivel: true,
    conectado: true,
    email: 'ana@exemplo.com',
    podeGuardarCopia: true,
    autorizando: false,
    erro: '',
  };
  notificacoes = [];
  drive = new DriveFalso();
  gravacoes = 0;
  await mkdir(dados, { recursive: true });
  await alterarDados();
});

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

describe('backup periódico numa pasta', () => {
  it('grava o primeiro backup na primeira conferência, com o nome da data', async () => {
    const servico = criarServico();

    await servico.conferir();

    assert.deepEqual(await backupsGravados(), ['hub-snk-backup-2026-10-07-0900.zip']);
    const situacao = await servico.situacao();
    assert.equal(situacao.local.erro, '');
    assert.equal(situacao.local.arquivo, join(destino, 'hub-snk-backup-2026-10-07-0900.zip'));
    assert.equal(
      conferirPacote(await readFile(situacao.local.arquivo)).versaoDoAplicativo,
      '2.7.0',
    );
  });

  it('não grava de novo antes do intervalo, mesmo com os dados alterados', async () => {
    const servico = criarServico();
    await servico.conferir();

    avancar(23 * UMA_HORA_MS);
    await alterarDados();
    await servico.conferir();

    assert.equal((await backupsGravados()).length, 1);
  });

  it('não grava cópia idêntica: passado o intervalo, espera os dados mudarem', async () => {
    const servico = criarServico();
    await servico.conferir();

    avancar(48 * UMA_HORA_MS);
    await servico.conferir();
    assert.equal((await backupsGravados()).length, 1);

    await alterarDados();
    await servico.conferir();
    assert.equal((await backupsGravados()).length, 2);
  });

  it('mantém só as cópias mais recentes e não apaga o que não é backup dele', async () => {
    const servico = criarServico();
    await mkdir(destino, { recursive: true });
    await writeFile(join(destino, 'planilha.xlsx'), 'do usuário');
    await writeFile(join(destino, 'hub-snk-backup-anotacoes.zip'), 'parecido, mas não é');

    for (let dia = 0; dia < 5; dia += 1) {
      await alterarDados();
      await servico.conferir();
      avancar(24 * UMA_HORA_MS);
    }

    assert.deepEqual(await backupsGravados(), [
      'hub-snk-backup-2026-10-09-0900.zip',
      'hub-snk-backup-2026-10-10-0900.zip',
      'hub-snk-backup-2026-10-11-0900.zip',
      'hub-snk-backup-anotacoes.zip',
      'planilha.xlsx',
    ]);
  });

  it('desligado ou sem pasta, não grava nada', async () => {
    configuracao = { ...configuracao, ativo: false };
    await criarServico().conferir();
    configuracao = { ...configuracao, ativo: true, pasta: '' };
    await criarServico().conferir();

    assert.deepEqual(await backupsGravados(), []);
  });

  it('a falha fica na situação, vira uma notificação só e adia a próxima tentativa', async () => {
    // Um arquivo no lugar da pasta: o `mkdir` do destino falha.
    await writeFile(destino, 'não é pasta');
    const servico = criarServico();

    await servico.conferir();
    avancar(UM_MINUTO_MS);
    await servico.conferir();

    assert.notEqual((await servico.situacao()).local.erro, '');
    assert.equal(notificacoes.length, 1);
    assert.match(notificacoes[0]?.chave ?? '', /^backup-local-falhou:2026-10-07$/);

    await rm(destino);
    avancar(10 * UM_MINUTO_MS);
    await servico.conferir();

    assert.equal((await backupsGravados()).length, 1);
    assert.equal((await servico.situacao()).local.erro, '');
  });

  it('o backup pedido pela tela grava mesmo sem mudança, e recusa sem pasta', async () => {
    const servico = criarServico();
    await servico.conferir();
    avancar(UM_MINUTO_MS);

    await servico.fazerBackupLocal();
    assert.equal((await backupsGravados()).length, 2);

    configuracao = { ...configuracao, pasta: '' };
    await assert.rejects(servico.fazerBackupLocal(), BackupSemPastaError);
  });
});

describe('cópia no Google Drive', () => {
  beforeEach(() => {
    configuracao = { ...configuracao, ativo: false, espelharNoDrive: true };
  });

  it('só envia depois que os dados param de mudar entre duas conferências', async () => {
    const servico = criarServico();

    await servico.conferir();
    assert.equal(drive.envios, 0);

    avancar(UM_MINUTO_MS);
    await alterarDados();
    await servico.conferir();
    assert.equal(drive.envios, 0);

    avancar(UM_MINUTO_MS);
    await servico.conferir();
    assert.equal(drive.envios, 1);
    assert.deepEqual(
      [...drive.arquivos.values()].map((arquivo) => arquivo.nome),
      ['hub-snk-dados-NOTE-DA-ANA.zip'],
    );
  });

  it('não reenvia o que já subiu, e substitui o mesmo arquivo quando os dados mudam', async () => {
    const servico = criarServico();
    await servico.conferir();
    avancar(UM_MINUTO_MS);
    await servico.conferir();

    avancar(UMA_HORA_MS);
    await servico.conferir();
    assert.equal(drive.envios, 1);

    await alterarDados();
    await servico.conferir();
    avancar(UM_MINUTO_MS);
    await servico.conferir();

    assert.equal(drive.envios, 2);
    assert.equal(drive.arquivos.size, 1);
  });

  it('respeita o espaço mínimo entre dois envios automáticos', async () => {
    const servico = criarServico();
    await servico.conferir();
    avancar(UM_MINUTO_MS);
    await servico.conferir();

    await alterarDados();
    avancar(UM_MINUTO_MS);
    await servico.conferir();
    avancar(UM_MINUTO_MS);
    await servico.conferir();
    assert.equal(drive.envios, 1);

    avancar(10 * UM_MINUTO_MS);
    await servico.conferir();
    assert.equal(drive.envios, 2);
  });

  it('não envia com a conta desconectada ou sem a permissão de guardar a cópia', async () => {
    const servico = criarServico();
    conta = { ...conta, conectado: false };
    await servico.conferir();
    avancar(UM_MINUTO_MS);
    await servico.conferir();

    conta = { ...conta, conectado: true, podeGuardarCopia: false };
    avancar(UM_MINUTO_MS);
    await servico.conferir();

    assert.equal(drive.envios, 0);
    assert.equal(notificacoes.length, 0);
  });

  it('a falha do envio fica na situação e notifica; o envio seguinte limpa o erro', async () => {
    const servico = criarServico();
    drive.falha = new Error('sem rede');
    await servico.conferir();
    avancar(UM_MINUTO_MS);
    await servico.conferir();

    assert.equal((await servico.situacao()).drive.erro, 'sem rede');
    assert.match(notificacoes[0]?.chave ?? '', /^backup-drive-falhou:/);

    drive.falha = null;
    await servico.enviarAoDrive();

    assert.equal((await servico.situacao()).drive.erro, '');
    assert.equal(drive.envios, 1);
  });

  it('esquecer a conta faz a próxima receber a cópia, mesmo sem mudança nos dados', async () => {
    const servico = criarServico();
    await servico.enviarAoDrive();

    await servico.esquecerDrive();
    avancar(UM_MINUTO_MS);
    await servico.conferir();
    avancar(UM_MINUTO_MS);
    await servico.conferir();

    assert.equal(drive.envios, 2);
    assert.equal((await servico.situacao()).drive.nomeDoArquivo, 'hub-snk-dados-NOTE-DA-ANA.zip');
  });
});

describe('restauração', () => {
  it('a cópia do Drive fica à espera e é aplicada na largada seguinte', async () => {
    const servico = criarServico();
    await servico.enviarAoDrive();
    const [copia] = await servico.copiasNoDrive();
    const original = await readFile(join(dados, 'clientes.json'), 'utf8');
    await writeFile(join(dados, 'clientes.json'), 'estragado');

    await servico.prepararRestauracaoDoDrive(copia?.id ?? '');

    assert.equal((await servico.situacao()).restauracaoPendente?.geradoEm, relogio.toISOString());
    assert.equal(await readFile(join(dados, 'clientes.json'), 'utf8'), 'estragado');

    const resultado = await aplicarRestauracaoPendente({
      pastaDeEstado: estado,
      diretorioDeDados: dados,
      versaoDoAplicativo: '2.7.0',
      agora: relogio,
    });

    assert.equal(resultado?.erro, '');
    assert.equal(await readFile(join(dados, 'clientes.json'), 'utf8'), original);
    assert.equal((await servico.situacao()).restauracaoPendente, null);
    // O que estava na pasta antes da restauração fica guardado.
    assert.equal(existsSync(resultado?.copiaAnterior ?? ''), true);
  });

  it('recusa id que não é de uma cópia guardada pelo HUB SNK', async () => {
    await assert.rejects(
      criarServico().prepararRestauracaoDoDrive('id-de-outro-arquivo'),
      CopiaDoDriveNaoEncontradaError,
    );
  });

  it('recusa arquivo que não é backup, sem agendar nada', async () => {
    const naoEhBackup = join(raiz, 'qualquer.zip');
    await writeFile(naoEhBackup, 'isto não é um zip');
    const servico = criarServico();

    await assert.rejects(servico.prepararRestauracaoDoArquivo(naoEhBackup), /não é um backup/);
    assert.equal((await servico.situacao()).restauracaoPendente, null);
  });

  it('cancelar tira o backup da espera', async () => {
    const servico = criarServico();
    const { arquivo } = await servico.fazerBackupLocal();
    await servico.prepararRestauracaoDoArquivo(arquivo);

    await servico.cancelarRestauracao();

    assert.equal((await servico.situacao()).restauracaoPendente, null);
    assert.equal(
      await aplicarRestauracaoPendente({
        pastaDeEstado: estado,
        diretorioDeDados: dados,
        versaoDoAplicativo: '2.7.0',
        agora: relogio,
      }),
      null,
    );
  });
});

describe('nomes dos arquivos', () => {
  it('o backup leva data e hora locais', () => {
    assert.equal(nomeDoBackup(new Date(2026, 0, 5, 7, 3)), 'hub-snk-backup-2026-01-05-0703.zip');
  });

  it('a cópia do Drive leva o nome da máquina, sem o que o Drive estranharia', () => {
    assert.equal(nomeDaCopiaNoDrive('NOTE-DA-ANA'), 'hub-snk-dados-NOTE-DA-ANA.zip');
    assert.equal(nomeDaCopiaNoDrive('PC do João / sala 2'), 'hub-snk-dados-PC-do-João-sala-2.zip');
    assert.equal(nomeDaCopiaNoDrive(''), 'hub-snk-dados-computador.zip');
  });
});
