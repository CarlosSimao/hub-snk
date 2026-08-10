/**
 * Gera os pacotes do Linux e do macOS.
 *
 * Mesma ideia do pacote do Windows: o pacote leva o programa e as dependências
 * já instaladas, e o Node é pré-requisito da máquina de destino.
 *
 * O formato é `.tar.gz`, e não `.zip`, porque o `tar` preserva o bit de
 * execução dos scripts — num zip ele se perde, e o `./hub-snk.sh` chegaria sem
 * permissão para rodar.
 *
 * Uso: npm run empacotar-unix
 */
import { execFileSync } from 'node:child_process';
import { chmod, cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  copiarProgramaParaPasta,
  instalarDependenciasDeProducao,
  lerVersaoDoProjeto,
  raizDoProjeto,
} from './empacotar-comum.mjs';

/*
 * As dependências são todas JavaScript puro, sem binário compilado, e o Node
 * agora vem da máquina: o mesmo conteúdo serve para as três plataformas. Os
 * pacotes continuam separados porque é assim que o usuário os procura na página
 * de releases.
 */
const PLATAFORMAS = ['linux-x64', 'macos-x64', 'macos-arm64'];

/** O launcher e os dois scripts de instalação precisam sair executáveis. */
const SCRIPTS_DO_PACOTE = ['hub-snk.sh', 'instalar-hub-snk.sh', 'desinstalar-hub-snk.sh'];

const PERMISSAO_DE_EXECUCAO = 0o755;
const pastaDeSaida = join(raizDoProjeto, 'dist');

async function montarPacote(plataforma, versao, caminhoDoNodeModules) {
  const nomeDoPacote = `hub-snk-${versao}-${plataforma}`;
  const pastaDoPacote = join(pastaDeSaida, nomeDoPacote);

  await copiarProgramaParaPasta(pastaDoPacote, caminhoDoNodeModules);
  await cp(join(raizDoProjeto, 'LICENSE'), join(pastaDoPacote, 'LICENSE'));
  await cp(join(raizDoProjeto, 'README.md'), join(pastaDoPacote, 'README.md'));

  for (const script of SCRIPTS_DO_PACOTE) {
    await cp(join(raizDoProjeto, 'instalador', script), join(pastaDoPacote, script));
    await chmod(join(pastaDoPacote, script), PERMISSAO_DE_EXECUCAO);
  }

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
