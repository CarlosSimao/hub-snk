import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { criarZip, lerZip, ZipInvalidoError } from './zip.ts';

const AGORA = new Date(2026, 9, 7, 14, 30, 0);

function entrada(nome: string, dados: Buffer | string) {
  return { nome, dados: Buffer.from(dados), modificadoEm: AGORA };
}

describe('criarZip e lerZip', () => {
  it('devolve os mesmos arquivos, com nome acentuado e em subpasta', () => {
    const zip = criarZip([
      entrada('clientes.json', '{"clientes":[]}'),
      entrada('kanbans/abc/1-Escopo da integração.pdf', 'conteúdo do pdf'),
    ]);

    const entradas = lerZip(zip);

    assert.deepEqual(
      entradas.map((item) => item.nome),
      ['clientes.json', 'kanbans/abc/1-Escopo da integração.pdf'],
    );
    assert.equal(entradas[0]?.extrair().toString('utf8'), '{"clientes":[]}');
    assert.equal(entradas[1]?.extrair().toString('utf8'), 'conteúdo do pdf');
  });

  it('comprime o que é repetitivo e guarda como está o que não comprime', () => {
    const repetitivo = Buffer.alloc(50_000, 'a');
    const aleatorio = randomBytes(50_000);

    const zip = criarZip([entrada('texto.txt', repetitivo), entrada('binario.bin', aleatorio)]);

    assert.ok(zip.length < repetitivo.length + aleatorio.length);
    const [texto, binario] = lerZip(zip);
    assert.ok(texto?.extrair().equals(repetitivo));
    assert.ok(binario?.extrair().equals(aleatorio));
  });

  it('aceita arquivo vazio e zip sem arquivo nenhum', () => {
    assert.equal(lerZip(criarZip([entrada('vazio.json', '')]))[0]?.extrair().length, 0);
    assert.deepEqual(lerZip(criarZip([])), []);
  });

  it('recusa o que não é zip', () => {
    assert.throws(() => lerZip(Buffer.from('isto não é um zip')), ZipInvalidoError);
    assert.throws(() => lerZip(Buffer.alloc(0)), ZipInvalidoError);
  });

  it('acusa o conteúdo corrompido na extração', () => {
    const zip = criarZip([entrada('dados.bin', randomBytes(2_000))]);
    // No meio do conteúdo, que vai sem compressão: o CRC deixa de bater.
    zip[100] = (zip[100] ?? 0) ^ 0xff;

    const [corrompida] = lerZip(zip);

    assert.throws(() => corrompida?.extrair(), /corrompido/);
  });
});
