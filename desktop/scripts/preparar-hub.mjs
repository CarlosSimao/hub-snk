/**
 * Monta `desktop/build/hub` — o backend do jeito que ele vai para dentro do pacote, em
 * `resources/hub` (ver `electron-builder.yml`).
 *
 * Por que uma pasta intermediária em vez de mandar o electron-builder empacotar o repo:
 * o `node_modules` da raiz tem as dependências de desenvolvimento (TypeScript, Prettier,
 * tipos), que não são usadas em runtime. Aqui o `npm ci --omit=dev` monta uma árvore só
 * com o que o Fastify precisa para subir.
 *
 * Não há build: o backend roda direto do TypeScript no Node embutido no Electron, e o
 * painel é JavaScript puro. O que entra, e nada além disso:
 *
 *   src/           backend, sem os testes
 *   public/        painel, sem os testes
 *   package.json   o `"type": "module"` daqui é o que faz o Node tratar o `src/` como ESM
 *   package-lock.json
 *   LICENSE
 *   node_modules/  só produção
 *
 * O `dados-hub-snk/` do repositório NÃO entra: o cadastro do usuário vive fora da pasta
 * de instalação (ver `DIRETORIO_DE_DADOS` em `desktop/src/config.ts`).
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_DESKTOP = resolve(AQUI, '..');
const RAIZ_HUB = resolve(RAIZ_DESKTOP, '..');
const DESTINO = join(RAIZ_DESKTOP, 'build', 'hub');

const ITENS_DO_BACKEND = ['src', 'public', 'package.json', 'package-lock.json', 'LICENSE'];

/** `npm` no Windows é `npm.cmd`; sem isto o spawn não acha o executável. */
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** Teste é código de desenvolvimento: não roda no produto e só aumentaria o pacote. */
function ehTeste(caminho) {
  return /\.test\.(ts|js)$/.test(basename(caminho));
}

/**
 * O `npm` é um script (`npm.cmd` no Windows), então precisa de shell — o Node se recusa
 * a executar `.cmd` direto. Comando como string, e não array com `shell: true`, porque
 * essa combinação é o que o Node deprecou (DEP0190): concatenação sem escape. Tudo aqui
 * é literal deste arquivo; nenhum valor vem de fora.
 */
function rodar(comando, cwd) {
  console.log(`> ${comando}  (${cwd})`);
  execSync(comando, { cwd, stdio: 'inherit' });
}

function copiar(relativo) {
  const origem = join(RAIZ_HUB, relativo);
  if (!existsSync(origem)) throw new Error(`faltando: ${origem}`);
  cpSync(origem, join(DESTINO, relativo), { recursive: true, filter: (item) => !ehTeste(item) });
  console.log(`  + ${relativo}`);
}

console.log(`\nMontando ${DESTINO}`);
rmSync(DESTINO, { recursive: true, force: true });
mkdirSync(DESTINO, { recursive: true });

for (const item of ITENS_DO_BACKEND) {
  copiar(item);
}

// `--omit=dev` é o ponto do exercício: deixa TypeScript, Prettier e tipos de fora.
// Script de instalação não deve rodar durante o empacotamento — nenhuma dependência de
// produção precisa compilar nada. Do npm 12 em diante isso já é o padrão
// (`allowScripts`), e passar `--ignore-scripts` junto de um `allow-scripts` configurado
// no `.npmrc` do usuário faz o npm recusar o comando inteiro — por isso a flag só entra
// nas versões antigas.
const majorNpm = Number(execSync(`${NPM} --version`).toString().trim().split('.')[0]);
const ignorarScripts = !Number.isFinite(majorNpm) || majorNpm < 12 ? ' --ignore-scripts' : '';
rodar(`${NPM} ci --omit=dev${ignorarScripts}`, DESTINO);

const entrypoint = join(DESTINO, 'src', 'index.ts');
if (!existsSync(entrypoint)) throw new Error(`o backend não foi copiado: ${entrypoint} não existe`);
if (!statSync(join(DESTINO, 'node_modules')).isDirectory())
  throw new Error('node_modules não foi instalado');

console.log(`\nPronto. Empacote com: npm run empacotar`);
