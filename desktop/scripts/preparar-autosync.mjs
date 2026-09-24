/**
 * Monta `desktop/build/git-autosync` — o que vai para `resources/git-autosync` dentro do
 * pacote, e o que a página de componentes do instalador usa quando o Git AutoSync é
 * marcado (Fase 4, §4.2 e §4.3 de docs/specs/sankhya-hub-sem-docker-plano.md).
 *
 * O Git AutoSync mora em outro repositório (`../scripts/git-autosync` por padrão,
 * ajustável por `GIT_AUTOSYNC_DIR`). Daqui saem cinco arquivos:
 *
 *   git-autosync.exe        interface, bandeja e CLI
 *   git-autosync-sync.exe   o que a tarefa agendada executa
 *   install-standalone.ps1  instalação silenciosa e idempotente — quem o NSIS chama
 *   SKILL.md                a skill, quando o usuário marcar a opção
 *   VERSION                 a versão, lida pelo `install-standalone.ps1` e gravada em
 *                           `~/.git-autosync/bin/VERSION`
 *
 * Os binários entram sempre (~40 MB): são inertes se ninguém os usar, e ter o pacote
 * dependendo de download na hora da instalação seria pior — a máquina de destino pode
 * estar sem acesso.
 *
 * O script RECUSA binário mais antigo que os fontes. Esse é o erro que o relatório da
 * análise registrou: os `.exe` distribuídos eram de uma versão anterior à do `VERSION`,
 * e ninguém percebeu porque nada verificava.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_DESKTOP = resolve(AQUI, '..');
const RAIZ_HUB = resolve(RAIZ_DESKTOP, '..');
const DESTINO = join(RAIZ_DESKTOP, 'build', 'git-autosync');

/**
 * Lido por `assets/installer.nsh` em tempo de compilação do instalador. É a chave que
 * liga a página de componentes: sem este arquivo, o NSIS não recebe a página, a chamada
 * da instalação nem a pergunta da desinstalação.
 */
const DEFINES_NSIS = join(RAIZ_DESKTOP, 'build', 'gas-version.nsh');

if (process.argv.includes('--sem-autosync')) {
  // A pasta continua existindo, vazia: o `extraResources` do electron-builder aponta
  // para ela, e uma origem inexistente derrubaria o empacotamento inteiro.
  rmSync(DESTINO, { recursive: true, force: true });
  mkdirSync(DESTINO, { recursive: true });
  rmSync(DEFINES_NSIS, { force: true });
  console.log('Pacote sem o Git AutoSync: nenhuma opção dele aparecerá no instalador.');
  process.exit(0);
}

const RAIZ_AUTOSYNC = resolve(
  process.env['GIT_AUTOSYNC_DIR'] ?? join(RAIZ_HUB, '..', 'scripts', 'git-autosync'),
);

const DIST = join(RAIZ_AUTOSYNC, 'python', 'dist');

/**
 * Os binários do PyInstaller têm nome por sistema, e o PyInstaller NÃO faz
 * cross-compile: o pacote Linux precisa ser montado numa máquina Linux, com os binários
 * gerados por `python/build_linux.sh` ali mesmo.
 */
const EH_WINDOWS = process.platform === 'win32';
const EXECUTAVEIS = EH_WINDOWS
  ? ['git-autosync.exe', 'git-autosync-sync.exe']
  : ['git-autosync', 'git-autosync-sync'];

function exigir(caminho, comoResolver) {
  if (!existsSync(caminho)) throw new Error(`faltando: ${caminho}\n  ${comoResolver}`);
  return caminho;
}

if (!existsSync(RAIZ_AUTOSYNC)) {
  throw new Error(
    `não achei o repositório do git-autosync em ${RAIZ_AUTOSYNC}.\n` +
      '  Aponte com GIT_AUTOSYNC_DIR=<caminho> ou rode `npm run empacotar:sem-autosync`.',
  );
}

