import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LIMITE_DOS_ANEXOS_BYTES,
  avisosDoEnvio,
  clientesDosDestinatarios,
  erroDoEnvio,
  normalizarLink,
} from './escritaDeEmail.js';

const COMPLETO = { assunto: 'Reunião', textoDoCorpo: 'Olá', quantidadeDeAnexos: 0, clientes: [] };

describe('erroDoEnvio', () => {
  it('exige ao menos um destinatário em Para', () => {
    assert.match(erroDoEnvio({ para: [], tamanhoDosAnexos: 0 }), /destinatário/);
    assert.equal(erroDoEnvio({ para: ['c1'], tamanhoDosAnexos: 0 }), null);
  });

  it('barra anexos acima do limite', () => {
    const erro = erroDoEnvio({ para: ['c1'], tamanhoDosAnexos: LIMITE_DOS_ANEXOS_BYTES + 1 });
    assert.match(erro, /anexos/);
  });
});

describe('avisosDoEnvio', () => {
  it('não avisa nada no e-mail completo', () => {
    assert.deepEqual(avisosDoEnvio(COMPLETO), []);
  });

  it('lembra do anexo citado no corpo ou no assunto sem arquivo', () => {
    const peloCorpo = avisosDoEnvio({ ...COMPLETO, textoDoCorpo: 'Segue em ANEXO a ata.' });
    const peloAssunto = avisosDoEnvio({ ...COMPLETO, assunto: 'Ata anexada' });
    const comArquivo = avisosDoEnvio({ ...COMPLETO, textoDoCorpo: 'anexo', quantidadeDeAnexos: 1 });

    assert.equal(peloCorpo.length, 1);
    assert.equal(peloAssunto.length, 1);
    assert.deepEqual(comArquivo, []);
  });

  it('avisa clientes diferentes, assunto e corpo vazios', () => {
    const avisos = avisosDoEnvio({
      assunto: ' ',
      textoDoCorpo: '',
      quantidadeDeAnexos: 0,
      clientes: ['Alfa', 'Beta'],
    });

    assert.equal(avisos.length, 3);
    assert.match(avisos[0], /Alfa, Beta/);
  });
});

describe('clientesDosDestinatarios', () => {
  it('conta cada cliente uma vez e ignora contato sem cliente', () => {
    const clientes = { a: { nome: 'Alfa' }, b: { nome: 'Beta' } };
    const contatos = [
      { clienteId: 'b' },
      { clienteId: 'a' },
      { clienteId: 'a' },
      { clienteId: null },
    ];

    const nomes = clientesDosDestinatarios(contatos, (contato) => clientes[contato.clienteId]);

    assert.deepEqual(nomes, ['Alfa', 'Beta']);
  });
});

describe('normalizarLink', () => {
  it('completa o https e mantém mailto', () => {
    assert.equal(normalizarLink('sankhya.com.br'), 'https://sankhya.com.br');
    assert.equal(normalizarLink('mailto:ana@alfa.com'), 'mailto:ana@alfa.com');
    assert.equal(normalizarLink('  '), '');
  });
});
