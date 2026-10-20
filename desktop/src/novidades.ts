/**
 * Novidades da versão ao abrir o HUB SNK atualizado.
 *
 * A fonte é o `CHANGELOG.md` que vai no pacote (`scripts/preparar-hub.mjs`): cobre também
 * quem instala o setup na mão, o que o `releaseNotes` do `electron-updater` não pega, e
 * não depende de rede.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow, app, dialog, shell } from 'electron';
import { RAIZ_PROJETO } from './config';
import { logEvento } from './log';
import { compararVersoes, notasEntre, type NotasDeUmaVersao } from './notasDaVersao';

/** Quem pulou muitas versões vê as mais recentes; o resto fica no changelog completo. */
const MAXIMO_DE_VERSOES_NA_JANELA = 5;
const URL_DO_CHANGELOG = 'https://github.com/CarlosSimao/hub-snk/blob/main/CHANGELOG.md';
const BOTAO_VER_CHANGELOG = 1;

function arquivoDaVersaoVista(): string {
  return join(app.getPath('userData'), 'novidades.json');
}

function lerVersaoVista(): string | null {
  try {
    const dados = JSON.parse(readFileSync(arquivoDaVersaoVista(), 'utf8')) as {
      versaoVista?: unknown;
    };
    return typeof dados.versaoVista === 'string' ? dados.versaoVista : null;
  } catch {
    // Primeira instalação, ou arquivo corrompido: não há de onde contar as novidades.
    return null;
  }
}

function gravarVersaoVista(versao: string): void {
  try {
    writeFileSync(arquivoDaVersaoVista(), JSON.stringify({ versaoVista: versao }, null, 2), 'utf8');
  } catch (err) {
    // A próxima abertura mostra as mesmas novidades de novo, o que é melhor que perdê-las.
    logEvento('novidades-versao-nao-gravada', { erro: (err as Error).message });
  }
}

function montarDetalhe(notas: NotasDeUmaVersao[]): string {
  const exibidas = notas.slice(0, MAXIMO_DE_VERSOES_NA_JANELA);
  const blocos = exibidas.map(({ versao, texto }) => `Versão ${versao}\n${texto}`);
  const omitidas = notas.length - exibidas.length;
  if (omitidas > 0) {
    blocos.push(`E mais ${omitidas} versão(ões) anterior(es) no changelog completo.`);
  }
  return blocos.join('\n\n');
}

async function mostrarNovidades(
  janela: BrowserWindow,
  vista: string,
  atual: string,
): Promise<void> {
  gravarVersaoVista(atual);
  const changelog = readFileSync(join(RAIZ_PROJETO, 'CHANGELOG.md'), 'utf8');
  const notas = notasEntre(changelog, vista, atual);
  logEvento('novidades-exibidas', { de: vista, para: atual, versoes: notas.length });
  if (notas.length === 0) return;
  const { response } = await dialog.showMessageBox(janela, {
    type: 'info',
    title: 'Novidades do HUB SNK',
    message: `HUB SNK atualizado para a versão ${atual}`,
    detail: montarDetalhe(notas),
    buttons: ['OK', 'Ver changelog completo'],
    defaultId: 0,
    cancelId: 0,
  });
  if (response === BOTAO_VER_CHANGELOG) await shell.openExternal(URL_DO_CHANGELOG);
}

/**
 * Chamado na abertura. A primeira instalação só grava a versão. Versão mais nova que a
 * vista mostra as notas quando a janela aparece: aberto pelo Windows no login, o HUB sobe
 * escondido na bandeja, e a versão só conta como vista depois disso.
 */
export function mostrarNovidadesSeAtualizado(janela: BrowserWindow): void {
  const atual = app.getVersion();
  const vista = lerVersaoVista();
  if (!vista || compararVersoes(atual, vista) <= 0) {
    if (vista !== atual) gravarVersaoVista(atual);
    return;
  }
  const mostrar = () => {
    mostrarNovidades(janela, vista, atual).catch((err: Error) => {
      logEvento('novidades-falhou', { erro: err.message });
    });
  };
  if (janela.isVisible()) mostrar();
  else janela.once('show', mostrar);
}
