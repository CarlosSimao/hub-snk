/**
 * Baixa o pacote do Git AutoSync da Release mais recente do repositório dele.
 *
 * O Git AutoSync não viaja mais dentro do instalador do HUB SNK: os dois produtos têm
 * licenças diferentes, e quem quer o autosync o instala pela aba Git, que chega aqui.
 * O pacote é o mesmo que o instalador levava: os dois executáveis, o
 * `install-standalone.ps1`, a skill e o `VERSION`.
 *
 * A Release pode trazê-lo de dois jeitos, e os dois valem:
 *
 *   1. um `git-autosync-windows.zip` com os cinco arquivos;
 *   2. só os dois `.exe` anexados. O resto vem do próprio repositório, na MESMA tag da
 *      Release — nunca da `main`, que pode já estar à frente dos executáveis.
 */
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitAutosyncFalhouError, PacoteDoAutosyncAusenteError } from './cliDoAutosync.ts';
import { executarProcesso } from './cliDoAutosyncProcesso.ts';

export const REPOSITORIO_DO_AUTOSYNC = 'FlavianoRS/git-autosync';
export const NOME_DO_PACOTE_DO_AUTOSYNC = 'git-autosync-windows.zip';

const URL_DA_ULTIMA_RELEASE = `https://api.github.com/repos/${REPOSITORIO_DO_AUTOSYNC}/releases/latest`;
const URL_DOS_ARQUIVOS_DO_REPOSITORIO = `https://raw.githubusercontent.com/${REPOSITORIO_DO_AUTOSYNC}`;
const ARQUIVO_DO_INSTALADOR = 'install-standalone.ps1';
const EXECUTAVEIS = ['git-autosync.exe', 'git-autosync-sync.exe'] as const;
/** Caminho no repositório → nome na pasta do pacote, onde o `install-standalone.ps1` procura. */
const ARQUIVOS_DE_APOIO = [
  ['installer/install-standalone.ps1', ARQUIVO_DO_INSTALADOR],
  ['skill/SKILL.md', 'SKILL.md'],
  ['python/VERSION', 'VERSION'],
] as const;
const TEMPO_LIMITE_DO_DOWNLOAD_MS = 180_000;
const TEMPO_LIMITE_DA_EXTRACAO_MS = 120_000;

interface AssetDaRelease {
  name?: string;
  browser_download_url?: string;
}

interface Release {
  tag_name?: string;
  assets?: AssetDaRelease[];
}

export interface PacoteBaixado {
  /** Pasta com o `install-standalone.ps1` e os executáveis. */
  pasta: string;
  versao: string | null;
  /** Apaga a pasta temporária. Chamar depois de instalar, deu certo ou não. */
  descartar: () => Promise<void>;
}

async function buscar(
  url: string,
  buscarUrl: typeof fetch,
  aceita = 'application/octet-stream',
): Promise<Response> {
  try {
    return await buscarUrl(url, {
      headers: { 'User-Agent': 'hub-snk', Accept: aceita },
      signal: AbortSignal.timeout(TEMPO_LIMITE_DO_DOWNLOAD_MS),
    });
  } catch (erro) {
    throw new GitAutosyncFalhouError(
      `Não foi possível falar com o GitHub (${(erro as Error).message}). Confira a conexão com a internet.`,
    );
  }
}

async function baixarPara(url: string, destino: string, buscarUrl: typeof fetch): Promise<void> {
  const resposta = await buscar(url, buscarUrl);
  if (!resposta.ok) {
    throw new GitAutosyncFalhouError(`O GitHub respondeu ${resposta.status} ao baixar ${url}.`);
  }
  await writeFile(destino, Buffer.from(await resposta.arrayBuffer()));
}

/** O `.zip` pode trazer os arquivos na raiz ou dentro de uma pasta só. */
function acharPastaDoInstalador(raiz: string): string | null {
  if (existsSync(join(raiz, ARQUIVO_DO_INSTALADOR))) {
    return raiz;
  }
  for (const entrada of readdirSync(raiz, { withFileTypes: true })) {
    if (entrada.isDirectory() && existsSync(join(raiz, entrada.name, ARQUIVO_DO_INSTALADOR))) {
      return join(raiz, entrada.name);
    }
  }
  return null;
}

