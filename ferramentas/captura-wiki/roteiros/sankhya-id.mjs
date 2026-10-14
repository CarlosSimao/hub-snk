/**
 * Prints da página Sankhya ID e login automático da wiki (`site/wiki/sankhya-id.html`).
 *
 * Nada aqui fala com o Sankhya: o cofre do aplicativo, o login automático e a captura da
 * sessão respondem por rotas simuladas, e o usuário e a senha são fictícios. As telas de
 * login do SankhyaOm e da Experience ficam de fora (são de terceiros). A ordem importa:
 * cada passo parte do estado que o anterior deixou na tela.
 */
const USUARIO_FICTICIO = 'ana.souza@consultoria.example';
const SENHA_FICTICIA = 'senha-ficticia';
const CODUSU_FICTICIO = '4817';
const HORAS_DE_SESSAO = 8;

/** Texto exato do aplicativo (`desktop/src/sankhya/cofreCredenciais.ts`) para o login suspenso. */
const MENSAGEM_DE_LOGIN_SUSPENSO =
  'login automático suspenso: o Sankhya recusou a senha salva mais de uma vez seguida — ' +
  'confira usuário e senha no Sankhya ID e salve de novo';

const caminhoE = (caminho) => (url) => url.pathname === caminho;
const comecaCom = (prefixo) => (url) => url.pathname.startsWith(prefixo);

/** Cofre e sessões de mentira, no formato de `/api/sankhya/credenciais`. */
async function simularCofre(painel, cofre) {
  const status = (sistema) => ({
    sistema,
    usuario: cofre.definido ? USUARIO_FICTICIO : '',
    definido: cofre.definido,
    aviso: '',
    sessaoCapturada: cofre.sessoes[sistema],
    sessaoExpiraEm: cofre.sessoes[sistema]
      ? new Date(Date.now() + HORAS_DE_SESSAO * 3_600_000).toISOString()
      : '',
  });
  const sistemaDaUrl = (rota) => new URL(rota.request().url()).pathname.split('/').pop();

  await painel.route(caminhoE('/api/sankhya/shell'), (rota) =>
    rota.fulfill({ json: { disponivel: true } }),
  );
  await painel.route(caminhoE('/api/sankhya/credenciais'), (rota) =>
    rota.fulfill({ json: { credenciais: ['sankhya-erp', 'sankhya-experience'].map(status) } }),
  );
  await painel.route(caminhoE('/api/sankhya/id/senha'), (rota) =>
    rota.fulfill({ json: { senha: cofre.definido ? SENHA_FICTICIA : '' } }),
  );
  await painel.route(caminhoE('/api/sankhya/id'), (rota) => {
    cofre.definido = rota.request().method() === 'POST';
    const { usuario, definido, aviso } = status('sankhya-erp');
    rota.fulfill({ json: { usuario, definido, aviso } });
  });
  // Login automático e captura: nenhuma guia do Sankhya é aberta, a sessão só vira "ativa".
  for (const acao of ['autologin', 'capturar']) {
    await painel.route(comecaCom(`/api/sankhya/navegador/${acao}/`), (rota) => {
      cofre.sessoes[sistemaDaUrl(rota)] = true;
      rota.fulfill({ json: { ok: true, cookies: 3 } });
    });
  }
}

