/**
 * Peças compartilhadas pelo empacotamento do Windows e pelo dos pacotes Unix.
 *
 * Os dois montam a mesma coisa — o programa, as dependências de produção e um
 * Node próprio — e mudam só no formato final e no binário embutido.
 */
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSAO_DO_NODE_EMBUTIDO = 'v22.18.0';

const BYTES_POR_MEGABYTE = 1024 * 1024;

/* Só o que o programa precisa para rodar. Testes, docs e o .git ficam de fora. */
const ITENS_COPIADOS = ['src', 'public', 'package.json'];

export const raizDoProjeto = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const pastaDoCache = join(raizDoProjeto, 'dist', 'cache');

export function megabytes(bytes) {
  return `${(bytes / BYTES_POR_MEGABYTE).toFixed(1)} MB`;
}

export async function existe(caminho) {
  try {
    await stat(caminho);
    return true;
  } catch {
    return false;
  }
}

/**
 * Baixa um arquivo de nodejs.org guardando uma cópia em `dist/cache`: os
 * binários passam de 40 MB e repetir o empacotamento não deve repetir o
 * download.
 */
export async function baixarComCache(endereco, caminhoNoCache) {
  if (await existe(caminhoNoCache)) {
    console.log(`Reaproveitado do cache: ${caminhoNoCache}`);
    return caminhoNoCache;
  }

  console.log(`Baixando ${endereco} ...`);
  const resposta = await fetch(endereco);
  if (!resposta.ok) {
    throw new Error(
      `Download falhou: HTTP ${resposta.status} em ${endereco}. ` +
        `Confira se a versão ${VERSAO_DO_NODE_EMBUTIDO} existe em nodejs.org/dist.`,
    );
  }

  await mkdir(pastaDoCache, { recursive: true });
  const conteudo = Buffer.from(await resposta.arrayBuffer());
  await writeFile(caminhoNoCache, conteudo);
  console.log(`Baixado (${megabytes(conteudo.length)}).`);

  return caminhoNoCache;
}

/**
 * As dependências vão para a distribuição sem as de desenvolvimento. O
 * `npm ci` é executado numa pasta própria para não mexer no `node_modules` de
 * quem está desenvolvendo.
 *
 * O resultado é reaproveitado entre plataformas: as dependências do HUB SNK são
 * todas JavaScript puro, sem binário compilado por sistema.
 */
export async function instalarDependenciasDeProducao() {
  const pastaDeInstalacao = join(raizDoProjeto, 'dist', 'dependencias');
  const caminhoDoNodeModules = join(pastaDeInstalacao, 'node_modules');

  if (await existe(caminhoDoNodeModules)) {
    console.log('Dependências de produção reaproveitadas.');
    return caminhoDoNodeModules;
  }

  await rm(pastaDeInstalacao, { recursive: true, force: true });
  await mkdir(pastaDeInstalacao, { recursive: true });

  for (const arquivo of ['package.json', 'package-lock.json']) {
    await cp(join(raizDoProjeto, arquivo), join(pastaDeInstalacao, arquivo));
  }

  console.log('Instalando dependências de produção ...');
  /*
   * No Windows o npm é um `.cmd`, que o Node se recusa a executar diretamente.
   * O `cmd.exe /c` resolve sem ligar a opção `shell`, que concatenaria os
   * argumentos em vez de passá-los separados.
   */
  const chamadaDoNpm = process.platform === 'win32' ? ['cmd.exe', ['/c', 'npm']] : ['npm', []];
  const [executavel, argumentosIniciais] = chamadaDoNpm;

  execFileSync(executavel, [...argumentosIniciais, 'ci', '--omit=dev', '--ignore-scripts'], {
    cwd: pastaDeInstalacao,
    stdio: 'inherit',
  });

  return caminhoDoNodeModules;
}

/** Copia o programa e as dependências para a pasta que virará o pacote. */
export async function copiarProgramaParaPasta(pastaDeDestino, caminhoDoNodeModules) {
  await rm(pastaDeDestino, { recursive: true, force: true });
  await mkdir(pastaDeDestino, { recursive: true });

  for (const item of ITENS_COPIADOS) {
    await cp(join(raizDoProjeto, item), join(pastaDeDestino, item), {
      recursive: true,
      /* Os testes moram ao lado do código que testam e não vão para a máquina do usuário. */
      filter: (caminho) => !caminho.endsWith('.test.ts'),
    });
  }

  await cp(caminhoDoNodeModules, join(pastaDeDestino, 'node_modules'), { recursive: true });
}

export async function lerVersaoDoProjeto() {
  const { version } = JSON.parse(await readFile(join(raizDoProjeto, 'package.json'), 'utf8'));
  return version;
}