/** Quem gera os binários — exige Python só na máquina que empacota, nunca no destino. */
const COMO_GERAR = EH_WINDOWS ? 'python\\build_windows.ps1' : 'python/build_linux.sh';

for (const nome of EXECUTAVEIS) {
  exigir(join(DIST, nome), `gere com: ${COMO_GERAR}`);
}

// Binário mais velho que fonte é binário de outra versão. Comparar data é grosseiro, e é
// exatamente o que faltava para não distribuir de novo um executável de agosto.
const fontes = readdirSync(join(RAIZ_AUTOSYNC, 'python'))
  .filter((nome) => nome.endsWith('.py'))
  .map((nome) => join(RAIZ_AUTOSYNC, 'python', nome));

for (const nome of EXECUTAVEIS) {
  const geradoEm = statSync(join(DIST, nome)).mtimeMs;
  const desatualizados = fontes.filter((fonte) => statSync(fonte).mtimeMs > geradoEm);
  if (desatualizados.length) {
    throw new Error(
      `${nome} é mais antigo que ${desatualizados.length} fonte(s) — o pacote sairia com uma versão velha.\n` +
        `  Regere com: ${join(RAIZ_AUTOSYNC, COMO_GERAR)}\n` +
        `  Mais novos: ${desatualizados.map((f) => f.replace(RAIZ_AUTOSYNC, '')).join(', ')}`,
    );
  }
}

console.log(`\nMontando ${DESTINO}`);
rmSync(DESTINO, { recursive: true, force: true });
mkdirSync(DESTINO, { recursive: true });

const arquivos = [
  ...EXECUTAVEIS.map((nome) => [join(DIST, nome), nome]),
  // O instalador silencioso é o do Windows; no Linux o script equivalente ainda é o
  // `installer/install_standalone.sh` interativo, então ele viaja no lugar.
  EH_WINDOWS
    ? [exigir(join(RAIZ_AUTOSYNC, 'installer', 'install-standalone.ps1'), 'esperado no repo do git-autosync'), 'install-standalone.ps1']
    : [exigir(join(RAIZ_AUTOSYNC, 'installer', 'install_standalone.sh'), 'esperado no repo do git-autosync'), 'install_standalone.sh'],
  [exigir(join(RAIZ_AUTOSYNC, 'skill', 'SKILL.md'), 'esperado no repo do git-autosync'), 'SKILL.md'],
  [exigir(join(RAIZ_AUTOSYNC, 'python', 'VERSION'), 'esperado no repo do git-autosync'), 'VERSION'],
];

// O NSIS chama o `powershell.exe` 5.1, que lê `.ps1` sem BOM como ANSI. Um `—` em UTF-8
// vira `â€”`, e o 0x94 do fim é `”`, que o PowerShell aceita como aspa: a string fecha no
// meio, o script inteiro não compila e o instalador culpa a falta do Git. Medido na 0.2.0.
for (const [origem, nome] of arquivos) {
  if (!nome.endsWith('.ps1')) continue;
  const bytes = readFileSync(origem);
  const temBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  if (!temBom && bytes.some((b) => b > 0x7f)) {
    throw new Error(
      `${origem} tem caractere fora do ASCII e não tem BOM — o powershell.exe 5.1 não o compila.\n` +
        '  Troque os acentos e travessões por ASCII (ou salve como UTF-8 com BOM).',
    );
  }
}

for (const [origem, nome] of arquivos) {
  cpSync(origem, join(DESTINO, nome));
  console.log(`  + ${nome}`);
}

const versao = readFileSync(join(DESTINO, 'VERSION'), 'utf8').trim();

writeFileSync(
  DEFINES_NSIS,
  ['; Gerado por scripts/preparar-autosync.mjs — não editar à mão.', '!define GAS_PRESENTE', `!define GAS_VERSION "${versao}"`, ''].join(
    '\n',
  ),
  'utf8',
);
console.log(`  + gas-version.nsh (${versao})`);

console.log(`\nGit AutoSync ${versao} pronto para empacotar (de ${RAIZ_AUTOSYNC}).`);
