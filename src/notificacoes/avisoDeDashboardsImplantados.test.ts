import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Cliente } from '../tipos.ts';
import type { DadosDeNotificacao } from './centralDeNotificacoes.ts';
import { AvisoDeDashboardsImplantados } from './avisoDeDashboardsImplantados.ts';

const QUATRO_HORAS_MS = 4 * 60 * 60_000;

function cliente(nome: string, bases: Partial<Cliente['bases'][number]>[]): Cliente {
  return {
    nome,
    bases: bases.map((base, indice) => ({
      id: `${nome}-${indice}`,
      url: `https://${nome}.exemplo/mge`,
      tipo: 'teste',
      usuario: '',
      senha: '',
      ...base,
    })),
  } as Cliente;
}

function montar(clientes: Cliente[], agora: Date) {
  const emitidas: DadosDeNotificacao[] = [];
  const aviso = new AvisoDeDashboardsImplantados({
    clientes: { listar: async () => clientes },
    emitir: async (dados) => emitidas.push(dados),
    agora: () => agora,
    registrador: { info: () => {}, warn: () => {} },
  });
  return { aviso, emitidas };
}

describe('AvisoDeDashboardsImplantados', () => {
  it('lista só as bases com o campo true, uma por linha', async () => {
    const { aviso, emitidas } = montar(
      [
        cliente('agroflora', [
          { tipo: 'producao', dashboardImplantado: true },
          { tipo: 'teste', dashboardImplantado: false },
        ]),
        cliente('zeta', [{ tipo: 'teste' }, { tipo: 'teste', dashboardImplantado: true }]),
      ],
      new Date(QUATRO_HORAS_MS * 1000),
    );

    await aviso.conferir();

    assert.equal(emitidas.length, 1);
    assert.equal(emitidas[0]!.titulo, 'Dashboard HUB - Workbench implantado em 2 bases');
    assert.equal(
      emitidas[0]!.mensagem,
      'agroflora (Produção): https://agroflora.exemplo/mge\nzeta (Teste): https://zeta.exemplo/mge',
    );
    assert.equal(emitidas[0]!.chave, 'dashboards-implantados:1000');
    assert.equal(emitidas[0]!.enviarEmail, false);
  });

  it('sem nenhuma base marcada, não emite nada', async () => {
    const { aviso, emitidas } = montar([cliente('agroflora', [{}, {}])], new Date());
    await aviso.conferir();
    assert.equal(emitidas.length, 0);
  });

  it('a chave muda só a cada 4 horas: a central descarta as repetidas da mesma janela', async () => {
    const clientes = [cliente('agroflora', [{ dashboardImplantado: true }])];
    const inicio = QUATRO_HORAS_MS * 1000;
    const chaves = [];
    for (const deslocamento of [0, QUATRO_HORAS_MS - 1, QUATRO_HORAS_MS]) {
      const { aviso, emitidas } = montar(clientes, new Date(inicio + deslocamento));
      await aviso.conferir();
      chaves.push(emitidas[0]!.chave);
    }
    assert.deepEqual(chaves, [
      'dashboards-implantados:1000',
      'dashboards-implantados:1000',
      'dashboards-implantados:1001',
    ]);
  });
});
