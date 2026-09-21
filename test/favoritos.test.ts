/**
 * As heuristicas que transformam favorito do navegador em cliente.
 *
 * Os casos vem de favoritos reais: sao titulos escritos a mao, ao longo de anos, sem
 * padrao nenhum. E a parte da importacao que erra — o resto so grava o que sair daqui.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  agruparFavoritos,
  ambienteDoFavorito,
  chaveDoParceiro,
  nomeDoFavorito,
} from '../web/src/lib/favoritos.ts';

describe('nomeDoFavorito', () => {
  test('tira o prefixo do produto', () => {
    assert.equal(nomeDoFavorito('Sankhya Om - Mustang quimica'), 'Mustang quimica');
    assert.equal(nomeDoFavorito('Sankhya Om - Enrico Boaretto'), 'Enrico Boaretto');
  });

  test('tira o sufixo de ambiente', () => {
    assert.equal(nomeDoFavorito('Global Parts - Produção'), 'Global Parts');
    assert.equal(nomeDoFavorito('Global Parts - Teste'), 'Global Parts');
    assert.equal(nomeDoFavorito('Fenix Metais - Homologação'), 'Fenix Metais');
  });

  test('prefixo e sufixo juntos', () => {
    assert.equal(nomeDoFavorito('Sankhya Om - Mustang Teste'), 'Mustang');
  });

  test('titulo sem borda alguma passa inteiro', () => {
    assert.equal(nomeDoFavorito('Larifo'), 'Larifo');
  });

  test('nunca devolve vazio', () => {
    // Um titulo que e SO a borda sobreviveria como string vazia e viraria um cliente
    // sem nome; devolver o original deixa o usuario corrigir na tela.
    assert.equal(nomeDoFavorito('Sankhya Om'), 'Sankhya Om');
    assert.equal(nomeDoFavorito('   '), '');
  });
});

describe('ambienteDoFavorito', () => {
  test('producao e o padrao', () => {
    assert.equal(ambienteDoFavorito('Mustang quimica', 'https://mustangpluron.sankhyacloud.com.br/mge/'), 'producao');
  });

  test('reconhece teste pelo titulo e pela URL', () => {
    assert.equal(ambienteDoFavorito('Mustang Teste', 'https://x.com.br/mge/'), 'teste');
    assert.equal(ambienteDoFavorito('Mustang', 'https://mustangpluron-teste.sankhyacloud.com.br/'), 'teste');
  });

  test('homologacao vence teste quando os dois aparecem', () => {
    // A ordem importa: uma URL de homologacao costuma ter "test" no caminho, e cair em
    // teste marcaria a base errada.
    assert.equal(ambienteDoFavorito('Cliente HML', 'https://cliente-teste.com.br/'), 'homologacao');
  });
});

describe('chaveDoParceiro', () => {
  test('mesmo parceiro em ambientes diferentes tem a mesma chave', () => {
    assert.equal(
      chaveDoParceiro('https://mustangpluron.sankhyacloud.com.br/mge/'),
      chaveDoParceiro('https://mustangpluron-teste.sankhyacloud.com.br/mge/login.jsp'),
    );
  });

  test('porta diferente no mesmo host continua sendo o mesmo parceiro', () => {
    // Caso real: o mesmo servidor publica producao e teste em portas distintas.
    assert.equal(
      chaveDoParceiro('http://globalparts.snk.ativy.com:40282/mge/system.jsp'),
      chaveDoParceiro('http://globalparts.snk.ativy.com:50282/mge/system.jsp'),
    );
  });

  test('URL invalida nao vira chave', () => {
    assert.equal(chaveDoParceiro('nao é uma url'), null);
  });

  test('loopback nao e parceiro', () => {
    // Caso real: uma ferramenta local salva na mesma pasta dos clientes.
    assert.equal(chaveDoParceiro('http://127.0.0.1:8020/?id=2-e8a4d575987eefa1'), null);
    assert.equal(chaveDoParceiro('http://localhost:4000/'), null);
  });
});

describe('agruparFavoritos', () => {
  const favoritos = [
    { titulo: 'Sankhya Om - Mustang quimica', url: 'https://mustangpluron.sankhyacloud.com.br/mge/', pasta: 'Sankhya Clientes' },
    { titulo: 'Sankhya Om - Mustang Teste', url: 'https://mustangpluron-teste.sankhyacloud.com.br/mge/login.jsp', pasta: 'Sankhya Clientes' },
    { titulo: 'Global Parts - Teste', url: 'http://globalparts.snk.ativy.com:50282/mge/system.jsp', pasta: 'Sankhya Clientes' },
    { titulo: 'Global Parts - Produção', url: 'http://globalparts.snk.ativy.com:40282/mge/system.jsp', pasta: 'Sankhya Clientes' },
  ];

  test('dois favoritos do mesmo parceiro viram um cliente com duas bases', () => {
    const candidatos = agruparFavoritos(favoritos);

    assert.equal(candidatos.length, 2);
    const mustang = candidatos.find((c) => c.nome === 'Mustang quimica');
    assert.equal(mustang?.bases.length, 2);
    assert.deepEqual(
      mustang?.bases.map((b) => b.ambiente).sort(),
      ['producao', 'teste'],
    );
  });

  test('o nome vem do favorito de producao, mesmo listado depois', () => {
    // "Global Parts - Teste" aparece antes na lista; sem a preferencia por producao o
    // cliente herdaria o titulo do ambiente de teste.
    const globalParts = agruparFavoritos(favoritos).find((c) => c.chave === 'globalparts');
    assert.equal(globalParts?.nome, 'Global Parts');
  });

  test('a mesma URL duas vezes nao vira duas bases', () => {
    const repetido = [favoritos[0]!, { ...favoritos[0]!, titulo: 'Outro apelido' }];
    assert.equal(agruparFavoritos(repetido)[0]?.bases.length, 1);
  });

  test('favorito com URL invalida e descartado, sem derrubar o resto', () => {
    const comLixo = [...favoritos, { titulo: 'quebrado', url: 'javascript:alert(1)', pasta: '' }];
    assert.equal(agruparFavoritos(comLixo).length, 2);
  });
});
