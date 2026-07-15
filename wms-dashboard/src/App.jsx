import { HashRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import MapaRuas from './pages/MapaRuas.jsx';
import Pedidos from './pages/Pedidos.jsx';
import Divergencias from './pages/Divergencias.jsx';
import Produtos from './pages/Produtos.jsx';
import AreasFlutuante from './pages/AreasFlutuante.jsx';
import CadastroEnderecos from './pages/CadastroEnderecos.jsx';
import EntradasManuais from './pages/EntradasManuais.jsx';

export default function App() {
    return (
        <HashRouter>
            <div style={{ display: 'flex' }}>
                <Sidebar />
                <main style={{ flex: 1, padding: '1.5rem 2rem' }}>
                    <Routes>
                        <Route path="/" element={<MapaRuas />} />
                        <Route path="/pedidos" element={<Pedidos />} />
                        <Route path="/divergencias" element={<Divergencias />} />
                        <Route path="/produtos" element={<Produtos />} />
                        <Route path="/areas-flutuante" element={<AreasFlutuante />} />
                        <Route path="/cadastro-enderecos" element={<CadastroEnderecos />} />
                        <Route path="/entradas-manuais" element={<EntradasManuais />} />
                    </Routes>
                </main>
            </div>
        </HashRouter>
    );
}
