/**
 * Prints da página Suporte da wiki (`site/wiki/suporte.html`).
 *
 * Nenhum relato sai daqui: o envio e a prévia respondem pela simulação abaixo, no formato
 * de `src/rotas/rotasSuporte.ts`. A prévia real traria o log e a versão do Windows da
 * máquina que roda a captura; a simulada mostra o mesmo formato com dados fictícios. A
 * consulta de versão nova também é simulada, para o aviso aparecer em qualquer dia.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ_DO_REPOSITORIO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const VERSAO = JSON.parse(readFileSync(join(RAIZ_DO_REPOSITORIO, 'package.json'), 'utf8')).version;
const EMAIL = 'ana.souza@consultoria.example';

/** O envio exige o e-mail de Configurações › Geral, que os dados comuns não têm. */
export function semear(pastaDeDados) {
  const arquivo = join(pastaDeDados, 'configuracao.json');
  const conteudo = JSON.parse(readFileSync(arquivo, 'utf8'));
  conteudo.configuracao.emailDoUsuario = EMAIL;
  writeFileSync(arquivo, JSON.stringify(conteudo, null, 2));
}

function versaoSeguinte() {
  const [maior, menor] = VERSAO.split('.').map(Number);
  return `${maior}.${menor + 1}.0`;
}

/** Mesmo formato de `montarLogDeDiagnostico`: o final de cada log, já mascarado. */
function previaFicticia() {
  const agora = Date.now();
  const hora = (segundos) => new Date(agora - segundos * 1000).toISOString();
  const desktop = [
    { ts: hora(300), evento: 'app-pronto' },
    { ts: hora(299), evento: 'bridge-servidor-no-ar', host: '127.0.0.1', porta: 4103 },
    { ts: hora(298), evento: 'backend-pronto', url: 'http://127.0.0.1:4100' },
    { ts: hora(120), evento: 'menu-item-escolhido', rotulo: 'Recarregar a guia atual' },
  ].map((linha) => JSON.stringify(linha));
  const pastaDeDados = 'C:\\Users\\[usuario]\\AppData\\Roaming\\HUB SNK\\dados';
  const backend = [
    '[09:12:03.114] INFO (8124): Server listening at http://127.0.0.1:4100',
    `[09:12:03.115] INFO (8124): Dados em ${pastaDeDados}`,
    `[09:12:03.116] INFO (8124): Vigiando alterações externas em ${pastaDeDados}`,
  ];
  return {
    contexto: {
      appVersion: VERSAO,
      platform: 'win32',
      os: 'Windows 11 Pro (10.0.26100)',
      arch: 'x64',
      perfil: 'desenvolvedor',
      usuario: 'Ana Souza',
      empresa: 'Consultoria Demo',
      time: 'Implantação',
      email: EMAIL,
    },
    log: `===== desktop.log =====\n${desktop.join('\n')}\n\n===== backend.log =====\n${backend.join('\n')}`,
  };
}

export async function roteiro({ painel, print }) {
  let situacaoDoEnvio = 'enviado';
  await painel.route('**/api/suporte/previa', (rota) => rota.fulfill({ json: previaFicticia() }));
  await painel.route('**/api/suporte/relatos', (rota) =>
    rota.fulfill({
      status: situacaoDoEnvio === 'enviado' ? 201 : 202,
      json: { situacao: situacaoDoEnvio },
    }),
  );
  const proxima = versaoSeguinte();
  await painel.route('**/api/sistema/atualizacao', (rota) =>
    rota.fulfill({
      json: {
        versaoInstalada: VERSAO,
        ultimaVersao: proxima,
        atualizacaoDisponivel: true,
        url: `https://github.com/CarlosSimao/hub-snk/releases/tag/v${proxima}`,
      },
    }),
  );
  await painel.reload();
  await painel.waitForSelector('#indicador-git-global:not([hidden])');

  const preencherRelato = async (mensagem) => {
    await painel.click('#btn-reportar-problema');
    await painel.waitForSelector('#modal-relato[open]');
    await painel.selectOption('#campo-tipo-relato', 'BUG');
    await painel.fill('#campo-mensagem-relato', mensagem);
    await painel.fill('#campo-email-relato', EMAIL);
  };

  // Versão instalada e versão nova
  await painel.click('#btn-configuracao');
  await painel.click('#aba-configuracao-sobre');
  await painel.waitForSelector('#rodape-atualizacao:not([hidden])');
  await print('versao-01-sobre', {
    destacando: ['.bloco-sobre-destaque', '#rodape-atualizacao'],
  });

  // Reportar problema ou sugerir
  await print('reportar-01-botao', { destacando: ['#btn-reportar-problema'] });
  await preencherRelato(
    'Ao abrir a base de teste da Fazenda Boa Vista, a guia fica em branco. A de produção abre normalmente.',
  );
  await print('reportar-02-formulario', {
    destacando: ['#campo-tipo-relato', '#campo-mensagem-relato', '#campo-email-relato'],
  });
  await print('reportar-03-log', { destacando: ['.opcao-relato'] });

  // Ver o que será enviado
  await painel.click('#btn-previa-relato');
  const previa = painel.locator('#previa-relato', { hasText: 'Log de diagnóstico' });
  await previa.waitFor();
  // A prévia é maior que a janela: rola até ela e deixa o começo do log à vista.
  await previa.evaluate((pre) => {
    pre.scrollIntoView({ block: 'end' });
    const texto = pre.firstChild;
    const faixa = document.createRange();
    faixa.setStart(texto, texto.textContent.indexOf('— Log de diagnóstico'));
    pre.scrollTop += faixa.getBoundingClientRect().top - pre.getBoundingClientRect().top - 120;
  });
  await print('previa-01', { destacando: ['#previa-relato'] });
  await painel.click('#btn-previa-relato');

  // Enviar
  await painel.click('#btn-enviar-relato');
  await painel.waitForSelector('#aviso-relato:not([hidden])');
  await print('reportar-04-enviado', { destacando: ['#aviso-relato'] });
  await painel.click('#btn-cancelar-relato');

  // Sem conexão: o relato fica na fila
  situacaoDoEnvio = 'enfileirado';
  await preencherRelato('Sugestão: mostrar a versão do SankhyaOm na lista de bases.');
  await painel.selectOption('#campo-tipo-relato', 'SUGESTAO');
  await painel.click('#btn-enviar-relato');
  await painel.waitForSelector('#aviso-relato:not([hidden])');
  await print('sem-conexao-01', { destacando: ['#aviso-relato'] });
  await painel.click('#btn-cancelar-relato');
  await painel.click('#btn-cancelar-configuracao');
}
