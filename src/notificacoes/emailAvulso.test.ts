import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { corpoParaHtml, corpoParaTexto, montarEmailAvulso, type NoDoCorpo } from './emailAvulso.ts';

const CORPO: NoDoCorpo[] = [
  { marca: 'div', filhos: ['Olá, ', { marca: 'strong', filhos: ['Ana'] }] },
  { marca: 'div', filhos: [{ marca: 'br', filhos: [] }] },
  {
    marca: 'ul',
    filhos: [
      { marca: 'li', filhos: ['Item um'] },
      { marca: 'li', filhos: ['Item dois'] },
    ],
  },
  {
    marca: 'div',
    filhos: [{ marca: 'a', href: 'https://sankhya.com.br', filhos: ['portal'] }],
  },
];

describe('corpo do e-mail avulso', () => {
  it('gera o HTML só com as marcações da árvore', () => {
    const html = corpoParaHtml(CORPO);

    assert.ok(html.includes('<div>Olá, <strong>Ana</strong></div>'));
    assert.ok(html.includes('<ul><li>Item um</li><li>Item dois</li></ul>'));
    assert.ok(html.includes('<a href="https://sankhya.com.br">portal</a>'));
  });

  it('escapa o texto e descarta link que não é web nem e-mail', () => {
    const html = corpoParaHtml([
      '<script>x</script>',
      { marca: 'a', href: 'javascript:alert(1)', filhos: ['clique'] },
    ]);

    assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt;'));
    assert.ok(!html.includes('javascript:'));
    assert.ok(html.includes('clique'));
  });

  it('gera o texto puro com marcadores de lista e o endereço do link', () => {
    assert.equal(
      corpoParaTexto(CORPO),
      'Olá, Ana\n\n• Item um\n• Item dois\nportal (https://sankhya.com.br)',
    );
  });

  it('numera a lista ordenada', () => {
    const texto = corpoParaTexto([
      {
        marca: 'ol',
        filhos: [
          { marca: 'li', filhos: ['a'] },
          { marca: 'li', filhos: ['b'] },
        ],
      },
    ]);

    assert.equal(texto, '1. a\n2. b');
  });

  it('sai sem o rodapé das notificações e com os destinatários informados', () => {
    const email = montarEmailAvulso({
      para: ['ana@alfa.com'],
      copia: ['bruno@alfa.com'],
      copiaOculta: [],
      assunto: 'Reunião',
      corpo: CORPO,
      anexos: [],
    });

    assert.equal(email.semRodape, true);
    assert.deepEqual(email.para, ['ana@alfa.com']);
    assert.deepEqual(email.copia, ['bruno@alfa.com']);
  });
});
