/**
 * Monta `desktop/build/hub` — o backend do jeito que ele vai para dentro do pacote, em
 * `resources/hub` (Fase 4 de docs/specs/sankhya-hub-sem-docker-plano.md).
 *
 * Por que uma pasta intermediária em vez de mandar o electron-builder empacotar o repo:
 * o `node_modules` da raiz tem as dependências de desenvolvimento (TypeScript, Vite,
 * React, tipos), que somam mais do que o produto e não são usadas em runtime. Aqui o
 * `npm ci --omit=dev` monta uma árvore só com o que o Fastify precisa para subir.
 *
 * O que entra, e nada além disso:
 *
 *   dist/          backend compilado (o `main` que o shell executa)
 *   public/        painel React, já buildado pelo Vite — o Fastify serve como estático
 *   config/        `services.yaml` de fábrica; no primeiro boot ele é COPIADO para a
 *                  pasta do usuário e nunca mais lido daqui (ver desktop/src/primeiroBoot.ts)
 *   package.json   o `"type": "module"` daqui é o que faz o Node tratar o dist/ como ESM
 *   package-lock.json
 *   node_modules/  só produção
 *
 * O `data/` do repositório NÃO entra: histórico, clientes e cofre do usuário vivem em
 * `userData`, fora de `Program Files`.
 *
 * Uso:
 *   node scripts/preparar-hub.mjs            # compila o backend e o painel antes
 *   node scripts/preparar-hub.mjs --sem-build
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_DESKTOP = resolve(AQUI, '..');
const RAIZ_HUB = resolve(RAIZ_DESKTOP, '..');
const DESTINO = join(RAIZ_DESKTOP, 'build', 'hub');

/** `npm` no Windows é `npm.cmd`; sem isto o spawn não acha o executável. */
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const semBuild = process.argv.includes('--sem-build');

/**
 * O `npm` é um script (`npm.cmd` no Windows), então precisa de shell — o Node se recusa
 * a executar `.cmd` direto. Comando como string, e não array com `shell: true`, porque
 * essa combinação é o que o Node deprecou (DEP0190): concatenação sem escape. Tudo aqui
 * é literal deste arquivo; nenhum valor vem de fora.
 */
function rodar(comando, cwd) {
  console.log(`> ${comando}  (${cwd})`);
  execSync(comando, { cwd, stdio: 'inherit', env: ambienteSemAllowScripts() });
}

/**
 * Chamado por `npm run empacotar`, este script herda do npm pai a config do `.npmrc` do
 * usuário como variável `npm_config_allow_scripts`. O npm 12 lê essa variável no filho
 * como se fosse `--allow-scripts` e recusa o `npm ci` do projeto (EALLOWSCRIPTS). Rodar
 * `node scripts/preparar-hub.mjs` direto não passa por isso — por isso só quebrava pelo
 * `npm run`. O `.npmrc` continua valendo: o filho o relê sozinho.
 */
function ambienteSemAllowScripts() {
  const env = { ...process.env };
  for (const chave of Object.keys(env)) {
    if (/^npm_config_allow[-_]scripts$/i.test(chave)) delete env[chave];
  }
  return env;
}

function copiar(relativo) {
  const origem = join(RAIZ_HUB, relativo);
  if (!existsSync(origem)) throw new Error(`faltando: ${origem} — rode o build antes`);
  cpSync(origem, join(DESTINO, relativo), { recursive: true });
  console.log(`  + ${relativo}`);
}

if (!semBuild) {
  // `npm run build` na raiz = tsc (dist/) + vite build (public/).
  rodar(`${NPM} run build`, RAIZ_HUB);
}

console.log(`\nMontando ${DESTINO}`);
rmSync(DESTINO, { recursive: true, force: true });
mkdirSync(DESTINO, { recursive: true });

for (const item of ['dist', 'public', 'config', 'package.json', 'package-lock.json']) {
  copiar(item);
}

// `--omit=dev` é o ponto do exercício: é o que deixa TypeScript, Vite, React e tipos de
// fora. Script de instalação não deve rodar durante o empacotamento — nenhuma
// dependência de produção precisa compilar nada (o `oracledb` 7 sobe em Thin mode,
// JavaScript puro). Do npm 12 em diante isso já é o padrão (`allowScripts`), e passar
// `--ignore-scripts` junto de um `allow-scripts` configurado no `.npmrc` do usuário faz
// o npm recusar o comando inteiro — por isso a flag só entra nas versões antigas.
const majorNpm = Number(execSync(`${NPM} --version`).toString().trim().split('.')[0]);
const ignorarScripts = !Number.isFinite(majorNpm) || majorNpm < 12 ? ' --ignore-scripts' : '';
rodar(`${NPM} ci --omit=dev${ignorarScripts}`, DESTINO);

const entrypoint = join(DESTINO, 'dist', 'index.js');
if (!existsSync(entrypoint)) throw new Error(`o backend não foi compilado: ${entrypoint} não existe`);
if (!statSync(join(DESTINO, 'node_modules')).isDirectory()) throw new Error('node_modules não foi instalado');

console.log(`\nPronto. Empacote com: npm run empacotar`);
