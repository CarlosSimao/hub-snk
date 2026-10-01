/**
 * Compatibilidade com Flash (telas Flex legadas do Sankhya Om) pelo Ruffle, um emulador
 * de Flash Player em WebAssembly.
 *
 * O Ruffle precisa entrar na página antes do script do Sankhya que confere se o Flash
 * existe; por isso é um preload de sessão (`preloadRuffle.js`), que roda no começo de
 * cada frame. Desligado, o preload sai das sessões e nenhuma página recebe nada. Ligado,
 * cada página do Sankhya paga só o carregador (`ruffle.js`); o motor (`.wasm`, ~14 MB) só
 * é baixado pela página que tiver um SWF.
 *
 * Os arquivos do pacote são servidos pelo protocolo `hub-ruffle://`, e só eles.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { app, ipcMain, protocol, session } from 'electron';
import { logEvento, origemSemQuery } from '../log';

const ESQUEMA = 'hub-ruffle';
const ENDERECO_DOS_ARQUIVOS = `${ESQUEMA}://ruffle/`;
const CANAL_DO_CODIGO = 'ruffle:codigo';
/** As telas do Sankhya Om ficam sob `/mge`: o Painel e a Experience ficam de fora. */
const CAMINHO_DO_SANKHYA_OM = '/mge';
/** Só nome de arquivo solto: nada de `../` nem subpasta. */
const NOME_DE_ARQUIVO_VALIDO = /^[\w.-]+$/;

const TIPOS_POR_EXTENSAO: Record<string, string> = {
  '.js': 'text/javascript',
  // Sem este tipo o navegador recusa compilar o `.wasm` enquanto baixa.
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

const PASTA_DO_PACOTE = dirname(require.resolve('@ruffle-rs/ruffle'));

const particoes = new Set<string>();
/** Id do preload registrado em cada partição, enquanto o Ruffle está ligado. */
const preloadsRegistrados = new Map<string, string>();
let ligado: boolean | null = null;
let codigoDoCarregador: string | null = null;

function arquivoDaPreferencia(): string {
  return join(app.getPath('userData'), 'ruffle.json');
}

function lerPreferencia(): boolean {
  try {
    const dados = JSON.parse(readFileSync(arquivoDaPreferencia(), 'utf8')) as { ligado?: unknown };
    return dados.ligado === true;
  } catch {
    // Primeira execução, ou arquivo corrompido: desligado, que não gasta nada.
    return false;
  }
}

function gravarPreferencia(valor: boolean): void {
  try {
    writeFileSync(arquivoDaPreferencia(), JSON.stringify({ ligado: valor }, null, 2), 'utf8');
  } catch (err) {
    // A sessão atual respeita a escolha; a próxima abre desligada.
    logEvento('ruffle-preferencia-nao-gravada', { erro: (err as Error).message });
  }
}

export function ruffleLigado(): boolean {
  ligado ??= lerPreferencia();
  return ligado;
}

/**
 * O `publicPath` vai antes do carregador: injetado como texto, ele não tem de onde tirar
 * o endereço dos próprios arquivos.
 */
function codigoParaAPagina(): string {
  codigoDoCarregador ??= readFileSync(join(PASTA_DO_PACOTE, 'ruffle.js'), 'utf8');
  const configuracao = `window.RufflePlayer = window.RufflePlayer || {};
window.RufflePlayer.config = Object.assign({}, window.RufflePlayer.config, {
  publicPath: ${JSON.stringify(ENDERECO_DOS_ARQUIVOS)},
});`;
  return `${configuracao}\n${codigoDoCarregador}`;
}

function ehPaginaDoSankhyaOm(endereco: string): boolean {
  try {
    const { protocol: esquema, pathname } = new URL(endereco);
    const web = esquema === 'http:' || esquema === 'https:';
    return web && pathname.startsWith(CAMINHO_DO_SANKHYA_OM);
  } catch {
    return false;
  }
}

async function servirArquivo(requisicao: Request): Promise<Response> {
  const nome = decodeURIComponent(new URL(requisicao.url).pathname.slice(1));
  const tipo = TIPOS_POR_EXTENSAO[extname(nome)];
  if (!NOME_DE_ARQUIVO_VALIDO.test(nome) || !tipo) {
    return new Response('não encontrado', { status: 404 });
  }
  try {
    const conteudo = await readFile(join(PASTA_DO_PACOTE, nome));
    // O `.wasm` é buscado pela página do Sankhya, de outra origem.
    return new Response(conteudo, {
      headers: { 'content-type': tipo, 'access-control-allow-origin': '*' },
    });
  } catch (err) {
    logEvento('ruffle-arquivo-nao-servido', { nome, erro: (err as Error).message });
    return new Response('não encontrado', { status: 404 });
  }
}

function registrarPreload(particao: string): void {
  if (preloadsRegistrados.has(particao)) return;
  const id = session.fromPartition(particao).registerPreloadScript({
    type: 'frame',
    filePath: join(__dirname, '..', 'preloads', 'preloadRuffle.js'),
  });
  preloadsRegistrados.set(particao, id);
}

function removerPreload(particao: string): void {
  const id = preloadsRegistrados.get(particao);
  if (!id) return;
  session.fromPartition(particao).unregisterPreloadScript(id);
  preloadsRegistrados.delete(particao);
}

/** Antes do `app.whenReady`: esquema privilegiado só pode ser declarado nesse momento. */
export function registrarEsquemaDoRuffle(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ESQUEMA,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
  // Quem decide se o frame recebe o Ruffle é o processo principal, pelo endereço dele: o
  // preload não sabe nada, e com o Ruffle desligado ele nem roda.
  ipcMain.on(CANAL_DO_CODIGO, (evento) => {
    const endereco = evento.senderFrame?.url ?? '';
    if (!ruffleLigado() || !ehPaginaDoSankhyaOm(endereco)) {
      evento.returnValue = '';
      return;
    }
    logEvento('ruffle-injetado', { url: origemSemQuery(endereco) });
    evento.returnValue = codigoParaAPagina();
  });
}

/** Uma vez por partição com página do Sankhya: a das guias principais e a de cada base. */
export function prepararParticaoParaRuffle(particao: string): void {
  if (particoes.has(particao)) return;
  particoes.add(particao);
  session.fromPartition(particao).protocol.handle(ESQUEMA, servirArquivo);
  if (ruffleLigado()) registrarPreload(particao);
}

/** Vale para as páginas abertas depois: a tela já aberta segue como está até recarregar. */
export function alternarRuffle(): void {
  ligado = !ruffleLigado();
  gravarPreferencia(ligado);
  for (const particao of particoes) {
    if (ligado) registrarPreload(particao);
    else removerPreload(particao);
  }
  logEvento(ligado ? 'ruffle-ligado' : 'ruffle-desligado', { particoes: particoes.size });
}