export async function roteiro({ painel, print }) {
  const cofre = { definido: false, sessoes: { 'sankhya-erp': false, 'sankhya-experience': false } };
  await simularCofre(painel, cofre);

  const cartaoDoId = (papel) => painel.locator(`#cartao-sankhya-id [data-papel="${papel}"]`);
  const cartaoDaExperience = painel.locator('[data-sistema="sankhya-experience"]');
  const seloDaExperience = cartaoDaExperience.locator('[data-papel="status"]');
  const fecharAvisos = () => painel.waitForTimeout(3500);
  const abrirAbaSankhyaId = async () => {
    await painel.click('#btn-configuracao');
    await painel.click('#aba-configuracao-sankhya-id');
    await painel.waitForSelector('#painel-configuracao-sankhya-id:not([hidden])');
  };

  // Salvar o Sankhya ID
  await abrirAbaSankhyaId();
  await print('salvar-01-aba', { destacando: ['#aba-configuracao-sankhya-id'] });
  await cartaoDoId('usuario').fill(USUARIO_FICTICIO);
  await cartaoDoId('senha').fill(SENHA_FICTICIA);
  await print('salvar-02-preencher', {
    destacando: [cartaoDoId('usuario'), cartaoDoId('senha'), cartaoDoId('salvar')],
  });
  await cartaoDoId('salvar').click();
  await seloDaExperience.filter({ hasText: 'Sessão ativa' }).waitFor();
  // Os avisos do login automático cobririam o selo da Experience.
  await fecharAvisos();
  await print('salvar-03-salvo', {
    destacando: [0, 1, 2].map((indice) =>
      painel.locator('#painel-configuracao-sankhya-id [data-papel="status"]').nth(indice),
    ),
  });
  await print('salvar-04-remover', { destacando: [cartaoDoId('remover')] });

  // Meu código de usuário SankhyaOm (gravado de verdade, nos dados fictícios)
  await painel.fill('#campo-sankhya-om-codusu', CODUSU_FICTICIO);
  await print('codigo-01-preencher', {
    destacando: ['#campo-sankhya-om-codusu', '#btn-salvar-codusu'],
  });
  await painel.click('#btn-salvar-codusu');
  await painel.waitForSelector('.aviso');
  await print('codigo-02-salvo', { destacando: ['.aviso'] });
  await fecharAvisos();
  await painel.click('#btn-cancelar-configuracao');

  // Capturar a sessão à mão: a da Experience "caiu" e o login automático não a refez.
  cofre.sessoes['sankhya-experience'] = false;
  await abrirAbaSankhyaId();
  await seloDaExperience.filter({ hasText: 'sem sessão capturada' }).waitFor();
  await cartaoDaExperience.scrollIntoViewIfNeeded();
  await print('capturar-01-cartao', { destacando: [cartaoDaExperience] });
  await cartaoDaExperience.locator('[data-papel="capturar-sessao"]').click();
  await seloDaExperience.filter({ hasText: 'Sessão ativa' }).waitFor();
  await print('capturar-02-capturada', { destacando: [seloDaExperience] });
  await fecharAvisos();

  // Sessão da Experience em segundo plano: o selo mostra até quando ela vale.
  await print('sessao-experience-01', { destacando: [seloDaExperience] });
  await painel.click('#btn-cancelar-configuracao');

  // Proteção contra bloqueio: a consulta da agenda devolve o aviso do login suspenso.
  await painel.route(caminhoE('/api/agenda/consultar'), (rota) =>
    rota.fulfill({ status: 409, json: { mensagem: MENSAGEM_DE_LOGIN_SUSPENSO } }),
  );
  await painel.click('#btn-visualizacao-agenda');
  const erroDaAgenda = painel.locator('#visualizacao-agenda .erro-formulario:not([hidden])');
  await erroDaAgenda.waitFor();
  await painel.waitForSelector('.camada-carregando', { state: 'detached' });
  await print('bloqueio-01-agenda', { destacando: [erroDaAgenda] });

  // Terceiro: só marcado na tela, sem salvar (salvar recarregaria o Painel).
  await painel.click('#btn-configuracao');
  await painel.click('#aba-configuracao-acessos');
  await painel.check('#campo-terceiro');
  const caixaDoMenu = (chave) =>
    painel.locator('label.campo-checkbox', {
      has: painel.locator(`[data-funcionalidade="${chave}"]`),
    });
  await print('terceiro-01-marcar', {
    destacando: [
      painel.locator('label.campo-checkbox', { has: painel.locator('#campo-terceiro') }),
      caixaDoMenu('agenda'),
      caixaDoMenu('os'),
    ],
  });
  await painel.click('#btn-cancelar-configuracao');
}
