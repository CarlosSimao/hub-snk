/**
 * Escopo do cliente -> tarefas -> kanban.
 *
 * A análise por IA em si não é testada aqui (custa dinheiro e minutos, e o resultado
 * varia); o que é testado é tudo em volta dela que pode quebrar sem ninguém notar: ler o
 * `.docx`, entender a resposta do agente, e o quadro não perder nem embaralhar cartões.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import Fastify from 'fastify';
import { textoDoDocx, textoDoXmlWord, DocxInvalidoError } from '../src/sankhya/docxTexto.ts';
import { extrairResultado, resumoComDuvidas, AnaliseEscopoError } from '../src/sankhya/escopoIa.ts';
import { Escopo } from '../src/sankhya/escopo.ts';
import { Clientes } from '../src/sankhya/clientes.ts';
import { registerRoutesEscopo } from '../src/routesEscopo.ts';
import {
  CompartilhamentoTarefas,
  estadoDoTexto,
  ignorarNoGit,
  nomeDeArquivoSeguro,
  nomeSugerido,
} from '../src/sankhya/escopoCompartilhado.ts';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dirTemporario } from './helpers.ts';

/** ZIP mínimo, só o suficiente para exercitar o leitor: `stored` e `deflate`. */
function zip(arquivos: { nome: string; conteudo: string; comprimir: boolean }[]): Buffer {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let deslocamento = 0;
  for (const a of arquivos) {
    const nome = Buffer.from(a.nome, 'utf8');
    const cru = Buffer.from(a.conteudo, 'utf8');
    const dados = a.comprimir ? deflateRawSync(cru) : cru;
    const metodo = a.comprimir ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(metodo, 8);
    local.writeUInt32LE(dados.length, 18);
    local.writeUInt32LE(cru.length, 22);
    local.writeUInt16LE(nome.length, 26);
    locais.push(local, nome, dados);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(metodo, 10);
    central.writeUInt32LE(dados.length, 20);
    central.writeUInt32LE(cru.length, 24);
    central.writeUInt16LE(nome.length, 28);
    central.writeUInt32LE(deslocamento, 42);
    centrais.push(central, nome);

    deslocamento += 30 + nome.length + dados.length;
  }
  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...locais, diretorio, fim]);
}

const XML_WORD =
  '<w:document><w:body>' +
  '<w:p><w:r><w:t>Escopo &amp; objetivo</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Criar tela</w:t><w:tab/><w:t>AD_PEDIDO</w:t></w:r></w:p>' +
  '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Campo</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Tipo</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
  '</w:body></w:document>';

describe('docxTexto', () => {
  test('lê o corpo de um docx comprimido e mantém parágrafo, tabulação e entidade', () => {
    const docx = zip([
      { nome: '[Content_Types].xml', conteudo: '<Types/>', comprimir: false },
      { nome: 'word/document.xml', conteudo: XML_WORD, comprimir: true },
    ]);
    const texto = textoDoDocx(docx);
    assert.match(texto, /^Escopo & objetivo$/m);
    assert.match(texto, /^Criar tela\tAD_PEDIDO$/m);
    assert.match(texto, /Campo/);
    assert.match(texto, /Tipo/);
  });

  test('também lê entrada sem compressão', () => {
    const docx = zip([{ nome: 'word/document.xml', conteudo: XML_WORD, comprimir: false }]);
    assert.match(textoDoDocx(docx), /Escopo & objetivo/);
  });

  test('arquivo que não é zip, ou zip sem corpo do Word, é recusado com mensagem clara', () => {
    assert.throws(() => textoDoDocx(Buffer.from('isto não é um docx, é texto puro com bytes suficientes')), DocxInvalidoError);
    const semCorpo = zip([{ nome: 'outro.xml', conteudo: '<x/>', comprimir: false }]);
    assert.throws(() => textoDoDocx(semCorpo), /word\/document\.xml/);
  });

  test('célula de tabela vira separador e não sobra barra no fim da linha', () => {
    const texto = textoDoXmlWord(
      '<w:tr><w:tc><w:p><w:t>A</w:t></w:p></w:tc><w:tc><w:p><w:t>B</w:t></w:p></w:tc></w:tr>',
    );
    assert.doesNotMatch(texto, /\|\s*$/m);
  });
});

