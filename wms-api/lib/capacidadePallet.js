// ============================================================
// Calculo de capacidade de pallet (lastro x camadas) - fonte
// UNICA usada por produtos.js (consulta informativa da tela de
// Produtos), nf-importacao.js (tamanho de cada pallet gerado no
// recebimento por NF) e recebimento.js (escolha automatica de
// endereco pela capacidade).
//
// Antes cada um desses 3 arquivos tinha sua PROPRIA copia dessa
// conta - por isso a correcao de lastro (grade + corte guilhotina,
// e o override manual por produto) so aparecia no card informativo
// da tela de Produtos e nao no recebimento de verdade (o coletor
// continuava gerando pallets do tamanho antigo). Daqui pra frente,
// uma correcao aqui vale pros tres lugares.
// ============================================================

const PALLET_COMPRIMENTO_CM = 100;
const PALLET_LARGURA_CM = 120;
const PALLET_ALTURA_CM = 15;

// Quantas unidades comprimentoProduto x larguraProduto cabem numa
// base palletComprimento x palletLargura. Tenta a grade simples nas
// duas orientacoes (o que a versao antiga fazia) e tambem um corte
// "guilhotina" em 2 regioes (uma faixa numa orientacao + o resto do
// espaco com a outra orientacao), nos dois eixos - capta bem os
// casos onde sobra uma faixa estreita que uma segunda orientacao
// aproveita.
//
// Ainda e uma heuristica: nao capta encaixes entrelacados tipo
// "cata-vento" (caixas giradas 90 graus entre si dentro da mesma
// camada, vistas em fotos de pallet real). Pra esses casos existe o
// override lastro_manual_pallet no produto, preenchido a partir de
// um teste fisico real - ver lastroEfetivo() abaixo.
function calcularLastro(comprimentoProduto, larguraProduto, palletComprimento = PALLET_COMPRIMENTO_CM, palletLargura = PALLET_LARGURA_CM) {
    function grade(pw, ph, bw, bh) {
        return Math.floor(pw / bw) * Math.floor(ph / bh);
    }

    const candidatos = [
        grade(palletComprimento, palletLargura, comprimentoProduto, larguraProduto),
        grade(palletComprimento, palletLargura, larguraProduto, comprimentoProduto),
    ];

    // Corte vertical: colunas numa orientacao + sobra em X preenchida
    // (nas duas orientacoes) pela largura toda do pallet.
    for (const [bw1, bh1] of [[comprimentoProduto, larguraProduto], [larguraProduto, comprimentoProduto]]) {
        const colunas = Math.floor(palletComprimento / bw1);
        const sobraX = palletComprimento - colunas * bw1;
        const parte1 = colunas * Math.floor(palletLargura / bh1);
        for (const [bw2, bh2] of [[comprimentoProduto, larguraProduto], [larguraProduto, comprimentoProduto]]) {
            candidatos.push(parte1 + Math.floor(sobraX / bw2) * Math.floor(palletLargura / bh2));
        }
    }

    // Corte horizontal: linhas numa orientacao + sobra em Y.
    for (const [bw1, bh1] of [[comprimentoProduto, larguraProduto], [larguraProduto, comprimentoProduto]]) {
        const linhas = Math.floor(palletLargura / bh1);
        const sobraY = palletLargura - linhas * bh1;
        const parte1 = linhas * Math.floor(palletComprimento / bw1);
        for (const [bw2, bh2] of [[comprimentoProduto, larguraProduto], [larguraProduto, comprimentoProduto]]) {
            candidatos.push(parte1 + Math.floor(palletComprimento / bw2) * Math.floor(sobraY / bh2));
        }
    }

    return Math.max(...candidatos);
}

// Lastro que deve valer pra esse produto: o override manual quando
// preenchido (lastro_manual_pallet, coluna de produtos), senao o
// calculado pela grade/guilhotina.
function lastroEfetivo({ comprimentoCm, larguraCm, lastroManualPallet }) {
    const lastroCalculado = calcularLastro(Number(comprimentoCm), Number(larguraCm));
    const lastroManual = lastroManualPallet ? Number(lastroManualPallet) : null;
    return {
        lastro: lastroManual || lastroCalculado,
        lastroCalculado,
        lastroManual,
        lastroOrigem: lastroManual ? 'manual' : 'calculado',
    };
}

// Quantas camadas cabem num perfil de endereco (peso maximo + altura
// livre), dado o lastro (unidades por camada) e o peso/altura de
// cada unidade do produto.
function calcularCamadas({ lastro, alturaUnidadeCm, pesoUnidadeKg, alturaLivreCm, pesoMaximoKg }) {
    const alturaDisponivel = Number(alturaLivreCm) - PALLET_ALTURA_CM;
    const camadasPorAltura = alturaDisponivel > 0 ? Math.floor(alturaDisponivel / Number(alturaUnidadeCm)) : 0;
    const pesoPorCamada = lastro * Number(pesoUnidadeKg);
    const camadasPorPeso = pesoPorCamada > 0 ? Math.floor(Number(pesoMaximoKg) / pesoPorCamada) : 0;
    return Math.max(Math.min(camadasPorAltura, camadasPorPeso), 0);
}

module.exports = {
    PALLET_COMPRIMENTO_CM,
    PALLET_LARGURA_CM,
    PALLET_ALTURA_CM,
    calcularLastro,
    lastroEfetivo,
    calcularCamadas,
};
