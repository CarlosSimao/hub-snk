import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { DocxInvalidoError, textoDoDocx, textoDoXmlDoWord } from './textoDoDocx.ts';

/** ZIP mínimo, com uma entrada comprimida, do jeito que o Word grava. */
function zipCom(nome: string, conteudo: string): Buffer {
  const nomeEmBytes = Buffer.from(nome, 'utf8');
  const comprimido = deflateRawSync(Buffer.from(conteudo, 'utf8'));

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(comprimido.length, 18);
  local.writeUInt16LE(nomeEmBytes.length, 26);

  const diretorio = Buffer.alloc(46);
  diretorio.writeUInt32LE(0x02014b50, 0);
  diretorio.writeUInt16LE(8, 10);
  diretorio.writeUInt32LE(comprimido.length, 20);
  diretorio.writeUInt16LE(nomeEmBytes.length, 28);
  diretorio.writeUInt32LE(0, 42);

  const inicioDoDiretorio = local.length + nomeEmBytes.length + comprimido.length;
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(1, 10);
  fim.writeUInt32LE(diretorio.length + nomeEmBytes.length, 12);
  fim.writeUInt32LE(inicioDoDiretorio, 16);

  return Buffer.concat([local, nomeEmBytes, comprimido, diretorio, nomeEmBytes, fim]);
}

describe('textoDoDocx', () => {
  it('extrai parágrafos e células de tabela', () => {
    const xml =
      '<w:document><w:body>' +
      '<w:p><w:r><w:t>Escopo &amp; prazo</w:t></w:r></w:p>' +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Tela</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:p><w:r><w:t>Pedidos</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '</w:body></w:document>';

    const texto = textoDoDocx(zipCom('word/document.xml', xml));

    assert.match(texto, /^Escopo & prazo/);
    assert.match(texto, /Tela\s*\|\s*Pedidos/);
  });

  it('recusa arquivo que não é ZIP', () => {
    assert.throws(
      () => textoDoDocx(Buffer.from('texto qualquer, sem zip nenhum')),
      DocxInvalidoError,
    );
  });

  it('recusa ZIP sem o corpo do Word', () => {
    assert.throws(() => textoDoDocx(zipCom('outro.xml', '<x/>')), DocxInvalidoError);
  });
});

describe('textoDoXmlDoWord', () => {
  it('converte tabulação e quebra de linha', () => {
    assert.equal(
      textoDoXmlDoWord('<w:p><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t></w:p>'),
      'a\tb\nc',
    );
  });
});
