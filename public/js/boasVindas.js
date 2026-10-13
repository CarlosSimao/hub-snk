/**
 * Assistente de boas-vindas: no primeiro uso, pergunta quem é a pessoa, o perfil e se ela
 * tem login no Sankhya. Substitui as páginas que o instalador do Windows tinha, e por isso
 * vale igual no Windows, no Linux e no Mac.
 *
 * Todo passo já vem respondido: dá para concluir só clicando em Próximo. Esc não fecha,
 * porque fechar sem gravar faria o assistente voltar na próxima abertura.
 */

const TOTAL_DE_PASSOS = 4;

const NOMES_DOS_PERFIS = {
  consultor: 'Consultor',
  analista: 'Analista',
  'gerente-de-projeto': 'Gerente de Projetos',
  desenvolvedor: 'Desenvolvedor',
};

const elementos = {
  modal: document.getElementById('modal-boas-vindas'),
  formulario: document.getElementById('formulario-boas-vindas'),
  progresso: document.getElementById('progresso-boas-vindas'),
  marcadores: document.querySelectorAll('.passos-boas-vindas li'),
  passos: document.querySelectorAll('#modal-boas-vindas [data-passo]'),
  nome: document.getElementById('campo-nome-boas-vindas'),
  empresa: document.getElementById('campo-empresa-boas-vindas'),
  time: document.getElementById('campo-time-boas-vindas'),
  email: document.getElementById('campo-email-boas-vindas'),
  resumo: document.getElementById('resumo-boas-vindas'),
  erro: document.getElementById('erro-boas-vindas'),
  voltar: document.getElementById('btn-voltar-boas-vindas'),
  avancar: document.getElementById('btn-avancar-boas-vindas'),
};

function respostas() {
  const dados = new FormData(elementos.formulario);
  return {
    nomeDoUsuario: elementos.nome.value.trim(),
    empresaDoUsuario: elementos.empresa.value.trim(),
    timeDoUsuario: elementos.time.value.trim(),
    emailDoUsuario: elementos.email.value.trim(),
    perfil: dados.get('perfil'),
    terceiro: dados.get('acesso-ao-sankhya') === 'nao',
  };
}

function exibirErro(mensagem) {
  elementos.erro.textContent = mensagem;
  elementos.erro.hidden = !mensagem;
}

function preencherResumo() {
  const { nomeDoUsuario, empresaDoUsuario, timeDoUsuario, emailDoUsuario, perfil, terceiro } =
    respostas();
  const linhas = [
    ['Nome', nomeDoUsuario],
    ['Empresa', empresaDoUsuario],
    ['Time', timeDoUsuario],
    ['E-mail', emailDoUsuario],
    ['Perfil', NOMES_DOS_PERFIS[perfil]],
    ['Login no Sankhya', terceiro ? 'Não (terceiro)' : 'Sim'],
  ];

  elementos.resumo.replaceChildren(
    ...linhas.flatMap(([rotulo, valor]) => {
      const termo = document.createElement('dt');
      termo.textContent = rotulo;
      const descricao = document.createElement('dd');
      descricao.textContent = valor || 'não informado';
      return [termo, descricao];
    }),
  );
}

function mostrarPasso(passo) {
  elementos.passos.forEach((secao) => {
    secao.hidden = Number(secao.dataset.passo) !== passo;
  });
  elementos.marcadores.forEach((marcador, indice) => {
    marcador.classList.toggle('feito', indice < passo);
  });
  elementos.progresso.textContent = `Passo ${passo} de ${TOTAL_DE_PASSOS}`;
  elementos.voltar.hidden = passo === 1;
  elementos.avancar.textContent = passo === TOTAL_DE_PASSOS ? 'Começar' : 'Próximo';
  exibirErro('');

  if (passo === TOTAL_DE_PASSOS) {
    preencherResumo();
  }
  elementos.modal.querySelector(`[data-passo="${passo}"] input`)?.focus();
}

/**
 * Abre o assistente e resolve com a configuração gravada, depois que a pessoa conclui.
 * `requisitar` é o do painel, que transforma a resposta de erro em exceção com a mensagem.
 */
export function abrirBoasVindas(requisitar) {
  let passo = 1;

  return new Promise((resolver) => {
    async function concluir() {
      elementos.avancar.disabled = true;
      try {
        const configuracao = await requisitar('/api/configuracao/boas-vindas', {
          metodo: 'PUT',
          corpo: respostas(),
        });
        elementos.modal.close();
        resolver(configuracao);
      } catch (erro) {
        exibirErro(`Não foi possível salvar: ${erro.message}`);
      } finally {
        elementos.avancar.disabled = false;
      }
    }

    elementos.modal.addEventListener('cancel', (evento) => evento.preventDefault());

    elementos.voltar.addEventListener('click', () => {
      passo -= 1;
      mostrarPasso(passo);
    });

    elementos.formulario.addEventListener('submit', (evento) => {
      evento.preventDefault();
      if (passo === 1 && !elementos.email.checkValidity()) {
        exibirErro('O e-mail não parece válido. Corrija ou deixe em branco.');
        elementos.email.focus();
        return;
      }
      if (passo === TOTAL_DE_PASSOS) {
        void concluir();
        return;
      }
      passo += 1;
      mostrarPasso(passo);
    });

    elementos.modal.showModal();
    mostrarPasso(passo);
  });
}
