/**
 * Gera os ícones da PWA e o `.ico` dos atalhos do Windows, sem dependências
 * externas.
 *
 * O desenho é feito em resolução ampliada e reduzido por média, o que produz
 * as bordas suavizadas que um rasterizador daria — evitando trazer uma
 * biblioteca gráfica só para gerar arquivos estáticos.
 *
 * Uso: npm run gerar-icones
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const FATOR_DE_SUPERAMOSTRAGEM = 4;
const CANAIS_RGBA = 4;

const VERDE_DA_MARCA = [0x66, 0xcb, 0x66];
const AZUL_ARDOSIA = [0x2f, 0x41, 0x5c];
const AZUL_ARDOSIA_CLARO = [0x3f, 0x56, 0x76];
const FUNDO_TOPO = [0x12, 0x1e, 0x36];
const FUNDO_BASE = [0x07, 0x0b, 0x14];

const raizDoProjeto = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const diretorioDeSaida = join(raizDoProjeto, 'public', 'img');
const diretorioDoInstalador = join(raizDoProjeto, 'instalador');

function limitar(valor, minimo, maximo) {
  return Math.min(Math.max(valor, minimo), maximo);
}

function dentroDoRetanguloArredondado(px, py, x, y, largura, altura, raio) {
  const centroX = limitar(px, x + raio, x + largura - raio);
  const centroY = limitar(py, y + raio, y + altura - raio);
  const distanciaX = px - centroX;
  const distanciaY = py - centroY;
  return distanciaX * distanciaX + distanciaY * distanciaY <= raio * raio;
}

function interpolarCor(corInicial, corFinal, proporcao) {
  return corInicial.map((canal, indice) =>
    Math.round(canal + (corFinal[indice] - canal) * proporcao),
  );
}

function pintar(tela, largura, px, py, cor) {
  const posicao = (py * largura + px) * CANAIS_RGBA;
  tela[posicao] = cor[0];
  tela[posicao + 1] = cor[1];
  tela[posicao + 2] = cor[2];
  tela[posicao + 3] = 0xff;
}

/**
 * Desenha o ícone: fundo em degradê e uma grade 2x2 de blocos, a metáfora do
 * HUB SNK. O bloco superior esquerdo usa o verde da marca.
 */
function desenharIcone(lado, proporcaoDeMargem, arredondarFundo) {
  const tela = new Uint8Array(lado * lado * CANAIS_RGBA);

  const raioDoFundo = arredondarFundo ? lado * 0.22 : 0;
  const margem = lado * proporcaoDeMargem;
  const espacamento = lado * 0.06;
  const ladoDoBloco = (lado - margem * 2 - espacamento) / 2;
  const raioDoBloco = ladoDoBloco * 0.2;

  const blocos = [
    { coluna: 0, linha: 0, cor: VERDE_DA_MARCA },
    { coluna: 1, linha: 0, cor: AZUL_ARDOSIA },
    { coluna: 0, linha: 1, cor: AZUL_ARDOSIA },
    { coluna: 1, linha: 1, cor: AZUL_ARDOSIA_CLARO },
  ];

  for (let py = 0; py < lado; py += 1) {
    const corDoFundo = interpolarCor(FUNDO_TOPO, FUNDO_BASE, py / (lado - 1));

    for (let px = 0; px < lado; px += 1) {
      if (!dentroDoRetanguloArredondado(px, py, 0, 0, lado, lado, raioDoFundo)) {
        continue;
      }

      pintar(tela, lado, px, py, corDoFundo);

      for (const bloco of blocos) {
        const x = margem + bloco.coluna * (ladoDoBloco + espacamento);
        const y = margem + bloco.linha * (ladoDoBloco + espacamento);
        if (dentroDoRetanguloArredondado(px, py, x, y, ladoDoBloco, ladoDoBloco, raioDoBloco)) {
          pintar(tela, lado, px, py, bloco.cor);
          break;
        }
      }
    }
  }

  return tela;
}

function reduzirPorMedia(telaAmpliada, ladoAmpliado, ladoFinal) {
  const tela = new Uint8Array(ladoFinal * ladoFinal * CANAIS_RGBA);
  const amostrasPorPixel = FATOR_DE_SUPERAMOSTRAGEM * FATOR_DE_SUPERAMOSTRAGEM;

  for (let py = 0; py < ladoFinal; py += 1) {
    for (let px = 0; px < ladoFinal; px += 1) {
      let vermelho = 0;
      let verde = 0;
      let azul = 0;
      let opacidade = 0;

      for (let dy = 0; dy < FATOR_DE_SUPERAMOSTRAGEM; dy += 1) {
        for (let dx = 0; dx < FATOR_DE_SUPERAMOSTRAGEM; dx += 1) {
          const origem =
            ((py * FATOR_DE_SUPERAMOSTRAGEM + dy) * ladoAmpliado +
              px * FATOR_DE_SUPERAMOSTRAGEM +
              dx) *
            CANAIS_RGBA;
          const alfa = telaAmpliada[origem + 3] / 255;
          vermelho += telaAmpliada[origem] * alfa;
          verde += telaAmpliada[origem + 1] * alfa;
          azul += telaAmpliada[origem + 2] * alfa;
          opacidade += alfa;
        }
      }

      const destino = (py * ladoFinal + px) * CANAIS_RGBA;
      if (opacidade > 0) {
        tela[destino] = Math.round(vermelho / opacidade);
        tela[destino + 1] = Math.round(verde / opacidade);
        tela[destino + 2] = Math.round(azul / opacidade);
      }
      tela[destino + 3] = Math.round((opacidade / amostrasPorPixel) * 255);
    }
  }

  return tela;
}

