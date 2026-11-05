import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConsultaDoRemoto } from './consultaDoRemoto.ts';
import {
  interpretarArvore,
  verificarBranchPrincipal,
  type Coleta,
} from './situacaoDoRepositorio.ts';

const CABECALHO = (branch: string, distancia: string): string =>
  [
    '# branch.oid abc123',
    `# branch.head ${branch}`,
    '# branch.upstream origin/main',
    `# branch.ab ${distancia}`,
  ].join('\n');

interface Opcoes {
  branch?: string;
  distancia?: string;
  arquivos?: string[];
  branchPrincipal?: string | undefined;
  consulta?: ConsultaDoRemoto | undefined;
  principalExisteNoRemoto?: boolean | null;
}

const CONSULTA_OK: ConsultaDoRemoto = { consultadoEm: 1, ok: true };

function coletaDe(opcoes: Opcoes = {}): Coleta {
  const saida = [
    CABECALHO(opcoes.branch ?? 'main', opcoes.distancia ?? '+0 -0'),
    ...(opcoes.arquivos ?? []),
  ];

  return {
    arvore: interpretarArvore(saida.join('\n')),
    urlDoRemoto: 'https://exemplo.com/alfa.git',
    operacaoEmAndamento: null,
    itensNoStash: 0,
    mcpRastreado: false,
    branchPrincipal: 'branchPrincipal' in opcoes ? opcoes.branchPrincipal : 'main',
    consultaDoRemoto: 'consulta' in opcoes ? opcoes.consulta : CONSULTA_OK,
    principalExisteNoRemoto: opcoes.principalExisteNoRemoto ?? true,
  };
}

function codigos(coleta: Coleta): string[] {
  return verificarBranchPrincipal(coleta).map((pendencia) => pendencia.codigo);
}

describe('interpretarArvore — distância para o remoto', () => {
  it('lê os commits à frente e atrás do remoto', () => {
    const arvore = interpretarArvore(CABECALHO('main', '+2 -3'));

    assert.equal(arvore.commitsAFrente, 2);
    assert.equal(arvore.commitsAtras, 3);
    assert.equal(arvore.remotoDoUpstream, 'origin');
  });

  it('sem upstream não há distância nem remoto', () => {
    const arvore = interpretarArvore('# branch.oid abc\n# branch.head main');

    assert.equal(arvore.commitsAtras, 0);
    assert.equal(arvore.remotoDoUpstream, null);
  });
});

describe('verificarBranchPrincipal', () => {
  it('pede a branch principal quando o cadastro não a tem', () => {
    assert.deepEqual(codigos(coletaDe({ branchPrincipal: undefined })), [
      'branch-principal-nao-informada',
    ]);
  });

  it('acusa estar fora da principal, com o comando para voltar', () => {
    const [pendencia] = verificarBranchPrincipal(coletaDe({ branch: 'feat/x' }));

    assert.equal(pendencia?.codigo, 'fora-da-branch-principal');
    assert.equal(pendencia?.severidade, 'atencao');
    assert.equal(pendencia?.comandoSugerido, 'git switch main');
  });

  it('trata o HEAD desanexado como fora da principal', () => {
    assert.deepEqual(codigos(coletaDe({ branch: '(detached)' })), ['fora-da-branch-principal']);
  });

  it('fetch nunca rodado: não avisa atraso, mesmo com o -M velho do status', () => {
    assert.deepEqual(codigos(coletaDe({ consulta: undefined, distancia: '+0 -4' })), []);
  });

  it('fetch falhou: remoto não consultado, severidade desconhecido', () => {
    const [pendencia] = verificarBranchPrincipal(
      coletaDe({ consulta: { consultadoEm: 1, ok: false }, distancia: '+0 -4' }),
    );

    assert.equal(pendencia?.codigo, 'remoto-nao-consultado');
    assert.equal(pendencia?.severidade, 'desconhecido');
    assert.equal(pendencia?.comandoSugerido, 'git fetch');
  });

  it('atrás, sem alterações: pull --ff-only', () => {
    const [pendencia] = verificarBranchPrincipal(coletaDe({ distancia: '+0 -2' }));

    assert.equal(pendencia?.codigo, 'branch-principal-atras');
    assert.equal(pendencia?.comandoSugerido, 'git pull --ff-only');
  });

  it('atrás, com alteração rastreada ou arquivo novo: pendência com alterações', () => {
    assert.deepEqual(codigos(coletaDe({ distancia: '+0 -2', arquivos: ['1 .M N... a'] })), [
      'branch-principal-atras-com-alteracoes',
    ]);
    assert.deepEqual(codigos(coletaDe({ distancia: '+0 -2', arquivos: ['? novo.txt'] })), [
      'branch-principal-atras-com-alteracoes',
    ]);
  });

  it('à frente e atrás: divergente, com severidade erro', () => {
    const [pendencia] = verificarBranchPrincipal(coletaDe({ distancia: '+1 -2' }));

    assert.equal(pendencia?.codigo, 'branch-principal-divergente');
    assert.equal(pendencia?.severidade, 'erro');
    assert.equal(pendencia?.comandoSugerido, 'git pull --rebase');
  });

  it('só à frente ou em dia: nenhuma pendência da principal', () => {
    assert.deepEqual(codigos(coletaDe({ distancia: '+3 -0' })), []);
    assert.deepEqual(codigos(coletaDe({ distancia: '+0 -0' })), []);
  });

  it('fetch ok e a principal não existe no remoto', () => {
    assert.deepEqual(codigos(coletaDe({ principalExisteNoRemoto: false, distancia: '+0 -2' })), [
      'branch-principal-ausente-no-remoto',
    ]);
  });
});
