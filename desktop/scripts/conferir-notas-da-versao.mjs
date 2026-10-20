/**
 * Conferência da extração de notas do CHANGELOG (`src/notasDaVersao.ts`), que não tem
 * Electron e roda no Node. Usa o build: `npm run build && node scripts/conferir-notas-da-versao.mjs`.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { compararVersoes, notasEntre } = require('../dist/notasDaVersao.js');

assert.ok(compararVersoes('2.10.0', '2.9.9') > 0, 'compara número a número, não texto');
assert.equal(compararVersoes('2.16.1', '2.16.1'), 0);

const changelog = `# Changelog

## [Não publicado]

### Adicionado

- Ainda não saiu.

## [2.16.1] - 2026-10-20

### Corrigido

- **Baixar o log**: aparece uma notificação com o \`nome\` do
  arquivo; ver [docs](docs/x.md) e **Enviar
  por e-mail**.
  - subitem

## [2.16.0] - 2026-10-19

Versão de teste: um parágrafo
quebrado em duas linhas.

## [2.15.0] - 2026-10-18

- Fora do intervalo.

[2.16.1]: https://github.com/x/y/compare/v2.16.0...v2.16.1
`;

const notas = notasEntre(changelog, '2.15.0', '2.16.1');
assert.deepEqual(
  notas.map((n) => n.versao),
  ['2.16.1', '2.16.0'],
  'só as versões depois da vista até a atual; o [Não publicado] fica de fora',
);
assert.equal(
  notas[0].texto,
  'Corrigido:\n• Baixar o log: aparece uma notificação com o nome do arquivo; ver docs e Enviar por e-mail.\n  • subitem',
);
assert.equal(notas[1].texto, 'Versão de teste: um parágrafo quebrado em duas linhas.');
assert.deepEqual(notasEntre(changelog, '2.16.1', '2.16.1'), [], 'sem atualização, sem notas');

console.log('notas da versão: ok');
