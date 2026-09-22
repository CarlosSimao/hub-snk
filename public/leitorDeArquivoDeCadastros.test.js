import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lerCadastrosDoTexto } from './leitorDeArquivoDeCadastros.js';

const SEPARADOR = '-'.repeat(60);

function juntarBlocos(...blocos) {
  return blocos.join(`\n\n${SEPARADOR}\n\n`);
}

const BLOCO_COMPLETO = [
  'Cliente: Indústria Alfa',
  '',
  'Tipo de base: Produção',
  'URL: https://alfa:8180/mge',
  'Usuário: mge',
  'Senha: alfa123',
  '',
  'Banco de dados',
  'Host: 10.0.0.5',
  'Porta: 1521',
  'Serviço: ORCL',
  'Usuário: sankhya',
  'Senha: sankhya',
].join('\n');

describe('lerCadastrosDoTexto', () => {
  it('lê o bloco completo com credenciais e banco de dados', () => {
    const { clientes, avisos } = lerCadastrosDoTexto(BLOCO_COMPLETO);

    assert.deepEqual(avisos, []);
    assert.deepEqual(clientes, [
      {
        nome: 'Indústria Alfa',
        bases: [
          {
            url: 'https://alfa:8180/mge',
            tipo: 'producao',
            usuario: 'mge',
            senha: 'alfa123',
            bancoDeDados: {
              host: '10.0.0.5',
              porta: 1521,
              nomeDoServico: 'ORCL',
              usuario: 'sankhya',
              senha: 'sankhya',
            },
          },
        ],
      },
    ]);
  });

  it('lê o bloco mínimo, só com nome, tipo e URL', () => {
    const { clientes } = lerCadastrosDoTexto(
      ['Cliente: Beta Ltda', '', 'Tipo de base: Teste', 'URL: https://beta:8180/mge'].join('\n'),
    );

    assert.deepEqual(clientes, [
      {
        nome: 'Beta Ltda',
        bases: [{ url: 'https://beta:8180/mge', tipo: 'teste', usuario: '', senha: '' }],
      },
    ]);
  });

  it('lê o cliente sem nenhuma base', () => {
    const { clientes } = lerCadastrosDoTexto('Cliente: Gama SA');

    assert.deepEqual(clientes, [{ nome: 'Gama SA', bases: [] }]);
  });

  it('trata o traço de campo vazio como campo em branco', () => {
    const { clientes } = lerCadastrosDoTexto(
      [
        'Cliente: Beta Ltda',
        'Tipo de base: Outro',
        'URL: https://beta:8180/mge',
        'Usuário: —',
        'Senha: —',
      ].join('\n'),
    );

    assert.equal(clientes[0].bases[0].usuario, '');
    assert.equal(clientes[0].bases[0].senha, '');
  });

  it('reúne num cliente só os blocos que repetem o nome, tolerando caixa e acento', () => {
    const { clientes } = lerCadastrosDoTexto(
      juntarBlocos(
        ['Cliente: Indústria Alfa', 'Tipo de base: Produção', 'URL: https://alfa:8180/mge'].join(
          '\n',
        ),
        ['Cliente: industria alfa', 'Tipo de base: Teste', 'URL: https://alfa:8280/mge'].join('\n'),
      ),
    );

    assert.equal(clientes.length, 1);
    assert.equal(clientes[0].nome, 'Indústria Alfa');
    assert.deepEqual(
      clientes[0].bases.map((base) => base.tipo),
      ['producao', 'teste'],
    );
  });

  it('lê mais de uma base no mesmo bloco quando o rótulo se repete', () => {
    const { clientes } = lerCadastrosDoTexto(
      [
        'Cliente: Indústria Alfa',
        'Tipo de base: Produção',
        'URL: https://alfa:8180/mge',
        'Tipo de base: Teste',
        'URL: https://alfa:8280/mge',
      ].join('\n'),
    );

    assert.deepEqual(
      clientes[0].bases.map((base) => [base.tipo, base.url]),
      [
        ['producao', 'https://alfa:8180/mge'],
        ['teste', 'https://alfa:8280/mge'],
      ],
    );
  });

  it('não confunde usuário e senha do banco com os da base', () => {
    const { clientes } = lerCadastrosDoTexto(BLOCO_COMPLETO);
    const base = clientes[0].bases[0];

    assert.equal(base.usuario, 'mge');
    assert.equal(base.senha, 'alfa123');
    assert.equal(base.bancoDeDados.usuario, 'sankhya');
    assert.equal(base.bancoDeDados.senha, 'sankhya');
  });

  it('descarta a base sem URL e avisa', () => {
    const { clientes, avisos } = lerCadastrosDoTexto(
      ['Cliente: Beta Ltda', 'Tipo de base: Teste', 'Usuário: mge'].join('\n'),
    );

    assert.deepEqual(clientes, [{ nome: 'Beta Ltda', bases: [] }]);
    assert.match(avisos[0], /sem URL/);
  });

  it('descarta a base com URL que não é http nem https', () => {
    const { clientes, avisos } = lerCadastrosDoTexto(
      ['Cliente: Beta Ltda', 'Tipo de base: Teste', 'URL: ftp://beta/mge'].join('\n'),
    );

    assert.deepEqual(clientes[0].bases, []);
    assert.match(avisos[0], /http ou https/);
  });

  it('entra como Outro quando o tipo não é reconhecido, e avisa', () => {
    const { clientes, avisos } = lerCadastrosDoTexto(
      ['Cliente: Beta Ltda', 'Tipo de base: Homologação', 'URL: https://beta:8180/mge'].join('\n'),
    );

    assert.equal(clientes[0].bases[0].tipo, 'outro');
    assert.match(avisos[0], /entrou como "Outro"/);
  });

  it('ignora o banco incompleto mas mantém a base', () => {
    const { clientes, avisos } = lerCadastrosDoTexto(
      [
        'Cliente: Beta Ltda',
        'Tipo de base: Teste',
        'URL: https://beta:8180/mge',
        '',
        'Banco de dados',
        'Host: 10.0.0.5',
        'Porta: 1521',
        'Serviço: —',
        'Usuário: sankhya',
        'Senha: sankhya',
      ].join('\n'),
    );

    assert.equal(clientes[0].bases.length, 1);
    assert.equal(clientes[0].bases[0].bancoDeDados, undefined);
    assert.match(avisos[0], /banco de dados/);
  });

  it('ignora o banco com porta fora da faixa', () => {
    const { clientes } = lerCadastrosDoTexto(
      [
        'Cliente: Beta Ltda',
        'Tipo de base: Teste',
        'URL: https://beta:8180/mge',
        '',
        'Banco de dados',
        'Host: 10.0.0.5',
        'Porta: 0',
        'Serviço: ORCL',
        'Usuário: sankhya',
        'Senha: sankhya',
      ].join('\n'),
    );

    assert.equal(clientes[0].bases[0].bancoDeDados, undefined);
  });

  it('mantém a primeira aparição da URL repetida no mesmo cliente', () => {
    const { clientes, avisos } = lerCadastrosDoTexto(
      juntarBlocos(
        [
          'Cliente: Beta Ltda',
          'Tipo de base: Produção',
          'URL: https://beta:8180/mge',
          'Usuário: primeiro',
        ].join('\n'),
        [
          'Cliente: Beta Ltda',
          'Tipo de base: Teste',
          'URL: https://beta:8180/mge',
          'Usuário: segundo',
        ].join('\n'),
      ),
    );

    assert.equal(clientes[0].bases.length, 1);
    assert.equal(clientes[0].bases[0].usuario, 'primeiro');
    assert.match(avisos[0], /mais de uma vez/);
  });

  it('ignora o bloco sem a linha do cliente', () => {
    const { clientes, avisos } = lerCadastrosDoTexto(
      juntarBlocos(
        ['Tipo de base: Teste', 'URL: https://sem-cliente:8180/mge'].join('\n'),
        ['Cliente: Beta Ltda', 'Tipo de base: Teste', 'URL: https://beta:8180/mge'].join('\n'),
      ),
    );

    assert.deepEqual(
      clientes.map((cliente) => cliente.nome),
      ['Beta Ltda'],
    );
    assert.match(avisos[0], /sem a linha "Cliente:"/);
  });

  it('aceita separador encurtado, quebra de linha do Windows e espaço sobrando', () => {
    const { clientes } = lerCadastrosDoTexto(
      [
        '  Cliente:  Indústria Alfa  ',
        '  Tipo de base:  Produção ',
        '  URL:  https://alfa:8180/mge ',
        '---',
        'Cliente: Beta Ltda',
        'Tipo de base: Teste',
        'URL: https://beta:8180/mge',
      ].join('\r\n'),
    );

    assert.deepEqual(
      clientes.map((cliente) => cliente.nome),
      ['Indústria Alfa', 'Beta Ltda'],
    );
    assert.equal(clientes[0].bases[0].url, 'https://alfa:8180/mge');
  });

  it('recusa arquivo sem nenhum cliente', () => {
    assert.throws(() => lerCadastrosDoTexto('qualquer texto solto\nsem rótulo nenhum'), {
      message: /Nenhum cliente encontrado/,
    });
  });
});
