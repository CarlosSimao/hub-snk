/**
 * Gera os pacotes do Linux e do macOS.
 *
 * Mesma ideia do pacote do Windows: o pacote leva o próprio Node e as
 * dependências instaladas, para que baixar e descompactar já seja suficiente.
 *
 * O formato é `.tar.gz`, e não `.zip`, porque o `tar` preserva o bit de
 * execução do binário do Node — num zip ele se perde, e o pacote chegaria
 * quebrado do outro lado.
 *
 * Uso: npm run empacotar-unix
 */
import { execFileSync } from 'node:child_process';
import { chmod, cp, mkdir, rm } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import {
  baixarComCache,
  copiarProgramaParaPasta,
  instalarDependenciasDeProducao,
  lerVersaoDoProjeto,
  pastaDoCache,
  raizDoProjeto,
  VERSAO_DO_NODE_EMBUTIDO,
} from './empacotar-comum.mjs';

/*
 * O nome no nodejs.org fala em `darwin`; o nome do pacote fala em `macos`,
 * que é o que o usuário reconhece.
 */
const PLATAFORMAS = [
  { nomeNoPacote: 'linux-x64', nomeNoNode: 'linux-x64' },
  { nomeNoPacote: 'macos-x64', nomeNoNode: 'darwin-x64' },
  { nomeNoPacote: 'macos-arm64', nomeNoNode: 'darwin-arm64' },
];

/* O launcher e os dois scripts de instalação precisam sair executáveis. */
const SCRIPTS_DO_PACOTE = ['hub-snk.sh', 'instalar-hub-snk.sh', 'desinstalar-hub-snk.sh'];

const PERMISSAO_DE_EXECUCAO = 0o755;
const pastaDeSaida = join(raizDoProjeto, 'dist');

/*
 * O `tar` do Git Bash entende `C:\...` como endereço de máquina remota — o
 * dois-pontos é a sintaxe de host. Caminho relativo não tem esse problema e
 * funciona igual no Linux do GitHub Actions.
 */
function caminhoRelativoParaOTar(de, para) {
  return relative(de, para).split(sep).join('/');
}

/*
 * O tarball do Node traz a distribuição inteira — npm, cabeçalhos, documentação.
 * Só o binário interessa, e o `--strip-components` o deposita direto na pasta
 * de destino, sem os dois níveis do caminho de origem.
 */
async function extrairBinarioDoNode({ nomeNoNode }, pastaDeDestino) {
  const nomeDaDistribuicao = `node-${VERSAO_DO_NODE_EMBUTIDO}-${nomeNoNode}`;
  const caminhoDoTarball = await baixarComCache(
    `https://nodejs.org/dist/${VERSAO_DO_NODE_EMBUTIDO}/${nomeDaDistribuicao}.tar.gz`,
    join(pastaDoCache, `${nomeDaDistribuicao}.tar.gz`),
  );

  execFileSync(
    'tar',
    [
      '-xzf',
      caminhoRelativoParaOTar(pastaDeDestino, caminhoDoTarball),
      '--strip-components=2',
      `${nomeDaDistribuicao}/bin/node`,
    ],
    { cwd: pastaDeDestino, stdio: 'inherit' },
  );

  await chmod(join(pastaDeDestino, 'node'), PERMISSAO_DE_EXECUCAO);
}

async function montarPacote(plataforma, versao, caminhoDoNodeModules) {
  const nomeDoPacote = `hub-snk-${versao}-${plataforma.nomeNoPacote}`;
  const pastaDoPacote = join(pastaDeSaida, nomeDoPacote);

  await copiarProgramaParaPasta(pastaDoPacote, caminhoDoNodeModules);
  await cp(join(raizDoProjeto, 'LICENSE'), join(pastaDoPacote, 'LICENSE'));
  await cp(join(raizDoProjeto, 'README.md'), join(pastaDoPacote, 'README.md'));

  for (const script of SCRIPTS_DO_PACOTE) {
    await cp(join(raizDoProjeto, 'instalador', script), join(pastaDoPacote, script));
    await chmod(join(pastaDoPacote, script), PERMISSAO_DE_EXECUCAO);
  }

  await extrairBinarioDoNode(plataforma, pastaDoPacote);

  /* A pasta entra no tar pelo nome, para descompactar já organizado. */
  execFileSync('tar', ['-czf', `${nomeDoPacote}.tar.gz`, nomeDoPacote], {
    cwd: pastaDeSaida,
    stdio: 'inherit',
  });

  await rm(pastaDoPacote, { recursive: true, force: true });

  return `${nomeDoPacote}.tar.gz`;
}

const versao = await lerVersaoDoProjeto();
const caminhoDoNodeModules = await instalarDependenciasDeProducao();

await mkdir(pastaDeSaida, { recursive: true });

for (const plataforma of PLATAFORMAS) {
  const arquivo = await montarPacote(plataforma, versao, caminhoDoNodeModules);
  console.log(`gerado: ${join(pastaDeSaida, arquivo)}`);
}

if (process.platform === 'win32') {
  console.log(
    '\nAviso: pacotes gerados no Windows podem perder as permissões de execução. ' +
      'Os pacotes publicados saem do GitHub Actions, no Linux.',
  );
}
