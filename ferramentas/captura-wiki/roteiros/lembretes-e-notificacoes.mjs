/**
 * Prints da página Lembretes e notificações da wiki (`site/wiki/lembretes-e-notificacoes.html`).
 *
 * Nada sai de verdade: o SMTP gravado fica vazio, o e-mail de teste é respondido por rota e o
 * e-mail do lembrete é o HTML que o próprio código monta, desenhado numa janela escondida.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ_DO_REPOSITORIO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PASTA_DOS_PRINTS = join(
  RAIZ_DO_REPOSITORIO,
  'site',
  'wiki',
  'img',
  'lembretes-e-notificacoes',
);
const LOGO = join(RAIZ_DO_REPOSITORIO, 'desktop', 'assets', 'hub-snk.png');
const LARGURA_DO_PRINT = 1264;
const ALTURA_DO_PRINT = 821;
const QUALIDADE_WEBP = 0.85;
const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

/** O mesmo UUID estável do `preparar-dados.mjs`: os ids dos clientes e contatos de lá. */
function id(apelido) {
  const h = createHash('md5').update(apelido).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function horaCheiaDaqui(milissegundos) {
  const data = new Date(Date.now() + milissegundos);
  data.setMinutes(0, 0, 0);
  return data.toISOString();
}

function gravar(pasta, arquivo, chave, conteudo) {
  writeFileSync(
    join(pasta, arquivo),
    JSON.stringify({ versaoDoEsquema: 1, [chave]: conteudo }, null, 2),
  );
}

function lembrete(apelido, dados) {
  const criadoEm = new Date(Date.now() - 30 * DIA).toISOString();
  return {
    id: id(apelido),
    resumo: '',
    texto: '',
    tipo: 'unico',
    dataHora: '',
    expressaoCron: '',
    clienteId: null,
    projetoId: null,
    enviarEmail: false,
    contatoIds: [],
    ativo: true,
    ultimoDisparoEm: '',
    criadoEm,
    atualizadoEm: criadoEm,
    ...dados,
  };
}

function notificacao(apelido, dados) {
  return {
    id: id(apelido),
    origem: 'lembrete',
    tag: 'padrão',
    chave: `wiki:${apelido}`,
    lida: false,
    erroDoEmail: '',
    ...dados,
  };
}

/**
 * Os recorrentes contam a próxima ocorrência a partir de agora, e o "Uma vez" futuro só
 * vence depois da captura: ao abrir, só dispara o atrasado, que é o que a wiki mostra.
 */
export function semear(pastaDeDados) {
  const agora = Date.now();
  const iso = (deslocamento) => new Date(agora + deslocamento).toISOString();
  const boaVista = id('c-boavista');

  gravar(pastaDeDados, 'lembretes.json', 'lembretes', [
    lembrete('lb-relatorio', {
      resumo: 'Relatório de horas',
      texto: 'Enviar o relatório de horas da semana ao coordenador.',
      tipo: 'recorrente',
      expressaoCron: '0 17 * * 5',
      enviarEmail: true,
      ultimoDisparoEm: iso(0),
    }),
    lembrete('lb-homologacao', {
      resumo: 'Homologar a pesagem em grupo',
      texto: 'Validar com a Marina a pesagem em grupo na base de teste.',
      dataHora: horaCheiaDaqui(3 * HORA),
      clienteId: boaVista,
      projetoId: id('p-boavista-pesagem'),
      enviarEmail: true,
      contatoIds: [id('ct-marina')],
    }),
    lembrete('lb-backup-alfa', {
      resumo: 'Conferir o backup da produção',
      texto: 'Conferir se o backup noturno da base de produção terminou.',
      tipo: 'recorrente',
      expressaoCron: '0 9 * * 1-5',
      clienteId: id('c-alfa'),
      ultimoDisparoEm: iso(0),
    }),
    lembrete('lb-certificado', {
      resumo: 'Renovar o certificado digital',
      texto: 'O certificado A1 da transportadora vence no fim do mês.',
      dataHora: horaCheiaDaqui(10 * DIA),
      clienteId: id('c-rotasul'),
      ativo: false,
    }),
    lembrete('lb-nota-fiscal', {
      resumo: 'Emitir a NF de serviço',
      texto: 'Emitir a nota fiscal de serviço do mês.',
      dataHora: new Date(Math.floor((agora - 3 * HORA) / MINUTO) * MINUTO).toISOString(),
      clienteId: boaVista,
    }),
  ]);

  gravar(pastaDeDados, 'notificacoes.json', 'notificacoes', {
    lista: [
      notificacao('nt-agenda', {
        origem: 'agenda',
        tag: 'OS',
        titulo: 'Agenda sem tarefa na Experience',
        mensagem:
          'FAZENDA BOA VISTA AGROPECUARIA LTDA (hoje, 08:00–12:00): nenhuma tarefa nem OS no dia.',
        criadaEm: iso(-40 * MINUTO),
      }),
      notificacao('nt-relatorio', {
        titulo: 'Relatório de horas',
        mensagem: 'Enviar o relatório de horas da semana ao coordenador.',
        criadaEm: iso(-5 * DIA),
        erroDoEmail: 'Configure o SMTP (host, remetente e destinatário) em Configurações › SMTP.',
      }),
      notificacao('nt-dicionario', {
        titulo: 'Atualizar o dicionário de dados',
        mensagem: 'Conferir os campos AD_ novos antes da homologação.\nIndústria Alfa',
        criadaEm: iso(-6 * DIA),
        lida: true,
      }),
    ],
    chavesEmitidas: {},
  });
}

/** `YYYY-MM-DDTHH:mm` de amanhã às 10h, no fuso do painel, para o `datetime-local`. */
function amanhaAsDez(painel) {
  return painel.evaluate(() => {
    const data = new Date();
    data.setDate(data.getDate() + 1);
    data.setHours(10, 0, 0, 0);
    const local = new Date(data.getTime() - data.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  });
}

/**
 * O e-mail do lembrete como o código o monta, com a logo embutida trocada por `data:` (o
 * `cid:` só existe dentro do e-mail). Fica igual nos dois temas: o e-mail tem cores fixas.
 */
async function printDoEmail(aplicativo, painel, nome) {
  const { montarEmailDoLembrete } = await import('../../../src/notificacoes/emailDoLembrete.ts');
  const { htmlComRemetente } = await import('../../../src/notificacoes/enviadorDeEmail.ts');
  const { dataHoraLocal } = await import('../../../src/notificacoes/relogio.ts');

  const email = montarEmailDoLembrete({
    resumo: 'Homologar a pesagem em grupo',
    texto: 'Validar com a Marina a pesagem em grupo na base de teste.',
    vinculo: 'Fazenda Boa Vista › Pesagem de rebanho',
    previstoPara: dataHoraLocal(new Date(horaCheiaDaqui(3 * HORA))),
    atrasado: false,
    copia: ['marina.duarte@boavista.example'],
    caminhoDaLogo: LOGO,
  });
  const logo = `data:image/png;base64,${readFileSync(LOGO).toString('base64')}`;
  const html = htmlComRemetente(email.html, {
    nome: 'Ana Souza',
    empresa: 'Consultoria Demo',
    time: 'Implantação',
  }).replaceAll('cid:logo-hub-snk', logo);

  const png = await aplicativo.evaluate(
    async ({ BrowserWindow }, [conteudo, largura, altura]) => {
      const janela = new BrowserWindow({
        show: false,
        width: largura,
        height: altura,
        useContentSize: true,
      });
      await janela.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(conteudo)}`);
      const imagem = await janela.webContents.capturePage();
      janela.destroy();
      return imagem.toDataURL();
    },
    [html, LARGURA_DO_PRINT, ALTURA_DO_PRINT],
  );
  const webp = await painel.evaluate(
    async ([origem, qualidade]) => {
      const imagem = new Image();
      imagem.src = origem;
      await imagem.decode();
      const canvas = document.createElement('canvas');
      canvas.width = imagem.width;
      canvas.height = imagem.height;
      canvas.getContext('2d').drawImage(imagem, 0, 0);
      return canvas.toDataURL('image/webp', qualidade);
    },
    [png, QUALIDADE_WEBP],
  );
  const claro = (await painel.evaluate(() => localStorage.getItem('hub-snk:tema'))) === 'light';
  const arquivo = join(PASTA_DOS_PRINTS, `${nome}${claro ? '-claro' : ''}.webp`);
  writeFileSync(arquivo, Buffer.from(webp.split(',')[1], 'base64'));
  console.log(`  lembretes-e-notificacoes/${nome}${claro ? '-claro' : ''}.webp (e-mail)`);
}

export async function roteiro({ painel, aplicativo, print, printDoSistema }) {
  const itemDaNotificacao = (texto) => painel.locator('.item-notificacao', { hasText: texto });
  const linhaDoLembrete = (texto) =>
    painel.locator('#mount-lembretes .linha-recurso', { hasText: texto });
  const botaoDaLinha = (texto, rotulo) =>
    linhaDoLembrete(texto).locator(`[aria-label="${rotulo}"]`);
  const fecharAvisos = () => painel.waitForTimeout(3500);

  await painel.route('**/api/notificacoes/email-de-teste', (rota) =>
    rota.fulfill({
      json: { mensagem: 'E-mail de teste enviado para ana.souza@consultoria.example.' },
    }),
  );

  // Sino e painel de notificações (o lembrete atrasado já disparou ao abrir)
  await painel.waitForSelector('#contador-notificacoes:not([hidden])');
  await print('painel-de-notificacoes-01-sino', { destacando: ['#btn-notificacoes'] });
  await painel.click('#btn-notificacoes');
  await itemDaNotificacao('Emitir a NF de serviço').waitFor();
  await print('painel-de-notificacoes-02-lista', { destacando: ['#painel-notificacoes'] });

  await print('disparo-01-atrasado', { destacando: [itemDaNotificacao('Emitir a NF de serviço')] });
  await print('enviar-por-email-03-falha', { destacando: ['.notificacao-erro-email'] });
  await print('alerta-da-agenda-02-notificacao', {
    destacando: [itemDaNotificacao('Agenda sem tarefa na Experience')],
  });

  // Marcar como lida e limpar
  await print('marcar-como-lida-e-limpar-01-uma', {
    destacando: [itemDaNotificacao('Emitir a NF de serviço')],
  });
  await itemDaNotificacao('Emitir a NF de serviço').click();
  await painel.click('#btn-marcar-notificacoes-lidas');
  await painel.waitForSelector('#contador-notificacoes[hidden]', { state: 'attached' });
  await print('marcar-como-lida-e-limpar-02-todas', {
    destacando: ['#btn-marcar-notificacoes-lidas'],
  });
  await painel.click('#btn-limpar-notificacoes');
  await painel.locator('#lista-notificacoes', { hasText: 'Nenhuma notificação.' }).waitFor();
  await print('marcar-como-lida-e-limpar-03-limpar', { destacando: ['#btn-limpar-notificacoes'] });
  await painel.keyboard.press('Escape');

  // Lista de lembretes
  await print('lista-de-lembretes-01-aba', { destacando: ['#btn-visualizacao-lembretes'] });
  await painel.click('#btn-visualizacao-lembretes');
  await linhaDoLembrete('Relatório de horas').waitFor();
  await print('lista-de-lembretes-02-lista', { destacando: ['#mount-lembretes'] });

  // Virar tarefa no kanban: o modal abre preenchido e é cancelado, sem criar a tarefa
  const virarTarefa = botaoDaLinha('Relatório de horas', 'Virar tarefa no kanban');
  await print('virar-tarefa-01-botao', { destacando: [virarTarefa] });
  await virarTarefa.click();
  await painel.waitForSelector('#modal-kanban-tarefa[open]');
  await print('virar-tarefa-02-modal', {
    destacando: ['#campo-kanban-tarefa-titulo', '#campo-kanban-tarefa-descricao'],
  });
  await painel.click('#btn-cancelar-kanban-tarefa');

  // Criar lembrete, com cliente, projeto, e-mail e contato em cópia
  const botaoNovo = painel.locator('#mount-lembretes [aria-label="Novo lembrete"]');
  await print('criar-lembrete-01-botao', { destacando: [botaoNovo] });
  await botaoNovo.click();
  await painel.fill('#campo-resumo-lembrete', 'Revisar o escopo da integração');
  await painel.fill(
    '#campo-texto-lembrete',
    'Revisar com o Paulo o escopo da integração com a balança.',
  );
  await painel.fill('#campo-data-hora-lembrete', await amanhaAsDez(painel));
  await print('criar-lembrete-02-formulario', {
    destacando: ['#campo-resumo-lembrete', '#campo-texto-lembrete', '#grupo-data-hora-lembrete'],
  });
  await painel.selectOption('#campo-cliente-lembrete', { label: 'Fazenda Boa Vista' });
  await painel.selectOption('#campo-projeto-lembrete', { label: 'Pesagem de rebanho' });
  await print('criar-lembrete-03-cliente', {
    destacando: ['#campo-cliente-lembrete', '#campo-projeto-lembrete'],
  });

  await painel.check('#campo-email-lembrete');
  await painel.waitForSelector('#aviso-smtp-lembrete:not([hidden])');
  await painel.locator('#aviso-smtp-lembrete').scrollIntoViewIfNeeded();
  await print('enviar-por-email-01-caixa', {
    destacando: [
      painel.locator('label', { has: painel.locator('#campo-email-lembrete') }),
      '#aviso-smtp-lembrete',
    ],
  });

  await painel.click('#btn-adicionar-contato-lembrete');
  await painel.locator('#opcoes-contatos-lembrete').scrollIntoViewIfNeeded();
  await print('contatos-em-copia-01-lista', { destacando: ['#opcoes-contatos-lembrete'] });
  await painel
    .locator('#opcoes-contatos-lembrete .opcao-de-contato', { hasText: 'Paulo Henrique Lima' })
    .click();
  await print('contatos-em-copia-02-escolhido', { destacando: ['#lista-contatos-lembrete'] });

  await painel.click('#btn-salvar-lembrete');
  await painel.waitForSelector('.aviso');
  await print('criar-lembrete-04-salvo', {
    destacando: [linhaDoLembrete('Revisar o escopo da integração')],
  });
  await fecharAvisos();

  // Lembrete recorrente
  await botaoNovo.click();
  await painel.fill('#campo-resumo-lembrete', 'Apontar as horas');
  await painel.fill('#campo-texto-lembrete', 'Apontar as horas do dia na Experience.');
  await painel.check('input[name="tipo-lembrete"][value="recorrente"]');
  await painel.selectOption('#campo-modelo-recorrencia', '0 9 * * 1-5');
  await painel.locator('#previa-cron', { hasText: 'Próximas:' }).waitFor();
  await print('recorrente-01-modelo', {
    destacando: [
      painel.locator('fieldset', { has: painel.locator('input[name="tipo-lembrete"]') }),
      '#grupo-recorrencia-lembrete',
    ],
  });
  await painel.click('#btn-cancelar-lembrete');

  // Editar, desligar e excluir
  const novo = 'Revisar o escopo da integração';
  await print('editar-desligar-e-excluir-01-editar', {
    destacando: [botaoDaLinha(novo, 'Editar lembrete')],
  });
  await botaoDaLinha(novo, 'Editar lembrete').click();
  await painel.uncheck('#campo-ativo-lembrete');
  await painel.locator('#campo-ativo-lembrete').scrollIntoViewIfNeeded();
  await print('editar-desligar-e-excluir-02-ativo', {
    destacando: [painel.locator('label', { has: painel.locator('#campo-ativo-lembrete') })],
  });
  await painel.click('#btn-salvar-lembrete');
  await painel.waitForSelector('.aviso');
  await linhaDoLembrete(novo).scrollIntoViewIfNeeded();
  await print('editar-desligar-e-excluir-03-desligado', { destacando: [linhaDoLembrete(novo)] });
  await fecharAvisos();
  await print('editar-desligar-e-excluir-04-excluir', {
    destacando: [botaoDaLinha(novo, 'Excluir lembrete')],
  });
  await botaoDaLinha(novo, 'Excluir lembrete').click();
  await print('editar-desligar-e-excluir-05-confirmar', {
    destacando: ['#btn-confirmar-exclusao'],
  });
  await painel.click('#btn-confirmar-exclusao');
  await fecharAvisos();

  // Servidor de e-mail (SMTP), com o e-mail de teste respondido pela rota
  await painel.click('#btn-configuracao');
  await painel.click('#aba-configuracao-smtp');
  await print('servidor-de-email-01-aba', { destacando: ['#aba-configuracao-smtp'] });
  await painel.fill('#campo-smtp-host', 'smtp.consultoria.example');
  await painel.fill('#campo-smtp-porta', '587');
  await painel.selectOption('#campo-smtp-seguranca', 'starttls');
  await painel.fill('#campo-smtp-usuario', 'ana.souza@consultoria.example');
  await painel.fill('#campo-smtp-senha', 'senha-ficticia');
  await painel.fill('#campo-smtp-remetente', 'ana.souza@consultoria.example');
  await painel.fill('#campo-smtp-destinatario', 'ana.souza@consultoria.example');
  await print('servidor-de-email-02-campos', {
    destacando: [painel.locator('#painel-configuracao-smtp fieldset')],
  });
  await painel.click('#btn-testar-smtp');
  await painel.waitForSelector('#resultado-teste-smtp.sucesso');
  await print('servidor-de-email-03-teste', {
    destacando: ['#btn-testar-smtp', '#resultado-teste-smtp'],
  });

  // Alerta da agenda (só mostrado: Cancelar não grava)
  await painel.click('#aba-configuracao-avisos');
  await painel.check('#campo-alerta-agenda-ativo');
  await print('alerta-da-agenda-01-avisos', { destacando: ['#grupo-alerta-agenda'] });
  await painel.click('#btn-cancelar-configuracao');

  // O e-mail que o lembrete manda
  await printDoEmail(aplicativo, painel, 'enviar-por-email-02-email');

  // Aviso do Windows e barra de tarefas, na área de trabalho fictícia
  await printDoSistema('aviso-do-windows-01-aviso', {
    cena: 'aviso',
    titulo: 'Relatório de horas',
    corpo: 'Enviar o relatório de horas da semana ao coordenador.',
  });
  await printDoSistema('aviso-do-windows-02-piscando', { cena: 'piscando' });
  await printDoSistema('alerta-da-agenda-03-aviso-do-windows', {
    cena: 'aviso',
    titulo: 'Agenda sem tarefa na Experience',
    corpo: 'FAZENDA BOA VISTA AGROPECUARIA LTDA (hoje, 08:00–12:00): nenhuma tarefa nem OS no dia.',
  });
}
