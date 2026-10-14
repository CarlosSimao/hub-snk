/**
 * Monta a pasta de dados fictícia que o HUB SNK abre durante a captura (`HUB_DADOS_DIR`),
 * e os repositórios Git de mentira que dão cor às bolinhas do diagnóstico.
 *
 * Tudo é apagado e recriado a cada rodada: os prints precisam sair sempre do mesmo estado,
 * e nada aqui é cadastro de verdade. Nenhum nome, URL ou e-mail existe — os domínios usam
 * o `.example`, reservado justamente para isso.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const AGORA = '2026-10-14T12:00:00.000Z';

/**
 * UUID v4 sempre o mesmo para o mesmo apelido: o HUB SNK recusa identificador fora do
 * formato, e ids estáveis fazem cada rodada sair igual à anterior.
 */
function id(apelido) {
  const h = createHash('md5').update(apelido).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Repositório pronto num estado do diagnóstico: cada estado vira uma cor na tela. */
function criarRepositorio(pasta, url, estado) {
  mkdirSync(pasta, { recursive: true });
  const git = (...argumentos) => execFileSync('git', argumentos, { cwd: pasta, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Equipe Demo');
  git('config', 'user.email', 'equipe@demo.example');
  writeFileSync(join(pasta, 'README.md'), '# Personalizações\n');
  writeFileSync(join(pasta, '.gitignore'), '.sankhya-mcp.env\n');
  git('add', '.');
  git('commit', '-q', '-m', 'feat: estrutura inicial');
  if (estado === 'sem-remoto') return;

  // O diagnóstico não usa a rede: compara com a última posição conhecida do remoto.
  // Basta gravá-la à mão, sem servidor nenhum por trás da URL.
  git('remote', 'add', 'origin', url);
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('branch', '--set-upstream-to=origin/main', 'main');

  if (estado === 'alterado') {
    writeFileSync(join(pasta, 'README.md'), '# Personalizações\n\nAjuste no evento de pesagem.\n');
  }
  if (estado === 'commits-nao-enviados') {
    writeFileSync(join(pasta, 'regras.sql'), 'SELECT 1 FROM DUAL;\n');
    git('add', '.');
    git('commit', '-q', '-m', 'feat: regra de desconto por volume');
  }
}

function base(id, sufixo, tipo, usuario, comBanco) {
  return {
    id,
    url: `http://${sufixo}.example:8180/mge`,
    tipo,
    usuario,
    senha: 'senha-ficticia',
    ...(comBanco && {
      bancoDeDados: {
        sgbd: 'oracle',
        identificadorOracle: 'service-name',
        host: '10.0.0.15',
        porta: 1521,
        nomeDoServico: 'ORCL',
        usuario: 'SANKHYA',
        senha: 'senha-ficticia',
      },
    }),
  };
}

function cliente(id, nome, extras = {}) {
  return {
    id,
    nome,
    anotacoes: '',
    bases: [],
    repositorios: [],
    links: [],
    projetos: [],
    nomesCompletos: [],
    criadoEm: AGORA,
    atualizadoEm: AGORA,
    ...extras,
  };
}

function montarClientes(pastaDosRepositorios) {
  const repositorio = (id, nome, estado) => {
    const caminhoLocal = join(pastaDosRepositorios, nome);
    const url = `https://github.com/consultoria-demo/${nome}.git`;
    criarRepositorio(caminhoLocal, url, estado);
    return { id, url, caminhoLocal };
  };

  return [
    cliente(id('c-boavista'), 'Fazenda Boa Vista', {
      anotacoes:
        'Contato principal: Marina Duarte (TI).\nJanela de atualização só depois das 18h.\nPesagem em grupo homologada em setembro.',
      nomesCompletos: ['FAZENDA BOA VISTA AGROPECUARIA LTDA', 'BOA VISTA SEMENTES LTDA'],
      bases: [
        base(id('b-boavista-prod'), 'boavista-prod', 'producao', 'SUP', true),
        base(id('b-boavista-teste'), 'boavista-teste', 'teste', 'SUP', true),
      ],
      repositorios: [repositorio(id('r-boavista'), 'boavista-pesagem', 'limpo')],
      links: [
        {
          id: id('l-boavista-portal'),
          nome: 'Portal de chamados',
          url: 'https://portal.boavista.example',
        },
        {
          id: id('l-boavista-drive'),
          nome: 'Pasta do projeto',
          url: 'https://arquivos.boavista.example/projeto',
        },
      ],
      projetos: [
        {
          id: id('p-boavista-pesagem'),
          nome: 'Pesagem de rebanho',
          anotacoes: 'Integração com a balança Coimma.',
          links: [],
          criadoEm: AGORA,
          atualizadoEm: AGORA,
        },
      ],
    }),
    cliente(id('c-alfa'), 'Indústria Alfa', {
      nomesCompletos: ['INDUSTRIA ALFA DE EMBALAGENS S.A.'],
      bases: [
        base(id('b-alfa-prod'), 'alfa-prod', 'producao', 'ADMIN', true),
        base(id('b-alfa-teste'), 'alfa-teste', 'teste', 'ADMIN', false),
      ],
      repositorios: [repositorio(id('r-alfa'), 'alfa-embalagens', 'alterado')],
    }),
    cliente(id('c-rotasul'), 'Transportadora Rota Sul', {
      bases: [base(id('b-rotasul-prod'), 'rotasul-prod', 'producao', 'SUP', false)],
      repositorios: [repositorio(id('r-rotasul'), 'rotasul-fretes', 'sem-remoto')],
    }),
    cliente(id('c-serraazul'), 'Laticínios Serra Azul', {
      bases: [base(id('b-serraazul-prod'), 'serraazul-prod', 'producao', 'SUP', true)],
    }),
    cliente(id('c-horizonte'), 'Construtora Horizonte', {
      bases: [
        base(id('b-horizonte-prod'), 'horizonte-prod', 'producao', 'SUP', true),
        base(id('b-horizonte-teste'), 'horizonte-teste', 'teste', 'SUP', true),
      ],
      repositorios: [repositorio(id('r-horizonte'), 'horizonte-obras', 'limpo')],
    }),
    cliente(id('c-valedocafe'), 'Cooperativa Vale do Café', {
      bases: [base(id('b-valedocafe-prod'), 'valedocafe-prod', 'producao', 'SUP', true)],
      repositorios: [repositorio(id('r-valedocafe'), 'valedocafe-cotas', 'commits-nao-enviados')],
    }),
    cliente(id('c-norteverde'), 'Distribuidora Norte Verde', {
      bases: [base(id('b-norteverde-prod'), 'norteverde-prod', 'producao', 'SUP', false)],
    }),
    cliente(id('c-ferraco'), 'Metalúrgica Ferraço', {
      bases: [base(id('b-ferraco-prod'), 'ferraco-prod', 'producao', 'SUP', true)],
      repositorios: [repositorio(id('r-ferraco'), 'ferraco-producao', 'limpo')],
    }),
  ];
}

const contatos = [
  [
    'ct-marina',
    'Marina Duarte',
    'Coordenadora de TI',
    '(34) 99812-4410',
    'marina.duarte@boavista.example',
    'c-boavista',
  ],
  [
    'ct-paulo',
    'Paulo Henrique Lima',
    'Gerente administrativo',
    '(34) 99701-2235',
    'paulo.lima@boavista.example',
    'c-boavista',
  ],
  [
    'ct-renata',
    'Renata Campos',
    'Analista fiscal',
    '(11) 98455-1020',
    'renata.campos@alfa.example',
    'c-alfa',
  ],
].map(([apelido, nome, cargo, telefone, email, apelidoDoCliente]) => ({
  id: id(apelido),
  nome,
  cargo,
  telefone,
  email,
  clienteId: id(apelidoDoCliente),
  criadoEm: AGORA,
  atualizadoEm: AGORA,
}));

const configuracao = {
  scriptPadrao: 'git fetch --all',
  intervaloDeExecucaoAutomaticaSegundos: 30,
  tempoLimiteSegundos: 5,
  caminhoDoSchemaMcp: '',
  atalhos: [],
  destinoDosLinks: 'hub',
  caminhoDoExecutavelDaIde: '',
  experiencePersonId: '',
  sankhyaOmCodUsu: '',
  perfil: 'desenvolvedor',
  funcionalidadesOcultas: [],
  terceiro: false,
  boasVindasConcluidas: true,
  nomeDoUsuario: 'Ana Souza',
  empresaDoUsuario: 'Consultoria Demo',
  timeDoUsuario: 'Implantação',
};

function gravar(pasta, arquivo, chave, conteudo) {
  writeFileSync(
    join(pasta, arquivo),
    JSON.stringify({ versaoDoEsquema: 1, [chave]: conteudo }, null, 2),
  );
}

/**
 * Recria a pasta de dados e os repositórios do zero e devolve o caminho dos dados.
 *
 * Os repositórios ficam fora da pasta temporária, numa pasta de nome neutro: o caminho
 * aparece na tela (aba Git), e o da pasta temporária traz o nome do usuário da máquina.
 * Cada instância da captura tem a sua, porque elas rodam ao mesmo tempo e esta pasta é
 * apagada a cada rodada.
 */
export function prepararDados(raiz, pastaDosRepositorios) {
  rmSync(raiz, { recursive: true, force: true });
  rmSync(pastaDosRepositorios, { recursive: true, force: true });
  const pastaDeDados = join(raiz, 'dados');
  mkdirSync(pastaDeDados, { recursive: true });

  gravar(pastaDeDados, 'clientes.json', 'clientes', montarClientes(pastaDosRepositorios));
  gravar(pastaDeDados, 'contatos.json', 'contatos', contatos);
  gravar(pastaDeDados, 'configuracao.json', 'configuracao', configuracao);
  return pastaDeDados;
}
