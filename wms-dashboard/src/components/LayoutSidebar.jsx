import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, Lock, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Sun, Workflow } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTema } from '../theme/TemaContext.jsx';
import { useTituloPaginaAtual } from '../contexts/TituloPaginaContext.jsx';
import TrocarSenha from '../pages/TrocarSenha.jsx';
import FluxoSistema from './FluxoSistema.jsx';
import { MENU, ROTULOS_CARGO, montarMenu, podeVer } from './Topbar.jsx';
import logoBoxer from '../assets/logo-boxer.svg';

// Layout com sidebar fixa à esquerda (mesmo estilo do "Boxer Requisições"):
// painel escuro, ícone + rótulo, item ativo em azul, bloco do usuário e
// ícones de tema / senha / sair / recolher embaixo. Usa o mesmo MENU,
// as mesmas permissões e os mesmos menus editáveis (Controle de acesso >
// Menus) do Topbar antigo - só muda a apresentação. Desligar a flag
// 'dashboard_sidebar' (Controle de acesso > Funções) volta ao Topbar.

const CHAVE_RECOLHIDA = 'wms-sidebar-recolhida';

function lerRecolhida() {
    try {
        return localStorage.getItem(CHAVE_RECOLHIDA) === '1';
    } catch {
        return false;
    }
}

function gravarRecolhida(valor) {
    try {
        localStorage.setItem(CHAVE_RECOLHIDA, valor ? '1' : '0');
    } catch {
        // sem storage (janela privada etc.) - só não lembra a preferência
    }
}

function useTelaGrande() {
    const consulta = '(min-width: 901px)';
    const [grande, setGrande] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(consulta).matches : true));
    useEffect(() => {
        if (!window.matchMedia) return undefined;
        const mq = window.matchMedia(consulta);
        const aoMudar = (e) => setGrande(e.matches);
        setGrande(mq.matches);
        if (mq.addEventListener) mq.addEventListener('change', aoMudar);
        else mq.addListener(aoMudar);
        return () => {
            if (mq.removeEventListener) mq.removeEventListener('change', aoMudar);
            else mq.removeListener(aoMudar);
        };
    }, []);
    return grande;
}

function caminhoAtivo(caminho, to) {
    return caminho === to || caminho.startsWith(`${to}/`);
}

function classeItem(isActive, extra) {
    return `wms-sb-item${isActive ? ' ativo' : ''}${extra ? ` ${extra}` : ''}`;
}

