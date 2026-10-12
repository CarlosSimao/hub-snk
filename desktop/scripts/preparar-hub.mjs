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
 *   credencial-google.json   a credencial OAuth do Google Drive (veja `gravarCredencialDoGoogle`)
 *   node_modules/  só produção
 *
 * O `dados-hub-snk/` do repositório NÃO entra: o cadastro do usuário vive fora da pasta
 * de instalação (ver `DIRETORIO_DE_DADOS` em `desktop/src/config.ts`).
 */
import { execSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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

const ARQUIVO_DA_CREDENCIAL = 'credencial-google.json';

/**
 * A credencial OAuth do Google Drive não está no repositório, que é público: ela entra no
 * pacote aqui. De onde vem, nesta ordem:
 *
 *   1. as variáveis `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` (os secrets do GitHub, no CI);
 *   2. o `credencial-google.json` da raiz do repositório, que o `.gitignore` ignora (a
 *      máquina de quem desenvolve).
 *
 * Sem nenhuma das duas o instalador sai sem a integração com o Drive, e a tela de Backup
 * diz isso. Com `HUB_EXIGIR_CREDENCIAL_GOOGLE=1` (as tags de versão no CI) a falta vira
 * erro: um instalador publicado sem Drive por esquecimento de um secret não passa batido.
 */
function gravarCredencialDoGoogle() {
  const destino = join(DESTINO, ARQUIVO_DA_CREDENCIAL);
  const id = process.env.GOOGLE_CLIENT_ID?.trim() ?? '';
  const chave = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? '';

  if (id && chave) {
    writeFileSync(destino, JSON.stringify({ clientId: id, clientSecret: chave }, null, 2));
    console.log(`  + ${ARQUIVO_DA_CREDENCIAL} (das variáveis de ambiente)`);
    return;
  }

  const local = join(RAIZ_HUB, ARQUIVO_DA_CREDENCIAL);
  if (existsSync(local)) {
    const dados = JSON.parse(readFileSync(local, 'utf8'));
    if (typeof dados.clientId === 'string' && typeof dados.clientSecret === 'string') {
      writeFileSync(destino, JSON.stringify(dados, null, 2));
      console.log(`  + ${ARQUIVO_DA_CREDENCIAL} (de ${local})`);
      return;
    }
  }

  const aviso =
    'sem a credencial do Google: defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET, ou crie o credencial-google.json na raiz do repositório';
  if (process.env.HUB_EXIGIR_CREDENCIAL_GOOGLE === '1') throw new Error(aviso);
  console.warn(`  ! ${aviso}. O instalador sai sem a integração com o Google Drive.`);
}

console.log(`\nMontando ${DESTINO}`);
rmSync(DESTINO, { recursive: true, force: true });
mkdirSync(DESTINO, { recursive: true });

for (const item of ITENS_DO_BACKEND) {
  copiar(item);
}

gravarCredencialDoGoogle();

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
