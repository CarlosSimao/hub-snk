import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validarNovaOcorrencia } from './ocorrencias.ts';

describe('validarNovaOcorrencia', () => {
  it('converte um período de vários dias para o formato do ERP', () => {
    assert.deepEqual(
      validarNovaOcorrencia({ inicio: '2026-10-05T08:00', fim: '2026-10-09T18:00', motivo: '0' }),
      {
        ok: true,
        ocorrencia: {
          dtInicial: '05/10/2026 08:00:00',
          dtFinal: '09/10/2026 18:00:00',
          motivo: '0',
          observacao: '',
        },
      },
    );
  });

  it('aparra a observação e recusa a que passa do limite', () => {
    const base = { inicio: '2026-10-05T08:00', fim: '2026-10-06T08:00', motivo: '15' };
    const aparada = validarNovaOcorrencia({ ...base, observacao: '  Deploy  ' });
    assert.equal(aparada.ok && aparada.ocorrencia.observacao, 'Deploy');
    assert.equal(validarNovaOcorrencia({ ...base, observacao: 'x'.repeat(501) }).ok, false);
  });

  it('recusa fim antes ou igual ao início', () => {
    const r = validarNovaOcorrencia({
      inicio: '2026-10-05T18:00',
      fim: '2026-10-05T18:00',
      motivo: '15',
    });
    assert.equal(r.ok, false);
  });

  it('recusa data fora do formato e motivo fora da lista', () => {
    assert.equal(
      validarNovaOcorrencia({ inicio: '05/10/2026', fim: '2026-10-06T08:00', motivo: '15' }).ok,
      false,
    );
    assert.equal(
      validarNovaOcorrencia({ inicio: '2026-10-05T08:00', fim: '2026-10-06T08:00', motivo: '99' })
        .ok,
      false,
    );
  });
});
