import { HashRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import { TemaProvider } from './theme/TemaContext.jsx';
import RotaProtegida from './components/RotaProtegida.jsx';
import Login from './pages/Login.jsx';
import TrocarSenha from './pages/TrocarSenha.jsx';
import Menu from './pages/Menu.jsx';
import ImprimirOrdemSeparacao from './pages/ImprimirOrdemSeparacao.jsx';
import SeparacaoErp from './pages/SeparacaoErp.jsx';
import Inventario from './pages/Inventario.jsx';
import Picking from './pages/Picking.jsx';
import NfImportacao from './pages/NfImportacao.jsx';
import NfDevolucao from './pages/NfDevolucao.jsx';
import ConferenciaErp from './pages/ConferenciaErp.jsx';
import ReimprimirEtiquetas from './pages/ReimprimirEtiquetas.jsx';
import Pulmao from './pages/Pulmao.jsx';
import TransferenciaDeposito from './pages/TransferenciaDeposito.jsx';
import EstoqueDevolucao from './pages/EstoqueDevolucao.jsx';

function ConteudoApp() {
    const { colaborador, carregando } = useAuth();

    if (carregando) {
        return (
            <div className="tela" style={{ justifyContent: 'center', alignItems: 'center' }}>
                <p style={{ color: 'var(--text-secondary)' }}>Carregando...</p>
            </div>
        );
    }

    if (!colaborador) {
        return <Login />;
    }

    // Senha definida por um admin (cadastro novo ou reset) - obriga a
    // troca antes de liberar qualquer outra tela do coletor.
    if (colaborador.precisaTrocarSenha) {
        return <TrocarSenha obrigatorio />;
    }

    return (
        <Routes>
            {/* Cada tela confere a própria permissão (catálogo em wms-api/lib/permissoes.js); o que cada
                perfil enxerga é definido no painel Controle de acesso do dashboard. Os padrões reproduzem
                os antigos cargos: Imprimir Ordem e Inventário para todos, Separação só picking, Conferência
                conferente e picking (28/09/2026), o resto recebimento_reposicao. */}
            <Route path="/" element={<Menu />} />
            <Route
                path="/imprimir-ordem-separacao"
                element={
                    <RotaProtegida permissao="col.imprimir_ordem">
                        <ImprimirOrdemSeparacao />
                    </RotaProtegida>
                }
            />
            <Route
                path="/separacao-erp"
                element={
                    <RotaProtegida permissao="col.separacao">
                        <SeparacaoErp />
                    </RotaProtegida>
                }
            />
            <Route
                path="/inventario"
                element={
                    <RotaProtegida permissao="col.inventario">
                        <Inventario />
                    </RotaProtegida>
                }
            />
            <Route
                path="/picking"
                element={
                    <RotaProtegida permissao="col.picking">
                        <Picking />
                    </RotaProtegida>
                }
            />
            <Route
                path="/nf-importacao"
                element={
                    <RotaProtegida permissao="col.nf_importacao">
                        <NfImportacao />
                    </RotaProtegida>
                }
            />
            <Route
                path="/nf-devolucao"
                element={
                    <RotaProtegida permissao="col.nf_devolucao">
                        <NfDevolucao />
                    </RotaProtegida>
                }
            />
            <Route
                path="/conferencia-erp"
                element={
                    <RotaProtegida permissao="col.conferencia">
                        <ConferenciaErp />
                    </RotaProtegida>
                }
            />
            <Route
                path="/reimprimir-etiquetas"
                element={
                    <RotaProtegida permissao="col.reimprimir">
                        <ReimprimirEtiquetas />
                    </RotaProtegida>
                }
            />
            <Route
                path="/pulmao"
                element={
                    <RotaProtegida permissao="col.pulmao">
                        <Pulmao />
                    </RotaProtegida>
                }
            />
            <Route
                path="/transferencia-deposito"
                element={
                    <RotaProtegida permissao="col.transferencia">
                        <TransferenciaDeposito />
                    </RotaProtegida>
                }
            />
            <Route
                path="/estoque-devolucao"
                element={
                    <RotaProtegida permissao="col.estoque_devolucao">
                        <EstoqueDevolucao />
                    </RotaProtegida>
                }
            />
        </Routes>
    );
}

export default function App() {
    return (
        <TemaProvider>
            <AuthProvider>
                <HashRouter>
                    <ConteudoApp />
                </HashRouter>
            </AuthProvider>
        </TemaProvider>
    );
}
