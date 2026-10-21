import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  montarEmailDeCobrancaDaAgenda,
  type DadosDoEmailDeCobrancaDaAgenda,
} from './emailDeCobrancaDaAgenda.ts';

const DADOS: DadosDoEmailDeCobrancaDaAgenda = {
  titulo: 'Agenda sem tarefa na Experience',
  mensagem: 'Indústria Alfa (hoje, 09:00–12:00): nenhuma tarefa nem OS no dia.',
  geradoEm: '21/10/2026 08:30',
  observacao: '',
  copia: ['ana@alfa.com'],
  caminhoDaLogo: '/public/img/icone-192.png',
};

describe('montarEmailDeCobrancaDaAgenda', () => {
  it('põe o título no assunto e leva os contatos em cópia', () => {
    const email = montarEmailDeCobrancaDaAgenda(DADOS);

    assert.equal(email.assunto, '[HUB SNK] Atenção - Agenda sem tarefa na Experience');
    assert.deepEqual(email.copia, ['ana@alfa.com']);
  });

  it('mostra a mensagem do alerta e quando ele foi gerado', () => {
    const email = montarEmailDeCobrancaDaAgenda(DADOS);

    for (const corpo of [email.html ?? '', email.texto]) {
      assert.ok(corpo.includes('Indústria Alfa (hoje, 09:00–12:00)'));
      assert.ok(corpo.includes('Alerta gerado em 21/10/2026 08:30'));
    }
  });

  it('inclui a observação só quando preenchida, escapada e com as quebras', () => {
    const sem = montarEmailDeCobrancaDaAgenda(DADOS);
    const com = montarEmailDeCobrancaDaAgenda({ ...DADOS, observacao: '<b>Urgente</b>\nhoje' });

    assert.equal(sem.texto.includes('Urgente'), false);
    assert.ok(com.html?.includes('&lt;b&gt;Urgente&lt;/b&gt;<br>hoje'));
    assert.ok(com.texto.includes('<b>Urgente</b>\nhoje'));
  });
});
