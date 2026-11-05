import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Cliente, PendenciaGit, SituacaoGit } from '../tipos.ts';
import type { DadosDeNotificacao } from './centralDeNotificacoes.ts';
import { VerificadorDeSincroniaGit } from './verificadorDeSincroniaGit.ts';

const cliente = {
  id: 'c1',
  nome: 'Alfa',
  bases: [],
  repositorios: [
    {
      id: 'r1',
      url: 'https://exemplo.com/alfa.git',
      caminhoLocal: 'C:/alfa',
      branchPrincipal: 'main',
    },
    { id: 'r2', url: 'https://exemplo.com/sem.git', caminhoLocal: 'C:/sem' },
  ],
} as unknown as Cliente;

function situacaoCom(pendencias: PendenciaGit[]): SituacaoGit {
  return {
    severidade: 'atencao',
    branchAtual: 'main',
    provedor: null,
    pendencias,
    verificadoEm: '',
  };
}

function montar(avisoLigado: boolean, pendencias: PendenciaGit[]) {
  const emitidas: DadosDeNotificacao[] = [];
  const consultados: string[] = [];
  const verificador = new VerificadorDeSincroniaGit({
    clientes: { listar: async () => [cliente] },
    configuracao: {
      ler: async () => ({ avisoDaBranchPrincipal: avisoLigado, tempoLimiteSegundos: 5 }) as never,
    },
    consultarRemotos: async (repositorios) => {
      consultados.push(...repositorios.map((repositorio) => repositorio.caminhoLocal));
    },
    coletarSituacoes: async () => ({ r1: situacaoCom(pendencias) }),
    emitir: async (dados) => emitidas.push(dados),
    registrador: { info: () => {}, warn: () => {} },
  });
  return { verificador, emitidas, consultados };
}

const ATRAS: PendenciaGit = {
  codigo: 'branch-principal-atras',
  severidade: 'atencao',
  mensagem: 'A main está 2 commits atrás do remoto.',
};

describe('VerificadorDeSincroniaGit', () => {
  it('avisa branch principal atrás, só dos repositórios com branch cadastrada', async () => {
    const { verificador, emitidas, consultados } = montar(true, [ATRAS]);

    await verificador.conferir();

    assert.deepEqual(consultados, ['C:/alfa']);
    assert.equal(emitidas.length, 1);
    assert.equal(emitidas[0]?.origem, 'sistema');
    assert.equal(emitidas[0]?.enviarEmail, false);
    assert.equal(emitidas[0]?.chave, `git:r1:branch-principal-atras:${ATRAS.mensagem}`);
    assert.match(emitidas[0]?.mensagem ?? '', /Alfa/);
  });

  it('não avisa pendências que não são de atraso nem de divergência', async () => {
    const { verificador, emitidas } = montar(true, [
      { codigo: 'remoto-nao-consultado', severidade: 'desconhecido', mensagem: 'x' },
    ]);

    await verificador.conferir();

    assert.deepEqual(emitidas, []);
  });

  it('desligado, não faz fetch nem avisa', async () => {
    const { verificador, emitidas, consultados } = montar(false, [ATRAS]);

    await verificador.conferir();

    assert.deepEqual(consultados, []);
    assert.deepEqual(emitidas, []);
  });
});
