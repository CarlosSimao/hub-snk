/**
 * Monta o pacote do Windows.
 *
 * O pacote leva o programa e as dependências já instaladas; o Node é
 * pré-requisito da máquina de destino, declarado no README. Embutir o binário
 * dobrava o tamanho do download e obrigava a acompanhar as versões do Node de
 * fora do ciclo do projeto.
 *
 * A instalação é feita pelo `instalar-hub-snk.bat` que vai dentro do pacote,
 * mas não é obrigatória: `node src\index.ts` da pasta descompactada já sobe o
 * HUB SNK e abre a janela.
 *
 * Uso: npm run empacotar-windows
 */
import { execFileSync } from 'node:child_process';
import { cp, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  copiarProgramaParaPasta,
  instalarDependenciasDeProducao,
  lerVersaoDoProjeto,
  raizDoProjeto,
} from './empacotar-comum.mjs';

const ARQUIVOS_DO_INSTALADOR = [
  'abrir-hub-snk.vbs',
  'encerrar-hub-snk.vbs',
  'instalar-hub-snk.bat',
  'instalar-hub-snk.ps1',
  'desinstalar-hub-snk.bat',
  'desinstalar-hub-snk.ps1',
  'hub-snk.ico',
];

const pastaDeSaida = join(raizDoProjeto, 'dist');

/*
 * Zip, e não tar.gz: no Windows o duplo clique abre o zip no próprio Explorer.
 * O bit de execução, que obrigou os pacotes Unix a usarem tar, não existe aqui.
 *
 * Quem grava zip é o bsdtar que vem no Windows, chamado pelo caminho completo:
 * o `tar` do PATH pode ser o GNU tar do Git Bash, que aceita o `-a`, ignora a
 * extensão e entrega um tar puro com nome de zip — arquivo que o Explorer não
 * abre. A conferência logo abaixo existe porque esse erro passou despercebido
 * uma vez.
 */
function compactar(nomeDoPacote) {
  const bsdtar =
    process.platform === 'win32'
      ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
      : 'tar';

  execFileSync(bsdtar, ['-a', '-c', '-f', `${nomeDoPacote}.zip`, nomeDoPacote], {
    cwd: pastaDeSaida,
    stdio: 'inherit',
  });
}

/* Todo zip começa com "PK". Sem isso, o que saiu não é um zip. */
async function conferirAssinaturaDoZip(caminho) {
  const arquivo = await open(caminho);

  try {
    const inicio = Buffer.alloc(2);
    await arquivo.read(inicio, 0, 2, 0);

    if (inicio.toString('latin1') !== 'PK') {
      throw new Error(
        `${caminho} não é um zip: o compactador usado ignorou a extensão. ` +
          'Confira se o bsdtar do Windows está em System32.',
      );
    }
  } finally {
    await arquivo.close();
  }
}

const versao = await lerVersaoDoProjeto();
const nomeDoPacote = `hub-snk-${versao}-windows-x64`;
const pastaDoPacote = join(pastaDeSaida, nomeDoPacote);

const caminhoDoNodeModules = await instalarDependenciasDeProducao();

await copiarProgramaParaPasta(pastaDoPacote, caminhoDoNodeModules);

for (const arquivo of ARQUIVOS_DO_INSTALADOR) {
  await cp(join(raizDoProjeto, 'instalador', arquivo), join(pastaDoPacote, arquivo));
}

await cp(join(raizDoProjeto, 'LICENSE'), join(pastaDoPacote, 'LICENSE.txt'));
await cp(join(raizDoProjeto, 'README.md'), join(pastaDoPacote, 'README.md'));

compactar(nomeDoPacote);

const caminhoDoZip = join(pastaDeSaida, `${nomeDoPacote}.zip`);
await conferirAssinaturaDoZip(caminhoDoZip);
await rm(pastaDoPacote, { recursive: true, force: true });

console.log(`\ngerado: ${caminhoDoZip}`);