async function extrairZip(
  zip: AssetDaRelease & { browser_download_url: string },
  temporaria: string,
  buscarUrl: typeof fetch,
): Promise<string> {
  const arquivo = join(temporaria, NOME_DO_PACOTE_DO_AUTOSYNC);
  const destino = join(temporaria, 'pacote');
  await baixarPara(zip.browser_download_url, arquivo, buscarUrl);

  /* Caminhos pelo ambiente, nunca interpolados no comando do PowerShell. */
  const extracao = await executarProcesso(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Expand-Archive -LiteralPath $env:HUB_GAS_ZIP -DestinationPath $env:HUB_GAS_DESTINO -Force',
    ],
    TEMPO_LIMITE_DA_EXTRACAO_MS,
    { ...process.env, HUB_GAS_ZIP: arquivo, HUB_GAS_DESTINO: destino },
  );
  if (extracao.codigo !== 0) {
    throw new GitAutosyncFalhouError(
      `Não foi possível extrair o ${NOME_DO_PACOTE_DO_AUTOSYNC}.\n\n${extracao.saida.trim()}`,
    );
  }

  const pasta = acharPastaDoInstalador(destino);
  if (!pasta) {
    throw new PacoteDoAutosyncAusenteError(
      `O ${NOME_DO_PACOTE_DO_AUTOSYNC} da Release não tem o ${ARQUIVO_DO_INSTALADOR}.`,
    );
  }
  return pasta;
}

async function montarDosExecutaveis(
  assets: AssetDaRelease[],
  tag: string,
  temporaria: string,
  buscarUrl: typeof fetch,
): Promise<string> {
  const pasta = join(temporaria, 'pacote');
  await mkdir(pasta, { recursive: true });

  for (const nome of EXECUTAVEIS) {
    const asset = assets.find((item) => item.name === nome);
    if (!asset?.browser_download_url) {
      throw new PacoteDoAutosyncAusenteError(
        `A Release ${tag} do Git AutoSync não tem o ${nome} nem o ${NOME_DO_PACOTE_DO_AUTOSYNC}.`,
      );
    }
    await baixarPara(asset.browser_download_url, join(pasta, nome), buscarUrl);
  }

  for (const [noRepositorio, nome] of ARQUIVOS_DE_APOIO) {
    const url = `${URL_DOS_ARQUIVOS_DO_REPOSITORIO}/${encodeURIComponent(tag)}/${noRepositorio}`;
    const resposta = await buscar(url, buscarUrl, 'text/plain');
    if (resposta.status === 404) {
      throw new PacoteDoAutosyncAusenteError(
        `A tag ${tag} do Git AutoSync não tem o ${noRepositorio}, que a instalação precisa.`,
      );
    }
    if (!resposta.ok) {
      throw new GitAutosyncFalhouError(`O GitHub respondeu ${resposta.status} ao baixar ${url}.`);
    }
    await writeFile(join(pasta, nome), Buffer.from(await resposta.arrayBuffer()));
  }

  return pasta;
}

export async function baixarPacoteDoAutosync(
  buscarUrl: typeof fetch = fetch,
): Promise<PacoteBaixado> {
  const respostaDaRelease = await buscar(
    URL_DA_ULTIMA_RELEASE,
    buscarUrl,
    'application/vnd.github+json',
  );
  if (respostaDaRelease.status === 404) {
    throw new PacoteDoAutosyncAusenteError(
      `O repositório ${REPOSITORIO_DO_AUTOSYNC} ainda não tem Release publicada.`,
    );
  }
  if (!respostaDaRelease.ok) {
    throw new GitAutosyncFalhouError(
      `O GitHub respondeu ${respostaDaRelease.status} ao procurar a Release do Git AutoSync.`,
    );
  }

  const release = (await respostaDaRelease.json()) as Release;
  const tag = release.tag_name;
  if (!tag) {
    throw new GitAutosyncFalhouError('A Release do Git AutoSync veio sem tag.');
  }
  const assets = release.assets ?? [];
  const zip = assets.find((item) => item.name === NOME_DO_PACOTE_DO_AUTOSYNC);

  const temporaria = await mkdtemp(join(tmpdir(), 'hub-snk-git-autosync-'));
  const descartar = () => rm(temporaria, { recursive: true, force: true });
  try {
    const pasta = zip?.browser_download_url
      ? await extrairZip(
          { ...zip, browser_download_url: zip.browser_download_url },
          temporaria,
          buscarUrl,
        )
      : await montarDosExecutaveis(assets, tag, temporaria, buscarUrl);
    return { pasta, versao: tag, descartar };
  } catch (erro) {
    await descartar();
    throw erro;
  }
}
