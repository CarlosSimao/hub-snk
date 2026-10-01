import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deflateSync } from 'node:zlib';
import { PdfIlegivelError, textoDoPdf } from './textoDoPdf.ts';

interface Objeto {
  dicionario: string;
  fluxo?: Buffer;
}

/** Monta um PDF com os objetos numerados a partir de 1, na ordem dada. */
function montarPdf(objetos: Objeto[], trailer = '<< /Root 1 0 R >>'): Buffer {
  const partes: Buffer[] = [Buffer.from('%PDF-1.7\n', 'latin1')];
  objetos.forEach((objeto, posicao) => {
    partes.push(Buffer.from(`${posicao + 1} 0 obj\n${objeto.dicionario}\n`, 'latin1'));
    if (objeto.fluxo) {
      partes.push(Buffer.from('stream\n', 'latin1'), objeto.fluxo, Buffer.from('\nendstream\n'));
    }
    partes.push(Buffer.from('endobj\n', 'latin1'));
  });
  partes.push(Buffer.from(`trailer\n${trailer}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(partes);
}

function paginaSimples(conteudo: Buffer, filtro = ''): Objeto[] {
  return [
    { dicionario: '<< /Type /Catalog /Pages 2 0 R >>' },
    { dicionario: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    {
      dicionario:
        '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    },
    { dicionario: `<< /Length ${conteudo.length}${filtro} >>`, fluxo: conteudo },
    {
      dicionario:
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FirstChar 32 /LastChar 126 >>',
    },
  ];
}

describe('textoDoPdf', () => {
  it('lê texto simples, com linhas e espaços do TJ', () => {
    const conteudo = Buffer.from(
      'BT /F1 12 Tf 72 720 Td (Ol\\341) Tj [( mun) -20 (do)] TJ 0 -14 Td [(Segunda) -300 (linha)] TJ ET',
      'latin1',
    );

    assert.equal(textoDoPdf(montarPdf(paginaSimples(conteudo))), 'Olá mundo\nSegunda linha');
  });

  it('descomprime o FlateDecode', () => {
    const conteudo = deflateSync(Buffer.from('BT /F1 12 Tf 72 720 Td (Comprimido) Tj ET'));

    assert.equal(
      textoDoPdf(montarPdf(paginaSimples(conteudo, ' /Filter /FlateDecode'))),
      'Comprimido',
    );
  });

  it('usa o ToUnicode e as larguras para juntar letras posicionadas uma a uma', () => {
    // Códigos de 2 bytes: 1=E 2=v 3=i 4=d 5=ê 6=n 7=c 8=a 9=s, todos com 500 de largura.
    const cmap = Buffer.from(
      '/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n' +
        '1 begincodespacerange <0000> <FFFF> endcodespacerange\n' +
        '4 beginbfchar <0001> <0045> <0003> <0069> <0004> <0064> <0005> <00EA> endbfchar\n' +
        '2 beginbfrange <0002> <0002> <0076> <0006> <0009> [<006E> <0063> <0061> <0073>] endbfrange\n' +
        'endcmap end end',
    );
    // "Evid" letra a letra com Td, "ê" num bloco novo, "ncias" noutro; depois uma palavra
    // separada por folga de verdade.
    const conteudo = deflateSync(
      Buffer.from(
        'BT /F1 10 Tf 1 0 0 1 100 700 Tm <0001>Tj 5 0 Td <0002>Tj 5 0 Td <0003>Tj 5 0 Td <0004>Tj ET\n' +
          'BT /F1 10 Tf 1 0 0 1 120 700 Tm <0005>Tj ET\n' +
          'BT /F1 10 Tf 1 0 0 1 125 700 Tm <0006000700030008>Tj <0009>Tj ET\n' +
          'BT /F1 10 Tf 1 0 0 1 160 700 Tm <00080009>Tj ET',
      ),
    );
    const objetos: Objeto[] = [
      { dicionario: '<< /Type /Catalog /Pages 2 0 R >>' },
      { dicionario: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
      {
        dicionario:
          '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      },
      // `/Length` indireto: é o caso que fazia o fluxo ser cortado no primeiro byte.
      { dicionario: '<< /Length 9 0 R /Filter /FlateDecode >>', fluxo: conteudo },
      {
        dicionario:
          '<< /Type /Font /Subtype /Type0 /BaseFont /Calibri /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>',
      },
      { dicionario: '<< /Type /Font /Subtype /CIDFontType2 /DW 500 /W [1 [500 500]] >>' },
      { dicionario: `<< /Length 8 0 R >>`, fluxo: cmap },
      { dicionario: String(cmap.length) },
      { dicionario: String(conteudo.length) },
    ];

    assert.equal(textoDoPdf(montarPdf(objetos)), 'Evidências as');
  });

  it('lê os objetos guardados num object stream', () => {
    const conteudo = Buffer.from('BT /F1 12 Tf 72 720 Td (Dentro do ObjStm) Tj ET', 'latin1');
    const embutidos = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    ];
    let deslocamento = 0;
    const indice = embutidos
      .map((corpo, posicao) => {
        const par = `${posicao + 1} ${deslocamento}`;
        deslocamento += corpo.length + 1;
        return par;
      })
      .join(' ');
    const fluxo = deflateSync(Buffer.from(`${indice}\n${embutidos.join('\n')}`, 'latin1'));
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.from(`4 0 obj\n<< /Length ${conteudo.length} >>\nstream\n`),
      conteudo,
      Buffer.from('\nendstream\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type1 >>\nendobj\n'),
      Buffer.from(
        `6 0 obj\n<< /Type /ObjStm /N 3 /First ${indice.length + 1} /Length ${fluxo.length} /Filter /FlateDecode >>\nstream\n`,
      ),
      fluxo,
      Buffer.from('\nendstream\nendobj\n7 0 obj\n<< /Type /XRef /Root 1 0 R >>\nendobj\n%%EOF\n'),
    ]);

    assert.equal(textoDoPdf(pdf), 'Dentro do ObjStm');
  });

  it('PDF só de imagem não tem texto', () => {
    const conteudo = Buffer.from('q 100 0 0 100 0 0 cm /Im1 Do Q', 'latin1');
    assert.equal(textoDoPdf(montarPdf(paginaSimples(conteudo))), '');
  });

  it('recusa o que não é PDF e o PDF protegido por senha', () => {
    assert.throws(() => textoDoPdf(Buffer.from('não sou um pdf')), PdfIlegivelError);
    const protegido = montarPdf(
      paginaSimples(Buffer.from('BT ET')),
      '<< /Root 1 0 R /Encrypt 9 0 R >>',
    );
    assert.throws(() => textoDoPdf(protegido), /senha/);
  });
});
