import { HashRouter, Routes, Route } from 'react-router-dom';
import Menu from './pages/Menu.jsx';
import Separacao from './pages/Separacao.jsx';
import Reposicao from './pages/Reposicao.jsx';
import Recebimento from './pages/Recebimento.jsx';
import Inventario from './pages/Inventario.jsx';

export default function App() {
    return (
        <HashRouter>
            <Routes>
                <Route path="/" element={<Menu />} />
                <Route path="/separacao" element={<Separacao />} />
                <Route path="/reposicao" element={<Reposicao />} />
                <Route path="/recebimento" element={<Recebimento />} />
                <Route path="/inventario" element={<Inventario />} />
            </Routes>
        </HashRouter>
    );
}