describe('extrairResultado', () => {
  test('aceita JSON cercado por texto e crases', () => {
    const r = extrairResultado(
      'Claro! Aqui está:\n```json\n{"resumo":"Tela de pedidos","duvidas":["qual TOP?"],"tarefas":[{"titulo":"Criar AD_PEDIDO","tipo":"dados","estimativaHoras":3,"prioridade":"alta","criteriosAceite":["tabela criada","campos ok"]}]}\n```\nQualquer coisa me avise.',
    );
    assert.equal(r.resumo, 'Tela de pedidos');
    assert.deepEqual(r.duvidas, ['qual TOP?']);
    assert.equal(r.tarefas.length, 1);
    assert.equal(r.tarefas[0]!.criteriosAceite, 'tabela criada\ncampos ok');
    assert.match(resumoComDuvidas(r), /Pontos a esclarecer[\s\S]*- qual TOP\?/);
  });

  test('sem JSON, ou sem tarefas, falha com erro de análise', () => {
    assert.throws(() => extrairResultado('não consegui ler o documento'), AnaliseEscopoError);
    assert.throws(() => extrairResultado('{"resumo":"x","tarefas":[]}'), /não encontrou tarefas/);
  });
});

describe('Escopo — kanban', () => {
  function novo() {
    const dir = dirTemporario();
    const escopo = new Escopo(dir.path);
    return { escopo, fechar: () => { escopo.close(); dir.remove(); } };
  }

  test('valores estranhos da IA são normalizados em vez de quebrar', () => {
    const { escopo, fechar } = novo();
    try {
      const t = escopo.criarTarefa(1, { titulo: 'X', tipo: 'BACKEND', prioridade: 'Média', estimativaHoras: 2.3333 });
      assert.equal(t.tipo, 'backend');
      assert.equal(t.prioridade, 'media');
      assert.equal(t.estimativaHoras, 2.5);
      assert.equal(escopo.criarTarefa(1, { titulo: 'Y', tipo: 'foguete' }).tipo, 'outro');
    } finally {
      fechar();
    }
  });

  test('mover troca de coluna na posição pedida e mantém as duas colunas densas', () => {
    const { escopo, fechar } = novo();
    try {
      const a = escopo.criarTarefa(1, { titulo: 'A' });
      const b = escopo.criarTarefa(1, { titulo: 'B' });
      const c = escopo.criarTarefa(1, { titulo: 'C' });
      const d = escopo.criarTarefa(1, { titulo: 'D' }, 'em_andamento');

      escopo.mover(b.id, 'em_andamento', 0);

      const coluna = (estado: string) =>
        escopo.tarefas(1).filter((t) => t.estado === estado).sort((x, y) => x.ordem - y.ordem);
      assert.deepEqual(coluna('em_andamento').map((t) => t.titulo), ['B', 'D']);
      assert.deepEqual(coluna('em_andamento').map((t) => t.ordem), [0, 1]);
      assert.deepEqual(coluna('backlog').map((t) => t.titulo), ['A', 'C']);
      assert.deepEqual(coluna('backlog').map((t) => t.ordem), [0, 1]);

      // Reordenar dentro da mesma coluna: C vai para o topo.
      escopo.mover(c.id, 'backlog', 0);
      assert.deepEqual(coluna('backlog').map((t) => t.titulo), ['C', 'A']);
      assert.ok(a && d);
    } finally {
      fechar();
    }
  });

  test('reanálise troca só o que continua no Backlog e preserva o que já andou', () => {
    const { escopo, fechar } = novo();
    try {
      const doc = escopo.adicionarDocumento(1, { nome: 'escopo.md', tipo: 'md', bruto: Buffer.from('x'), texto: 'x' });
      escopo.registrarAnalise(doc.id, 'v1', [{ titulo: 'Tarefa 1' }, { titulo: 'Tarefa 2' }]);

      const t1 = escopo.tarefas(1).find((t) => t.titulo === 'Tarefa 1')!;
      escopo.mover(t1.id, 'em_andamento', 0);
      const manual = escopo.criarTarefa(1, { titulo: 'Manual' });

      const r = escopo.registrarAnalise(doc.id, 'v2', [{ titulo: 'Tarefa nova' }]);
      assert.deepEqual(r, { criadas: 1, mantidas: 1 });

      const titulos = escopo.tarefas(1).map((t) => t.titulo).sort();
      assert.deepEqual(titulos, ['Manual', 'Tarefa 1', 'Tarefa nova']);
      assert.equal(escopo.tarefa(t1.id)!.estado, 'em_andamento');
      assert.equal(escopo.tarefa(manual.id)!.documentoId, null);
      assert.equal(escopo.documento(doc.id)!.resumo, 'v2');
    } finally {
      fechar();
    }
  });

  test('remover o documento desvincula as tarefas em vez de apagá-las', () => {
    const { escopo, fechar } = novo();
    try {
      const doc = escopo.adicionarDocumento(1, { nome: 'e.md', tipo: 'md', bruto: Buffer.from('x'), texto: 'x' });
      escopo.registrarAnalise(doc.id, 'r', [{ titulo: 'Fica' }]);
      assert.equal(escopo.removerDocumento(doc.id), true);
      const [t] = escopo.tarefas(1);
      assert.equal(t!.titulo, 'Fica');
      assert.equal(t!.documentoId, null);
    } finally {
      fechar();
    }
  });
});

