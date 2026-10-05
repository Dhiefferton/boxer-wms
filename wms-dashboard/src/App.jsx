import { HashRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import { TemaProvider } from './theme/TemaContext.jsx';
import { TituloPaginaProvider } from './contexts/TituloPaginaContext.jsx';
import Topbar from './components/Topbar.jsx';
import RotaProtegida from './components/RotaProtegida.jsx';
import Login from './pages/Login.jsx';
import TrocarSenha from './pages/TrocarSenha.jsx';
import MapaRuas from './pages/MapaRuas.jsx';
import Pedidos from './pages/Pedidos.jsx';
import Divergencias from './pages/Divergencias.jsx';
import Produtos from './pages/Produtos.jsx';
import ProdutosExcluidos from './pages/ProdutosExcluidos.jsx';
import CadastroProduto from './pages/CadastroProduto.jsx';
import EditarProduto from './pages/EditarProduto.jsx';
import EntradasManuais from './pages/EntradasManuais.jsx';
import Historico from './pages/Historico.jsx';
import Unidades from './pages/Unidades.jsx';
import ControleLote from './pages/ControleLote.jsx';
import Colaboradores from './pages/Colaboradores.jsx';
import CadastroColaborador from './pages/CadastroColaborador.jsx';
import EditarColaborador from './pages/EditarColaborador.jsx';
import ReposicaoKanban from './pages/ReposicaoKanban.jsx';
import EstoquePulmao from './pages/EstoquePulmao.jsx';
import Relatorios from './pages/Relatorios.jsx';
import PerfisFiscaisDevolucao from './pages/PerfisFiscaisDevolucao.jsx';
import PerfisSeparacao from './pages/PerfisSeparacao.jsx';
import Acessos from './pages/Acessos.jsx';

function ConteudoApp() {
    const { colaborador, carregando } = useAuth();

    if (carregando) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                Carregando...
            </div>
        );
    }

    if (!colaborador) {
        return <Login />;
    }

    // Senha definida por um admin (cadastro novo ou reset) - obriga a
    // troca antes de liberar qualquer outra tela do sistema.
    if (colaborador.precisaTrocarSenha) {
        return <TrocarSenha obrigatorio />;
    }

    return (
        <TituloPaginaProvider>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            <Topbar />
            <main style={{ flex: 1, padding: '1.5rem 2rem' }}>
                <Routes>
                    <Route
                        path="/"
                        element={
                            <RotaProtegida permissao="dash.mapa">
                                <MapaRuas />
                            </RotaProtegida>
                        }
                    />
                    <Route
                        path="/pedidos"
                        element={
                            <RotaProtegida permissao="dash.pedidos">
                                <Pedidos />
                            </RotaProtegida>
                        }
                    />
                    <Route
                        path="/divergencias"
                        element={
                            <RotaProtegida permissao="dash.divergencias">
                                <Divergencias />
                            </RotaProtegida>
                        }
                    />
                    <Route
                        path="/produtos"
                        element={
                            <RotaProtegida permissao="dash.produtos">
                                <Produtos />
                            </RotaProtegida>
                        }
                    />
                    <Route
                        path="/produtos/excluidos"
                        element={
                            <RotaProtegida permissao="dash.produtos">
                                <ProdutosExcluidos />
                            </RotaProtegida>
                        }
                    />
                    <Route
                        path="/produtos/novo"
                        element={
                            <RotaProtegida permissao="dash.produtos">
                                <CadastroProduto />
                            </RotaProtegida>
                        }
                    />
                    <Route
                        path="/produtos/:id/editar"
                        element={
                            <RotaProtegida permissao="dash.produtos">
                                <EditarProduto />
                            </RotaProtegida>
                        }
                    />
                    <Route
                        path="/entradas-manuais"
                        element={
                            <RotaProtegida permissao="dash.entradas_manuais">
                                <EntradasManuais />
                            </RotaProtegida>
                        }
                    />
                    <Route
                        path="/historico"
                        element={
                            <RotaProtegida permissao="dash.historico">
                                <Historico />
                            </RotaProtegida>
                        }
                    />
                    <Route
                        path="/relatorios"
                        element={
                            <RotaProtegida permissao="dash.relatorios">
                                <Relatorios />
                            </RotaProtegida>
                        }
                    />
                    <Route
                        path="/reposicao-kanban"
                        element={
                            <RotaProtegida permissao="dash.reposicao_kanban">
                                <ReposicaoKanban />
                            </RotaProtegida>
                        }
                    />
                    <Route
                        path="/estoque-pulmao"
                        element={
                            <RotaProtegida permissao="dash.estoque_pulmao">
                                <EstoquePulmao />
                            </RotaProtegida>
                        }
                    />
                    <Route
                        path="/unidades"
                        element={
                            <RotaProtegida permissao="dash.unidades">
                                <Unidades />
                            </RotaProtegida>
                        }
                    />
                    <Route
                        path="/controle-lote"
                        element={
                            <RotaProtegida permissao="dash.controle_lote">
                                <ControleLote />
                            </RotaProtegida>
                        }
                    />
                    <Route
                        path="/colaboradores"
                        element={
                            <RotaProtegida permissao="dash.colaboradores">
                                <Colaboradores />
                            </RotaProtegida>
                        }
                    />
                    <Route
                        path="/colaboradores/novo"
                        element={
                            <RotaProtegida permissao="dash.colaboradores">
                                <CadastroColaborador />
                            </RotaProtegida>
                        }
                    />
                    <Route
                        path="/colaboradores/:id/editar"
                        element={
                            <RotaProtegida permissao="dash.colaboradores">
                                <EditarColaborador />
                            </RotaProtegida>
                        }
                    />
                    <Route
                        path="/perfis-fiscais-devolucao"
                        element={
                            <RotaProtegida permissao="dash.perfis_fiscais">
                                <PerfisFiscaisDevolucao />
                            </RotaProtegida>
                        }
                    />
                    <Route
                        path="/perfis-separacao"
                        element={
                            <RotaProtegida permissao="dash.perfis_separacao">
                                <PerfisSeparacao />
                            </RotaProtegida>
                        }
                    />
                    <Route
                        path="/acessos"
                        element={
                            <RotaProtegida permissao="dash.acessos">
                                <Acessos />
                            </RotaProtegida>
                        }
                    />
                </Routes>
            </main>
        </div>
        </TituloPaginaProvider>
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
