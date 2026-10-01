import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { AgendaRecursos, chaveNome, nomesCorrespondem } from './agenda.ts';
import type { AgendaImportada } from './agendaParser.ts';
import type { EventoAgenda, RecursoAgenda } from '../tipos.ts';

const MEU_CODUSU = 4817;

function recurso(codusu: number, nomeusu = `USUARIO.${codusu}`): RecursoAgenda {
  return {
    codusu,
    nomeusu,
    codcargo: 1,
    descrcargo: 'CARGO',
    corHex: '#0000FF',
    corConflitoHex: '#FF0000',
    problemaConexao: 'N',
  };
}

function evento(parcial: Partial<EventoAgenda> & { inicio: string; fim: string }): EventoAgenda {
  return {
    nuevento: null,
    codusu: MEU_CODUSU,
    nomeusu: `USUARIO.${MEU_CODUSU}`,
    nomeparc: 'PARCEIRO',
    codparc: 100,
    allday: 'N',
    descrabrev: 'evento',
    descrlonga: '',
    tipo: 'ESTATICO',
    confirmado: 'S',
    sincronizar: 'S',
    usulancador: 'FULANO',
    dhlcto: '',
    numetapa: null,
    nufap: null,
    nueventopai: null,
    financiallate: 'N',
    diastraso: null,
    ...parcial,
  };
}

function payload(codusu: number, eventos: EventoAgenda[], nomeusu?: string): AgendaImportada {
  return {
    recursos: [{ recurso: recurso(codusu, nomeusu), eventos }],
    totalEventos: eventos.length,
  };
}

/** Período de um mês inteiro, no formato TEXT das colunas. */
function mes(anoMes: string) {
  const [ano, m] = anoMes.split('-');
  const ultimoDia = new Date(Number(ano), Number(m), 0).getDate();
  return {
    de: `${anoMes}-01 00:00:00`,
    ate: `${anoMes}-${String(ultimoDia).padStart(2, '0')} 23:59:59`,
  };
}

describe('nomesCorrespondem', () => {
  it('casa o nome curto do cadastro com o nome completo do parceiro', () => {
    const cadastro = chaveNome('Konica');
    const parceiro = chaveNome('KONICA MINOLTA BUSINESS SOLUTIONS DO BRASIL LTDA');

    assert.equal(nomesCorrespondem(cadastro, parceiro), true);
    assert.equal(nomesCorrespondem(parceiro, cadastro), true);
  });

  it('não casa nomes que não começam um com o outro', () => {
    assert.equal(nomesCorrespondem(chaveNome('Konica'), chaveNome('Minolta Konica')), false);
  });

  it('chave vazia não casa com nada', () => {
    assert.equal(nomesCorrespondem('', chaveNome('Konica')), false);
    assert.equal(nomesCorrespondem(chaveNome('Konica'), ''), false);
    assert.equal(nomesCorrespondem('', ''), false);
  });
});