const tabelaCrc32 = (() => {
  const tabela = new Uint32Array(256);
  for (let indice = 0; indice < 256; indice += 1) {
    let valor = indice;
    for (let bit = 0; bit < 8; bit += 1) {
      valor = valor & 1 ? 0xedb88320 ^ (valor >>> 1) : valor >>> 1;
    }
    tabela[indice] = valor >>> 0;
  }
  return tabela;
})();

function calcularCrc32(dados) {
  let acumulador = 0xffffffff;
  for (const byte of dados) {
    acumulador = tabelaCrc32[(acumulador ^ byte) & 0xff] ^ (acumulador >>> 8);
  }
  return (acumulador ^ 0xffffffff) >>> 0;
}

function montarBloco(tipo, conteudo) {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(conteudo.length);

  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), conteudo]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(calcularCrc32(corpo));

  return Buffer.concat([tamanho, corpo, crc]);
}

function codificarPng(tela, lado) {
  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(lado, 0);
  cabecalho.writeUInt32BE(lado, 4);
  cabecalho.writeUInt8(8, 8); // profundidade de bits
  cabecalho.writeUInt8(6, 9); // RGBA
  cabecalho.writeUInt8(0, 10); // compressão padrão
  cabecalho.writeUInt8(0, 11); // filtro padrão
  cabecalho.writeUInt8(0, 12); // sem entrelaçamento

  const bytesPorLinha = lado * CANAIS_RGBA;
  const linhas = Buffer.alloc((bytesPorLinha + 1) * lado);
  for (let linha = 0; linha < lado; linha += 1) {
    const destino = linha * (bytesPorLinha + 1);
    linhas[destino] = 0; // tipo de filtro "none"
    Buffer.from(tela.buffer, linha * bytesPorLinha, bytesPorLinha).copy(linhas, destino + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    montarBloco('IHDR', cabecalho),
    montarBloco('IDAT', deflateSync(linhas, { level: 9 })),
    montarBloco('IEND', Buffer.alloc(0)),
  ]);
}

function desenharEmPng(lado, proporcaoDeMargem, arredondarFundo) {
  const ladoAmpliado = lado * FATOR_DE_SUPERAMOSTRAGEM;
  const telaAmpliada = desenharIcone(ladoAmpliado, proporcaoDeMargem, arredondarFundo);
  return codificarPng(reduzirPorMedia(telaAmpliada, ladoAmpliado, lado), lado);
}

function gerarArquivo(nomeDoArquivo, lado, proporcaoDeMargem, arredondarFundo) {
  const caminho = join(diretorioDeSaida, nomeDoArquivo);
  writeFileSync(caminho, desenharEmPng(lado, proporcaoDeMargem, arredondarFundo));
  console.log(`gerado: ${caminho}`);
}

/*
 * O `.ico` guarda vários tamanhos no mesmo arquivo, e o Windows escolhe qual
 * usar conforme o lugar — 16 na barra de tarefas, 32 no atalho, 256 na
 * visualização grande do Explorer. Cada imagem entra como PNG, formato aceito
 * dentro de ICO desde o Windows Vista.
 */
const LADOS_DO_ICO = [16, 32, 48, 64, 128, 256];
const TAMANHO_DO_CABECALHO_DO_ICO = 6;
const TAMANHO_DA_ENTRADA_DO_ICO = 16;
const BITS_POR_PIXEL = 32;
/* No formato, o lado 256 é gravado como 0: o campo tem um byte só. */
const LADO_MAXIMO_NO_ICO = 256;

function codificarIco(imagens) {
  const cabecalho = Buffer.alloc(TAMANHO_DO_CABECALHO_DO_ICO);
  cabecalho.writeUInt16LE(0, 0); // reservado
  cabecalho.writeUInt16LE(1, 2); // 1 = ícone
  cabecalho.writeUInt16LE(imagens.length, 4);

  let deslocamento = TAMANHO_DO_CABECALHO_DO_ICO + imagens.length * TAMANHO_DA_ENTRADA_DO_ICO;

  const entradas = imagens.map(({ lado, png }) => {
    const entrada = Buffer.alloc(TAMANHO_DA_ENTRADA_DO_ICO);
    const ladoNoArquivo = lado === LADO_MAXIMO_NO_ICO ? 0 : lado;

    entrada.writeUInt8(ladoNoArquivo, 0);
    entrada.writeUInt8(ladoNoArquivo, 1);
    entrada.writeUInt8(0, 2); // paleta: nenhuma
    entrada.writeUInt8(0, 3); // reservado
    entrada.writeUInt16LE(1, 4); // planos de cor
    entrada.writeUInt16LE(BITS_POR_PIXEL, 6);
    entrada.writeUInt32LE(png.length, 8);
    entrada.writeUInt32LE(deslocamento, 12);

    deslocamento += png.length;
    return entrada;
  });

  return Buffer.concat([cabecalho, ...entradas, ...imagens.map(({ png }) => png)]);
}

function gerarIcoDoInstalador() {
  const imagens = LADOS_DO_ICO.map((lado) => ({
    lado,
    /* Margem menor que a da PWA: em 16px o ícone precisa preencher o quadrado. */
    png: desenharEmPng(lado, 0.14, true),
  }));

  mkdirSync(diretorioDoInstalador, { recursive: true });
  const caminho = join(diretorioDoInstalador, 'hub-snk.ico');
  writeFileSync(caminho, codificarIco(imagens));
  console.log(`gerado: ${caminho}`);
}

mkdirSync(diretorioDeSaida, { recursive: true });
gerarArquivo('icone-192.png', 192, 0.2, true);
gerarArquivo('icone-512.png', 512, 0.2, true);
gerarArquivo('icone-maskable-512.png', 512, 0.28, false);
gerarIcoDoInstalador();
