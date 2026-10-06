import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { htmlComRemetente, textoComRodape } from './enviadorDeEmail.ts';

describe('textoComRodape', () => {
  it('acrescenta ao texto o aviso de e-mail automático com o link da página do HUB SNK', () => {
    assert.equal(
      textoComRodape('Agenda do dia sem OS lançada.'),
      'Agenda do dia sem OS lançada.\n\n--\n' +
        'Este é um e-mail automático enviado pela ferramenta HUB SNK: ' +
        'https://carlossimao.github.io/hub-snk/',
    );
  });

  it('diz quem enviou (nome, empresa e time) quando há identificação', () => {
    const remetente = { nome: 'Ana Souza', empresa: 'Acme', time: 'Suporte' };
    assert.match(textoComRodape('x', remetente), /\nEnviado por: Ana Souza · Acme · Suporte$/);
    assert.match(
      textoComRodape('x', { nome: 'Ana', empresa: '', time: ' ' }),
      /\nEnviado por: Ana$/,
    );
  });

  it('põe a identificação no HTML, escapada, antes de fechar o corpo', () => {
    const html = htmlComRemetente('<body><p>oi</p></body>', {
      nome: 'A<b>',
      empresa: 'Acme',
      time: 'Suporte',
    });
    assert.match(html, /Enviado por: A&lt;b&gt; · Acme · Suporte<\/p>\n<\/body>$/);
  });
});