describe('AgendaRecursos.importar (incremental por período e CODUSU)', () => {
  let dir: string;
  let agenda: AgendaRecursos;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hub-agenda-'));
    agenda = new AgendaRecursos(dir);
  });

  afterEach(() => {
    agenda.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('acumula mês a mês sem perder o mês anterior', () => {
    agenda.importar(
      payload(MEU_CODUSU, [
        evento({ nuevento: 1, inicio: '2026-09-10 08:00:00', fim: '2026-09-10 12:00:00' }),
      ]),
      {
        periodo: mes('2026-09'),
        codusuAlvo: MEU_CODUSU,
      },
    );
    agenda.importar(
      payload(MEU_CODUSU, [
        evento({ nuevento: 2, inicio: '2026-10-05 08:00:00', fim: '2026-10-05 12:00:00' }),
      ]),
      {
        periodo: mes('2026-10'),
        codusuAlvo: MEU_CODUSU,
      },
    );

    const setembro = agenda.eventos('2026-09-01 00:00:00', '2026-09-30 23:59:59');
    const outubro = agenda.eventos('2026-10-01 00:00:00', '2026-10-31 23:59:59');
    assert.equal(setembro.length, 1, 'o evento de setembro deve sobreviver à consulta de outubro');
    assert.equal(outubro.length, 1);
    assert.equal(agenda.estado().eventos, 2);
    assert.equal(agenda.estado().recursos, 1, 'o mesmo CODUSU não deve criar recursos duplicados');
  });

  it('reconsultar o mesmo mês substitui, sem duplicar', () => {
    const periodo = { periodo: mes('2026-09'), codusuAlvo: MEU_CODUSU };
    agenda.importar(
      payload(MEU_CODUSU, [
        evento({ nuevento: 1, inicio: '2026-09-10 08:00:00', fim: '2026-09-10 12:00:00' }),
      ]),
      periodo,
    );
    agenda.importar(
      payload(MEU_CODUSU, [
        evento({ nuevento: 1, inicio: '2026-09-10 08:00:00', fim: '2026-09-10 12:00:00' }),
      ]),
      periodo,
    );

    assert.equal(agenda.estado().eventos, 1);
  });

  it('mês esvaziado no Sankhya remove os eventos daquele mês', () => {
    const periodo = { periodo: mes('2026-09'), codusuAlvo: MEU_CODUSU };
    agenda.importar(
      payload(MEU_CODUSU, [
        evento({ nuevento: 1, inicio: '2026-09-10 08:00:00', fim: '2026-09-10 12:00:00' }),
      ]),
      periodo,
    );
    agenda.importar(payload(MEU_CODUSU, []), periodo);

    assert.equal(agenda.eventos('2026-09-01 00:00:00', '2026-09-30 23:59:59').length, 0);
  });

  it('evento que cruza dois meses não duplica ao consultar cada mês', () => {
    const cruzado = evento({
      nuevento: 9,
      inicio: '2026-09-28 08:00:00',
      fim: '2026-10-02 18:00:00',
    });
    agenda.importar(payload(MEU_CODUSU, [cruzado]), {
      periodo: mes('2026-09'),
      codusuAlvo: MEU_CODUSU,
    });
    agenda.importar(payload(MEU_CODUSU, [cruzado]), {
      periodo: mes('2026-10'),
      codusuAlvo: MEU_CODUSU,
    });

    assert.equal(agenda.estado().eventos, 1, 'o mesmo evento não pode existir em duas cópias');
  });

  it('ignora recurso de outro usuário quando codusuAlvo é o próprio', () => {
    const dados: AgendaImportada = {
      recursos: [
        {
          recurso: recurso(MEU_CODUSU),
          eventos: [
            evento({ nuevento: 1, inicio: '2026-09-10 08:00:00', fim: '2026-09-10 12:00:00' }),
          ],
        },
        {
          recurso: recurso(999, 'OUTRO'),
          eventos: [
            evento({
              nuevento: 2,
              codusu: 999,
              inicio: '2026-09-11 08:00:00',
              fim: '2026-09-11 12:00:00',
            }),
          ],
        },
      ],
      totalEventos: 2,
    };
    agenda.importar(dados, { periodo: mes('2026-09'), codusuAlvo: MEU_CODUSU });

    assert.equal(agenda.estado().eventos, 1);
    assert.equal(agenda.estado().recursos, 1);
  });

  it('casa os codparcs do cliente pelos nomes (o do cadastro e os Nomes Completos)', () => {
    agenda.importar(
      payload(MEU_CODUSU, [
        evento({
          nuevento: 1,
          codparc: 73490,
          nomeparc: 'COMELLI TRANSPORTES',
          inicio: '2026-09-10 08:00:00',
          fim: '2026-09-10 12:00:00',
        }),
        evento({
          nuevento: 2,
          codparc: 200,
          nomeparc: 'OUTRA EMPRESA LTDA',
          inicio: '2026-09-11 08:00:00',
          fim: '2026-09-11 12:00:00',
        }),
      ]),
      { periodo: mes('2026-09'), codusuAlvo: MEU_CODUSU },
    );

    assert.deepEqual(agenda.codparcsPorNomes(['Comelli', 'COMELLI TRANSPORTES LTDA']), [73490]);
    assert.deepEqual(agenda.codparcsPorNomes(['Empresa Inexistente']), []);
    assert.deepEqual(agenda.codparcsPorNomes([]), []);
  });

  it('recorta os eventos pelos parceiros do cliente', () => {
    agenda.importar(
      payload(MEU_CODUSU, [
        evento({
          nuevento: 1,
          codparc: 100,
          inicio: '2026-09-10 08:00:00',
          fim: '2026-09-10 12:00:00',
        }),
        evento({
          nuevento: 2,
          codparc: 200,
          inicio: '2026-09-11 08:00:00',
          fim: '2026-09-11 12:00:00',
        }),
      ]),
      { periodo: mes('2026-09'), codusuAlvo: MEU_CODUSU },
    );

    const so100 = agenda.eventos('2026-09-01 00:00:00', '2026-09-30 23:59:59', [100]);
    assert.equal(so100.length, 1);
    assert.equal(so100[0]?.codparc, 100);
  });
});