describe('Escopo — várias demandas', () => {
  test('tarefa manual entra na demanda escolhida, troca de demanda e recusa demanda de outro cliente', () => {
    const dir = dirTemporario();
    const escopo = new Escopo(dir.path);
    try {
      const a = escopo.adicionarDocumento(1, { nome: 'Portal.md', tipo: 'md', bruto: Buffer.from('x'), texto: 'x' });
      const b = escopo.adicionarDocumento(1, { nome: 'Integração.md', tipo: 'md', bruto: Buffer.from('y'), texto: 'y' });
      const deOutro = escopo.adicionarDocumento(2, { nome: 'z.md', tipo: 'md', bruto: Buffer.from('z'), texto: 'z' });

      assert.equal(a.demanda, 'Portal', 'sem nome, a demanda é o arquivo sem extensão');
      assert.equal(escopo.renomearDemanda(a.id, '  Portal do cliente ')!.demanda, 'Portal do cliente');

      const t = escopo.criarTarefa(1, { titulo: 'Tela', documentoId: a.id, notas: 'começar pela grade' });
      assert.equal(t.documentoId, a.id);
      assert.equal(t.notas, 'começar pela grade');
      assert.equal(escopo.atualizarTarefa(t.id, { documentoId: b.id })!.documentoId, b.id);
      assert.equal(escopo.atualizarTarefa(t.id, { documentoId: null })!.documentoId, null);
      assert.throws(() => escopo.criarTarefa(1, { titulo: 'X', documentoId: deOutro.id }), /demanda não encontrada/);
    } finally {
      escopo.close();
      dir.remove();
    }
  });
});

