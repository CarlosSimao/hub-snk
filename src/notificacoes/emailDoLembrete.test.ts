import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { montarEmailDoLembrete, type DadosDoEmailDoLembrete } from './emailDoLembrete.ts';

const DADOS: DadosDoEmailDoLembrete = {
  resumo: 'Relatório de horas',
  texto: 'Enviar ao coordenador\nantes das 18h',
  vinculo: 'Alfa › Portal',
  previstoPara: '28/09/2026 17:00',
  atrasado: false,
  copia: ['ana@alfa.com'],
  caminhoDaLogo: '/public/img/icone-192.png',
};

describe('montarEmailDoLembrete', () => {
  it('põe o resumo no assunto', () => {
    assert.equal(montarEmailDoLembrete(DADOS).assunto, '[HUB SNK] Lembrete - Relatório de horas');
  });

  it('leva os contatos em cópia e a logo embutida pelo cid do HTML', () => {
    const email = montarEmailDoLembrete(DADOS);

    assert.deepEqual(email.copia, ['ana@alfa.com']);
    const logo = email.imagensEmbutidas?.[0];
    assert.equal(logo?.caminho, DADOS.caminhoDaLogo);
    assert.ok(email.html?.includes(`src="cid:${logo?.cid}"`));
  });

  it('mantém as quebras de linha do texto no HTML e no texto puro', () => {
    const email = montarEmailDoLembrete(DADOS);

    assert.ok(email.html?.includes('Enviar ao coordenador<br>antes das 18h'));
    assert.ok(email.texto.includes('Enviar ao coordenador\nantes das 18h'));
  });

  it('escapa o que o usuário digitou', () => {
    const email = montarEmailDoLembrete({ ...DADOS, resumo: '<b>Alerta</b> & cia' });

    assert.ok(email.html?.includes('&lt;b&gt;Alerta&lt;/b&gt; &amp; cia'));
    assert.ok(!email.html?.includes('<b>Alerta</b>'));
  });

  it('avisa no rodapé do HTML que é e-mail automático, com o link da página do HUB SNK', () => {
    const email = montarEmailDoLembrete(DADOS);

    assert.ok(email.html?.includes('e-mail automático enviado pela ferramenta'));
    assert.ok(email.html?.includes('href="https://carlossimao.github.io/hub-snk/"'));
  });

  it('avisa o atraso só quando disparou atrasado', () => {
    assert.ok(!montarEmailDoLembrete(DADOS).html?.includes('depois do horário previsto'));
    assert.ok(
      montarEmailDoLembrete({ ...DADOS, atrasado: true }).html?.includes(
        'depois do horário previsto',
      ),
    );
  });
});
