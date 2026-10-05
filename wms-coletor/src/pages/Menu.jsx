import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, LogOut, Sun, Moon } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTema } from '../theme/TemaContext.jsx';
import TrocarSenha from './TrocarSenha.jsx';
import logoBoxer from '../assets/logo-boxer.svg';

const ROTULOS_CARGO = {
    admin: 'Admin',
    conferente: 'Conferente',
    picking: 'Picking',
    recebimento_reposicao: 'Recebimento / Repositor Picking',
};

export default function Menu() {
    const navigate = useNavigate();
    const { colaborador, sair, pode } = useAuth();
    const { tema, alternarTema } = useTema();
    const [contadores, setContadores] = useState({ reposicao: 0, pulmao: 0 });
    const [trocandoSenha, setTrocandoSenha] = useState(false);

    // Só busca o contador das telas que a pessoa pode abrir (as outras viriam
    // 403 agora que a API também protege a leitura) e nunca quebra o menu.
    const veReposicao = pode('col.picking');
    const veColetorPulmao = pode('col.pulmao');
    useEffect(() => {
        if (veReposicao) {
            api.get('/tarefas/reposicao?status=pendente')
                .then((rep) => setContadores((atual) => ({ ...atual, reposicao: rep.length })))
                .catch(() => {});
        }
        // 05/10/2026: sem fila automática - o contador agora é quantos
        // pallets estão no chão (Pulmão + Pulmão Teste) esperando subir.
        if (veColetorPulmao) {
            api.get('/pulmao/pallets')
                .then((rep) => setContadores((atual) => ({ ...atual, pulmao: rep.length })))
                .catch(() => {});
        }
    }, [veReposicao, veColetorPulmao]);

    // "permissao" = chave do catalogo de permissoes (wms-api/lib/permissoes.js),
    // definida por perfil no painel Controle de acesso do dashboard.
    // 'admin' sempre ve tudo.
    // "Separação" (fluxo antigo, tarefas_separacao) e "Reposição"
    // (fila avulsa) saíram do menu: a primeira foi substituída pelo
    // "Separação (novo fluxo)", e a segunda foi incorporada dentro
    // de "Picking (repor)" - que agora mostra a fila automática de
    // reposição primeiro, com o modo avulso como alternativa.
    const opcoes = [
        { rota: '/nf-importacao', label: 'Recebimento (NF)', contador: null, cor: 'accent', permissao: 'col.nf_importacao' },
        { rota: '/nf-devolucao', label: 'Devolução (NF)', contador: null, cor: 'accent', permissao: 'col.nf_devolucao' },
        { rota: '/imprimir-ordem-separacao', label: 'Imprimir Ordem de Separação', contador: null, cor: 'accent', permissao: 'col.imprimir_ordem' },
        { rota: '/separacao-erp', label: 'Separação', contador: null, cor: 'accent', permissao: 'col.separacao' },
        { rota: '/transferencia-deposito', label: 'Transferência de Depósito', contador: null, cor: 'accent', permissao: 'col.transferencia' },
        { rota: '/estoque-devolucao', label: 'Estoque Devolução', contador: null, cor: 'accent', permissao: 'col.estoque_devolucao' },
        // 'picking' incluído em 28/09/2026 a pedido do Dhiefferton, pra dar
        // acesso ao Gabriel Padilha (hoje o único colaborador com esse
        // cargo) - ver mesmo ajuste espelhado no back-end (conferencia-erp.js)
        // e na rota protegida (App.jsx).
        { rota: '/conferencia-erp', label: 'Conferência de embarque', contador: null, cor: 'accent', permissao: 'col.conferencia' },
        { rota: '/picking', label: 'Picking (repor)', contador: contadores.reposicao, cor: 'warning', permissao: 'col.picking' },
        { rota: '/pulmao', label: 'Estoque Pulmão → Vertical', contador: contadores.pulmao, cor: 'warning', permissao: 'col.pulmao' },
        { rota: '/inventario', label: 'Contagem de inventário', contador: null, permissao: 'col.inventario' },
        { rota: '/reimprimir-etiquetas', label: 'Reimprimir etiquetas', contador: null, permissao: 'col.reimprimir' },
    ];

    // Menu editável (Fase 2, dashboard > Controle de acesso > Menus): a API manda em
    // colaborador.menu.coletor só o que foi personalizado - { chave: { rotulo,
    // ordem, oculto } }. Sem nada = ordem e nomes acima. Esconder é só aparência:
    // quem bloqueia a tela é a permissão.
    const cfgMenu = colaborador.menu?.coletor;
    const opcoesVisiveis = opcoes
        .map((op, i) => ({ op, i, c: cfgMenu?.[op.permissao] }))
        .filter((x) => (!x.op.permissao || pode(x.op.permissao)) && !x.c?.oculto)
        .sort((a, b) => (a.c?.ordem ?? 1000 + a.i) - (b.c?.ordem ?? 1000 + b.i))
        .map((x) => (x.c?.rotulo ? { ...x.op, label: x.c.rotulo } : x.op));

    return (
        <div className="tela">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <img src={logoBoxer} alt="Boxer" style={{ width: 34, height: 34, flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                    <h1 style={{ fontSize: 16, margin: 0, lineHeight: 1.2 }}>Boxer WMS</h1>
                    <p style={{ fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: 0 }}>
                        Gestão de armazém
                    </p>
                </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Colaborador</p>
                    <p style={{ fontSize: 18, fontWeight: 600, margin: '2px 0 0' }}>{colaborador.nome}</p>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>
                        {colaborador.perfilNome || ROTULOS_CARGO[colaborador.cargo] || colaborador.cargo}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                    <button
                        onClick={alternarTema}
                        title={tema === 'claro' ? 'Modo escuro' : 'Modo claro'}
                        style={{ padding: 8, minHeight: 'auto' }}
                    >
                        {tema === 'claro' ? <Moon size={18} /> : <Sun size={18} />}
                    </button>
                    <button
                        onClick={() => setTrocandoSenha(true)}
                        title="Trocar senha"
                        style={{ padding: 8, minHeight: 'auto' }}
                    >
                        <Lock size={18} />
                    </button>
                    <button onClick={sair} title="Sair" style={{ padding: 8, minHeight: 'auto' }}>
                        <LogOut size={18} />
                    </button>
                </div>
            </div>

            {trocandoSenha && <TrocarSenha aoFechar={() => setTrocandoSenha(false)} />}

            {opcoesVisiveis.map((op) => (
                <button
                    key={op.rota}
                    onClick={() => navigate(op.rota)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left' }}
                >
                    <span>{op.label}</span>
                    {op.contador !== null && (
                        <span className={`badge ${op.cor}`}>{op.contador}</span>
                    )}
                </button>
            ))}

            {opcoesVisiveis.length === 0 && (
                <div className="card">
                    <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
                        Seu nível de acesso não tem nenhuma tela disponível aqui ainda. Fale com um administrador.
                    </p>
                </div>
            )}
        </div>
    );
}
