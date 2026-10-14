/**
 * Prints da página Primeiros passos da wiki (`site/wiki/primeiros-passos.html`).
 *
 * A pasta de dados sai como a de uma instalação nova: sem perfil e sem as boas-vindas
 * concluídas, para o assistente abrir. Instalador, SmartScreen, aviso do Windows e
 * desinstalação são telas do sistema e ficam fora daqui.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Tira da configuração o que o assistente de boas-vindas pergunta. */
export function semear(pastaDeDados) {
  const arquivo = join(pastaDeDados, 'configuracao.json');
  const conteudo = JSON.parse(readFileSync(arquivo, 'utf8'));
  for (const chave of [
    'perfil',
    'boasVindasConcluidas',
    'nomeDoUsuario',
    'empresaDoUsuario',
    'timeDoUsuario',
  ]) {
    delete conteudo.configuracao[chave];
  }
  writeFileSync(arquivo, JSON.stringify(conteudo, null, 2));
}

/** Mesmo contorno do `capturar.mjs`, para as telas fora do Painel (barra de guias, menu ☰). */
async function destacarFora(pagina, localizador) {
  await localizador.evaluate((alvo) => {
    const caixa = alvo.getBoundingClientRect();
    const marca = document.createElement('div');
    marca.className = 'marca-da-wiki';
    const folga = 4;
    Object.assign(marca.style, {
      position: 'fixed',
      left: `${caixa.left - folga}px`,
      top: `${caixa.top - folga}px`,
      width: `${caixa.width + folga * 2}px`,
      height: `${caixa.height + folga * 2}px`,
      border: '3px solid #f59e0b',
      borderRadius: '10px',
      boxShadow: '0 0 0 4px rgba(245, 158, 11, 0.25)',
      pointerEvents: 'none',
      zIndex: '2147483647',
    });
    document.body.append(marca);
  });
  return () =>
    pagina.evaluate(() => document.querySelectorAll('.marca-da-wiki').forEach((m) => m.remove()));
}

export async function roteiro({ painel, aplicativo, print }) {
  const paginas = () => aplicativo.context().pages();
  const moldura = paginas().find((p) => /telas[\\/]index\.html$/.test(p.url()));
  const passo = (numero) => painel.locator(`#modal-boas-vindas [data-passo="${numero}"]`);
  const avancar = () => painel.click('#btn-avancar-boas-vindas');

  // Boas-vindas
  await painel.waitForSelector('#modal-boas-vindas[open]');
  await painel.fill('#campo-nome-boas-vindas', 'Ana Souza');
  await painel.fill('#campo-empresa-boas-vindas', 'Consultoria Demo');
  await painel.fill('#campo-time-boas-vindas', 'Implantação');
  await painel.fill('#campo-email-boas-vindas', 'ana.souza@consultoria.example');
  await print('boas-vindas-01-identificacao', {
    destacando: [0, 1, 2, 3].map((i) => passo(1).locator('.campo').nth(i)),
  });
  await avancar();
  await painel.locator('.opcao-boas-vindas', { hasText: 'Desenvolvedor' }).click();
  await print('boas-vindas-02-perfil', {
    destacando: [painel.locator('.opcao-boas-vindas', { hasText: 'Desenvolvedor' })],
  });
  await avancar();
  await print('boas-vindas-03-login-no-sankhya', {
    destacando: [passo(3).locator('.opcao-boas-vindas').first()],
  });
  await avancar();
  await print('boas-vindas-04-resumo', { destacando: ['#btn-avancar-boas-vindas'] });
  await avancar();
  await painel.waitForSelector('#modal-boas-vindas', { state: 'hidden' });

  // Conhecer a tela. Sem a sessão da Experience, as OS do Resumo dariam erro: a consulta
  // responde vazia, como a de quem não tem OS aberta.
  await painel.route('**/api/os/consultar', (rota) =>
    rota.fulfill({ json: { itens: [], buscadoEm: new Date().toISOString() } }),
  );
  await painel.click('#btn-visualizacao-resumo');
  await painel.waitForTimeout(1500);
  const limparGuia = await destacarFora(moldura, moldura.locator('#abas [data-id="hub"]'));
  await print('painel-01-guia-painel');
  await limparGuia();
  await print('painel-02-menu', { destacando: ['.barra-visualizacao'] });
  await print('painel-03-botoes', {
    destacando: [
      '#btn-busca-rapida',
      '#btn-notificacoes',
      '#btn-configuracao',
      '#btn-atalhos',
      '#indicador-git-global',
    ],
  });

  // Tema claro e escuro
  await painel.click('#btn-configuracao');
  await painel.click('#aba-configuracao-geral');
  await print('tema-01-botao', { destacando: ['#btn-tema'] });
  await painel.click('#btn-cancelar-configuracao');

  // Atualização automática: menu ☰ › Ajuda
  const limparBotao = await destacarFora(moldura, moldura.locator('#menu'));
  await print('atualizacao-01-menu');
  await limparBotao();
  await moldura.click('#menu');
  const menu = await aplicativo
    .context()
    .waitForEvent('page', { predicate: (p) => p.url().endsWith('menu.html'), timeout: 5000 })
    .catch(() => paginas().find((p) => p.url().endsWith('menu.html')));
  const caixa = menu.locator('.item', { hasText: 'Atualizar automaticamente' });
  await caixa.waitFor();
  await caixa.scrollIntoViewIfNeeded();
  const limparMenu = await destacarFora(menu, caixa);
  await print('atualizacao-02-ajuda');
  await limparMenu();
  await menu.keyboard.press('Escape');
}