describe('arquivo compartilhado com IA externa', () => {
  /** O vigia usa `watchFile`; o teste chama a sincronização do mesmo jeito que a mudança de arquivo chamaria. */
  async function esperar(condicao: () => boolean, ms = 6000): Promise<void> {
    const fim = Date.now() + ms;
    while (!condicao()) {
      if (Date.now() > fim) throw new Error('tempo esgotado esperando a sincronização');
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  test('estado e notas editados no arquivo voltam para o quadro; o resto é ignorado', async () => {
    const dir = dirTemporario();
    const escopo = new Escopo(dir.path);
    const comp = new CompartilhamentoTarefas(escopo, () => 'ACME');
    try {
      const doc = escopo.adicionarDocumento(1, { nome: 'e.md', tipo: 'md', bruto: Buffer.from('x'), texto: 'x' });
      escopo.registrarAnalise(doc.id, 'resumo', [{ titulo: 'Criar tabela' }, { titulo: 'Criar tela' }]);
      const [t1, t2] = escopo.tarefasDaDemanda(doc.id);
      const situacao = comp.ligar(doc.id, dir.path, 'portal.json')!;
      assert.equal(situacao.arquivo, join(dir.path, 'portal.json'));

      const json = JSON.parse(readFileSync(situacao.arquivo, 'utf8'));
      assert.equal(json.tarefas.length, 2);
      assert.equal(json.resumoDoEscopo, 'resumo');

      // Tarefa nova na demanda entra no arquivo na hora; avulsa não.
      const nova = escopo.criarTarefa(1, { titulo: 'Relatório', documentoId: doc.id });
      escopo.criarTarefa(1, { titulo: 'Avulsa' });
      const titulos = JSON.parse(readFileSync(situacao.arquivo, 'utf8')).tarefas.map((t: { titulo: string }) => t.titulo);
      assert.deepEqual(titulos.sort(), ['Criar tabela', 'Criar tela', 'Relatório']);
      escopo.removerTarefa(nova.id);

      // Mudança no quadro reescreve o arquivo.
      escopo.mover(t2!.id, 'a_fazer', 0);
      assert.equal(JSON.parse(readFileSync(situacao.arquivo, 'utf8')).tarefas[1].estado, 'a_fazer');

      // A IA muda o arquivo: rótulo em português vale, título não é aceito.
      const editado = JSON.parse(readFileSync(situacao.arquivo, 'utf8'));
      const item1 = editado.tarefas.find((t: { id: number }) => t.id === t1!.id);
      item1.estado = 'Em andamento';
      item1.notas = 'tabela AD_PEDIDO criada no dbscripts';
      item1.titulo = 'Título reescrito pela IA';
      editado.tarefas.find((t: { id: number }) => t.id === t2!.id).estado = 'voando';
      writeFileSync(situacao.arquivo, JSON.stringify(editado));

      await esperar(() => escopo.tarefa(t1!.id)!.estado === 'em_andamento');
      const depois = escopo.tarefa(t1!.id)!;
      assert.equal(depois.notas, 'tabela AD_PEDIDO criada no dbscripts');
      assert.equal(depois.titulo, 'Criar tabela');
      assert.equal(escopo.tarefa(t2!.id)!.estado, 'a_fazer', 'estado inválido não move');
      await esperar(() => /voando/.test(comp.situacao(doc.id)!.erro));
      assert.equal(comp.situacao(doc.id)!.mudancasImportadas, 2);

      // JSON quebrado não é sobrescrito: pode ser o outro lado no meio da edição.
      writeFileSync(situacao.arquivo, '{ "tarefas": [');
      await esperar(() => /JSON válido/.test(comp.situacao(doc.id)!.erro));
      escopo.mover(t2!.id, 'concluido', 0);
      assert.equal(readFileSync(situacao.arquivo, 'utf8'), '{ "tarefas": [');
    } finally {
      comp.fechar();
      escopo.close();
      dir.remove();
    }
  });

  test('nome de arquivo digitado não sai da pasta nem quebra no Windows', () => {
    assert.equal(nomeDeArquivoSeguro('..\\..\\x'), '-..-x.json');
    assert.equal(nomeDeArquivoSeguro('Portal/fase 1.JSON'), 'Portal-fase 1.json');
    assert.equal(nomeDeArquivoSeguro('   '), '');
    assert.equal(nomeSugerido('Integração ERP x WMS'), 'integracao-erp-x-wms.json');
  });

  test('.gitignore: acha a raiz do repositório, não duplica e ignora fora de repositório', () => {
    const dir = dirTemporario();
    try {
      const repo = join(dir.path, 'repo');
      mkdirSync(join(repo, '.git'), { recursive: true });
      mkdirSync(join(repo, 'docs', 'Tarefas'), { recursive: true });
      writeFileSync(join(repo, '.gitignore'), 'node_modules');

      const r = ignorarNoGit(join(repo, 'docs', 'Tarefas'), true);
      assert.deepEqual(r, { gitignore: join(repo, '.gitignore'), entrada: '/docs/Tarefas/', adicionada: true });
      assert.equal(readFileSync(r.gitignore, 'utf8'), 'node_modules\n\n# sankhya-hub: tarefas compartilhadas com IA\n/docs/Tarefas/\n');
      assert.equal(ignorarNoGit(join(repo, 'docs', 'Tarefas'), true).adicionada, false, 'segunda vez não repete');

      assert.equal(ignorarNoGit(join(repo, 'portal.json'), false).entrada, '/portal.json');

      const solto = join(dir.path, 'solto');
      mkdirSync(solto);
      assert.deepEqual(ignorarNoGit(join(solto, 'x.json'), false), { gitignore: '', entrada: '', adicionada: false });
    } finally {
      dir.remove();
    }
  });

  test('rótulos e apelidos de estado', () => {
    assert.equal(estadoDoTexto('Concluído'), 'concluido');
    assert.equal(estadoDoTexto('A fazer'), 'a_fazer');
    assert.equal(estadoDoTexto('em-revisão'), 'em_revisao');
    assert.equal(estadoDoTexto('done'), 'concluido');
    assert.equal(estadoDoTexto('quase'), undefined);
  });
});

describe('rotas de escopo', () => {
  test('envio, análise em segundo plano e movimento pelo HTTP', async () => {
    const dir = dirTemporario();
    const clientes = new Clientes(dir.path);
    const escopo = new Escopo(dir.path);
    const app = Fastify();
    let liberar: () => void = () => undefined;
    const analiseTerminou = new Promise<void>((r) => (liberar = r));

    const compartilhamento = new CompartilhamentoTarefas(escopo, () => 'ACME');
    registerRoutesEscopo(app, {
      escopo,
      clientes,
      compartilhamento,
      analisar: async () => {
        setImmediate(liberar);
        return { resumo: 'ok', duvidas: [], tarefas: [{ titulo: 'Fazer X', tipo: 'backend', estimativaHoras: 4 }] };
      },
    });

    try {
      const cliente = clientes.criar({
        nome: 'ACME',
        experienceProjetoId: null,
        experiencePersonId: null,
        agendaRecursoUsuario: '',
        agendaCodparc: null,
        agendaDemandaId: '',
        sankhyaUrl: '',
        repositorioLocal: '',
        repositorioRemoto: '',
        anotacoes: '',
        anotacoesNotificar: false,
        demandaFim: '',
        emailFinalizacaoEm: '',
      });
      const envio = await app.inject({
        method: 'POST',
        url: `/api/clientes/${cliente.id}/escopo/documentos`,
        payload: { nome: 'escopo.txt', conteudoBase64: Buffer.from('criar tela').toString('base64') },
      });
      assert.equal(envio.statusCode, 200);
      const docId = envio.json().documento.id as number;

      const doc = await app.inject({ method: 'POST', url: `/api/escopo/documentos/${docId}/analisar` });
      assert.equal(doc.statusCode, 202);
      await analiseTerminou;
      await new Promise((r) => setImmediate(r));

      const quadro = (await app.inject({ method: 'GET', url: `/api/clientes/${cliente.id}/escopo` })).json();
      assert.equal(quadro.documentos[0].status, 'analisado');
      assert.equal(quadro.tarefas.length, 1);

      const mover = await app.inject({
        method: 'POST',
        url: `/api/escopo/tarefas/${quadro.tarefas[0].id}/mover`,
        payload: { estado: 'concluido', indice: 0 },
      });
      assert.equal(mover.json().tarefa.estado, 'concluido');

      const invalido = await app.inject({
        method: 'POST',
        url: `/api/escopo/tarefas/${quadro.tarefas[0].id}/mover`,
        payload: { estado: 'voando' },
      });
      assert.equal(invalido.statusCode, 400);

      const doc2 = await app.inject({
        method: 'POST',
        url: `/api/clientes/${cliente.id}/escopo/documentos`,
        payload: { nome: 'velho.doc', conteudoBase64: 'eA==' },
      });
      assert.equal(doc2.statusCode, 400);
      assert.match(doc2.json().error, /\.docx/);

      // Visualizar: o original volta como texto puro, nunca como página.
      const original = await app.inject({ method: 'GET', url: `/api/escopo/documentos/${docId}/arquivo` });
      assert.equal(original.statusCode, 200);
      assert.equal(original.body, 'criar tela');
      assert.match(String(original.headers['content-type']), /^text\/plain/);
      const texto = (await app.inject({ method: 'GET', url: `/api/escopo/documentos/${docId}/texto` })).json();
      assert.equal(texto.texto, 'criar tela');

      // Compartilhar: pasta relativa ou inexistente é recusada; a padrão do hub é criada.
      const rota = `/api/escopo/documentos/${docId}/compartilhamento`;
      assert.equal((await app.inject({ method: 'PUT', url: rota, payload: { pasta: 'relativa' } })).statusCode, 400);
      assert.equal(
        (await app.inject({ method: 'PUT', url: rota, payload: { pasta: join(dir.path, 'nao-existe') } })).statusCode,
        400,
      );
      const ligado = await app.inject({
        method: 'PUT',
        url: rota,
        payload: { pasta: quadro.pastaSugerida, nome: 'Portal: fase 1', criarPastaTarefas: true },
      });
      assert.equal(ligado.statusCode, 200);
      const arquivo = ligado.json().documento.compartilhamento.arquivo as string;
      assert.equal(arquivo, join(quadro.pastaSugerida, 'Tarefas', 'Portal- fase 1.json'));
      assert.ok(existsSync(arquivo));

      // Pasta já chamada Tarefas não ganha outra Tarefas dentro; trocar o nome apaga o antigo.
      const renomeado = await app.inject({
        method: 'PUT',
        url: rota,
        payload: { pasta: join(quadro.pastaSugerida, 'Tarefas'), nome: 'portal', criarPastaTarefas: true },
      });
      const arquivo2 = renomeado.json().documento.compartilhamento.arquivo as string;
      assert.equal(arquivo2, join(quadro.pastaSugerida, 'Tarefas', 'portal.json'));
      assert.ok(!existsSync(arquivo), 'o arquivo com o nome antigo sai');

      // Outra demanda não pode usar o mesmo arquivo, nem um JSON que não é do hub.
      const outroDoc = (
        await app.inject({
          method: 'POST',
          url: `/api/clientes/${cliente.id}/escopo/documentos`,
          payload: { nome: 'b.txt', conteudoBase64: Buffer.from('b').toString('base64') },
        })
      ).json().documento.id as number;
      const rota2 = `/api/escopo/documentos/${outroDoc}/compartilhamento`;
      const pastaTarefas = join(quadro.pastaSugerida, 'Tarefas');
      const repetido = await app.inject({ method: 'PUT', url: rota2, payload: { pasta: pastaTarefas, nome: 'portal.json' } });
      assert.equal(repetido.statusCode, 409);
      writeFileSync(join(pastaTarefas, 'alheio.json'), '{"meu":"conteudo"}');
      const alheio = await app.inject({ method: 'PUT', url: rota2, payload: { pasta: pastaTarefas, nome: 'alheio' } });
      assert.equal(alheio.statusCode, 409);
      assert.equal(readFileSync(join(pastaTarefas, 'alheio.json'), 'utf8'), '{"meu":"conteudo"}');

      await app.inject({ method: 'PUT', url: rota, payload: { pasta: '' } });
      assert.ok(!existsSync(arquivo2), 'desligar apaga o arquivo');
    } finally {
      await app.close();
      compartilhamento.fechar();
      escopo.close();
      clientes.close();
      dir.remove();
    }
  });
});
