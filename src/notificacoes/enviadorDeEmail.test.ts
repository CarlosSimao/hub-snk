import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { textoComRodape } from './enviadorDeEmail.ts';

describe('textoComRodape', () => {
  it('acrescenta ao texto o aviso de e-mail automático com o link da página do HUB SNK', () => {
    assert.equal(
      textoComRodape('Agenda do dia sem OS lançada.'),
      'Agenda do dia sem OS lançada.\n\n--\n' +
        'Este é um e-mail automático enviado pela ferramenta HUB SNK: ' +
        'https://carlossimao.github.io/hub-snk/',
    );
  });
});