export default function LayoutSidebar({ children }) {
    const { colaborador, sair, pode } = useAuth();
    const { tema, alternarTema } = useTema();
    const location = useLocation();
    const tituloPagina = useTituloPaginaAtual();
    const telaGrande = useTelaGrande();

    const cfgMenu = colaborador?.menu?.dashboard;
    const menuFinal = useMemo(() => montarMenu(cfgMenu), [cfgMenu]);

    const [recolhidaPref, setRecolhidaPref] = useState(lerRecolhida);
    const [mobileAberto, setMobileAberto] = useState(false);
    const [trocandoSenha, setTrocandoSenha] = useState(false);
    const [mostrandoFluxo, setMostrandoFluxo] = useState(false);
    const [gruposAbertos, setGruposAbertos] = useState(() => {
        const inicial = {};
        for (const item of MENU) {
            if (item.tipo === 'grupo') inicial[item.id] = item.itens.some((sub) => caminhoAtivo(location.pathname, sub.to));
        }
        return inicial;
    });

    const compacta = recolhidaPref && telaGrande;

    // Trocou de rota: fecha o drawer do celular e abre o grupo da tela atual.
    useEffect(() => {
        setMobileAberto(false);
        setGruposAbertos((atual) => {
            const novo = { ...atual };
            for (const item of MENU) {
                if (item.tipo === 'grupo' && item.itens.some((sub) => caminhoAtivo(location.pathname, sub.to))) novo[item.id] = true;
            }
            return novo;
        });
    }, [location.pathname]);

    function alternarRecolhida() {
        setRecolhidaPref((v) => {
            gravarRecolhida(!v);
            return !v;
        });
    }

    function alternarGrupo(id) {
        setGruposAbertos((atual) => ({ ...atual, [id]: !atual[id] }));
    }

    const perfil = colaborador.perfilNome || ROTULOS_CARGO[colaborador.cargo] || colaborador.cargo;
    const inicial = (colaborador.nome || '?').trim().charAt(0).toUpperCase();

    function renderLink(item, { sub = false } = {}) {
        return (
            <NavLink
                key={item.to}
                to={item.to}
                end={item.fim}
                title={compacta ? item.label : undefined}
                className={({ isActive }) => classeItem(isActive)}
            >
                <item.Icone size={sub ? 16 : 18} style={{ flexShrink: 0 }} />
                {!compacta && <span className="wms-sb-rotulo">{item.label}</span>}
            </NavLink>
        );
    }

    function renderMenu() {
        const nos = [];
        menuFinal.forEach((item, indice) => {
            if (item.tipo === 'link') {
                if (!podeVer(item, pode)) return;
                nos.push(renderLink(item));
                return;
            }
            const visiveis = item.itens.filter((sub) => podeVer(sub, pode));
            if (visiveis.length === 0) return;

            // Barra recolhida: sem cabeçalho de grupo - só os ícones dos
            // itens, com um separador fino entre um grupo e o resto.
            if (compacta) {
                nos.push(<div key={`sep-${item.id}-${indice}`} className="wms-sb-sep" />);
                visiveis.forEach((sub) => nos.push(renderLink(sub)));
                nos.push(<div key={`sep-fim-${item.id}-${indice}`} className="wms-sb-sep" />);
                return;
            }

            const aberto = !!gruposAbertos[item.id];
            const temAtivo = visiveis.some((sub) => caminhoAtivo(location.pathname, sub.to));
            nos.push(
                <div key={item.id}>
                    <button
                        type="button"
                        onClick={() => alternarGrupo(item.id)}
                        className={`wms-sb-item wms-sb-grupo${temAtivo && !aberto ? ' tem-ativo' : ''}`}
                        aria-expanded={aberto}
                    >
                        <item.Icone size={18} style={{ flexShrink: 0 }} />
                        <span className="wms-sb-rotulo" style={{ flex: 1 }}>{item.label}</span>
                        <ChevronDown
                            size={14}
                            style={{ flexShrink: 0, opacity: 0.6, transform: aberto ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s ease' }}
                        />
                    </button>
                    {aberto && <div className="wms-sb-sub">{visiveis.map((sub) => renderLink(sub, { sub: true }))}</div>}
                </div>
            );
        });
        return nos;
    }

    const classeSidebar = `wms-sb${compacta ? ' recolhida' : ''}${mobileAberto ? ' mobile-aberta' : ''}`;

    return (
        <div className="wms-shell">
            {mobileAberto && <div className="wms-sb-overlay" onClick={() => setMobileAberto(false)} />}

            <aside className={classeSidebar} aria-label="Menu principal">
                <Link to="/" className="wms-sb-topo" title="Ir para o início">
                    <img src={logoBoxer} alt="Boxer" className="wms-sb-logo" />
                    {!compacta && <span className="wms-sb-marca">Boxer WMS</span>}
                </Link>

                <nav className="wms-sb-nav">
                    {/* Ação (não é rota): abre o modal do fluxo do sistema por cima da tela atual. */}
                    <button
                        type="button"
                        onClick={() => { setMostrandoFluxo(true); setMobileAberto(false); }}
                        className="wms-sb-item"
                        title={compacta ? 'Fluxo do sistema' : undefined}
                    >
                        <Workflow size={18} style={{ flexShrink: 0 }} />
                        {!compacta && <span className="wms-sb-rotulo">Fluxo do sistema</span>}
                    </button>

                    {renderMenu()}
                </nav>

                <div className="wms-sb-rodape">
                    {compacta ? (
                        <div className="wms-sb-avatar" title={`${colaborador.nome} - ${perfil}`}>{inicial}</div>
                    ) : (
                        <div className="wms-sb-user" title={colaborador.email || undefined}>
                            <div className="wms-sb-user-nome">{colaborador.nome}</div>
                            <div className="wms-sb-user-perfil">{perfil}</div>
                        </div>
                    )}

                    <div className="wms-sb-acoes">
                        <button
                            type="button"
                            className="wms-sb-ico"
                            onClick={alternarTema}
                            title={tema === 'claro' ? 'Modo escuro' : 'Modo claro'}
                            aria-label={tema === 'claro' ? 'Ativar modo escuro' : 'Ativar modo claro'}
                        >
                            {tema === 'claro' ? <Moon size={17} /> : <Sun size={17} />}
                        </button>
                        <button type="button" className="wms-sb-ico" onClick={() => setTrocandoSenha(true)} title="Alterar senha" aria-label="Alterar senha">
                            <Lock size={17} />
                        </button>
                        <button type="button" className="wms-sb-ico" onClick={sair} title="Sair" aria-label="Sair">
                            <LogOut size={17} />
                        </button>
                        {telaGrande && (
                            <button
                                type="button"
                                className="wms-sb-ico wms-sb-recolher"
                                onClick={alternarRecolhida}
                                title={compacta ? 'Expandir menu' : 'Recolher menu'}
                                aria-label={compacta ? 'Expandir menu' : 'Recolher menu'}
                            >
                                {compacta ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
                            </button>
                        )}
                    </div>
                </div>
            </aside>

            <div className="wms-shell-main">
                <header className={`wms-shell-header${tituloPagina ? '' : ' sem-titulo'}`}>
                    <button
                        type="button"
                        className="wms-shell-menu-btn"
                        onClick={() => setMobileAberto(true)}
                        title="Menu"
                        aria-label="Abrir menu"
                    >
                        <Menu size={22} />
                    </button>
                    {tituloPagina && <h1 className="wms-shell-titulo">{tituloPagina}</h1>}
                </header>
                <main className="wms-shell-conteudo">{children}</main>
            </div>

            {trocandoSenha && <TrocarSenha aoFechar={() => setTrocandoSenha(false)} />}
            {mostrandoFluxo && <FluxoSistema aoFechar={() => setMostrandoFluxo(false)} />}
        </div>
    );
}
