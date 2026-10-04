import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);

// PWA: registra o service worker (cache do app shell) só no build de
// produção - em `npm run dev` ele atrapalharia o hot reload com cache velho.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {
            // sem service worker o app continua funcionando normal, só não instala/cacheia
        });
    });
}
