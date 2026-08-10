/**
 * Monta o pacote do Windows.
 *
 * O resultado é autossuficiente: leva o próprio `node.exe` e as dependências já
 * instaladas, para que a máquina de destino não precise de Node, de npm nem de
 * rede. É o que separa "descompactar e usar" de "primeiro instale o Node, depois
 * confira a versão, depois rode npm install".
 *
 * A instalação em si é feita pelo `instalar-hub-snk.bat` que vai dentro do
 * pacote. Não há mais executável de instalação: um `.exe` sem assinatura é
 * barrado pelo Controle Inteligente de Aplicativos do Windows, e assinar exige
 * certificado pago.
 *
 * Uso: npm run empacotar-windows
 */
import { execFileSync } from 'node:child_process';
import { cp, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  baixarComCache,
  copiarProgramaParaPasta,
  instalarDependenciasDeProducao,
  lerVersaoDoProjeto,
  pastaDoCache,
  raizDoProjeto,
  VERSAO_DO_NODE_EMBUTIDO,
} from './empacotar-comum.mjs';

const ARQUITETURA = 'win-x64';

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
 * O node.exe é publicado avulso, sem compactação em volta — dá para gravar a
 * resposta direto, sem precisar de um descompactador.
 */
async function obterNodeEmbutido() {
  return baixarComCache(
    `https://nodejs.org/dist/${VERSAO_DO_NODE_EMBUTIDO}/${ARQUITETURA}/node.exe`,
    join(pastaDoCache, `node-${VERSAO_DO_NODE_EMBUTIDO}-${ARQUITETURA}.exe`),
  );
}

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

const caminhoDoNode = await obterNodeEmbutido();
const caminhoDoNodeModules = await instalarDependenciasDeProducao();

await copiarProgramaParaPasta(pastaDoPacote, caminhoDoNodeModules);

for (const arquivo of ARQUIVOS_DO_INSTALADOR) {
  await cp(join(raizDoProjeto, 'instalador', arquivo), join(pastaDoPacote, arquivo));
}

await cp(caminhoDoNode, join(pastaDoPacote, 'node.exe'));
await cp(join(raizDoProjeto, 'LICENSE'), join(pastaDoPacote, 'LICENSE.txt'));
await cp(join(raizDoProjeto, 'README.md'), join(pastaDoPacote, 'README.md'));

compactar(nomeDoPacote);

const caminhoDoZip = join(pastaDeSaida, `${nomeDoPacote}.zip`);
await conferirAssinaturaDoZip(caminhoDoZip);
await rm(pastaDoPacote, { recursive: true, force: true });

console.log(`\ngerado: ${caminhoDoZip}`);
