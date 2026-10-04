import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

// Leitura de código de barras / QR pela câmera do aparelho (celular,
// iPhone, coletor Android sem leitor a laser em mãos). Lê Code 128,
// EAN-13 e QR Code.
//
// COMO FUNCIONA:
//  - Se o navegador tem a Barcode Detection API nativa (Chrome/Edge no
//    Android) E ela suporta os 3 formatos, usa ela - é a mais rápida e
//    não baixa nada extra.
//  - Senão (Safari/iPhone, Firefox, Android antigo) cai pro @zxing/browser,
//    carregado sob demanda (import dinâmico) só na hora que a câmera abre.
//
// Esse componente NÃO tem lógica de negócio: só devolve o texto lido em
// onLer(codigo). Quem usa (BipagemInput) manda esse texto pro MESMO
// caminho da bipagem física, então busca/validação de produto não mudam.
//
// A câmera exige HTTPS (ou localhost) - em http:// puro o navegador nem
// libera o getUserMedia. No Vercel isso já é automático.

const FORMATOS_NATIVOS = ['code_128', 'ean_13', 'qr_code'];

const RESTRICOES_VIDEO = {
    audio: false,
    video: {
        facingMode: { ideal: 'environment' }, // câmera traseira
        width: { ideal: 1280 },
        height: { ideal: 720 },
    },
};

async function criarDetectorNativo() {
    if (!('BarcodeDetector' in window)) return null;
    try {
        const suportados = await window.BarcodeDetector.getSupportedFormats();
        if (!FORMATOS_NATIVOS.every((f) => suportados.includes(f))) return null;
        return new window.BarcodeDetector({ formats: FORMATOS_NATIVOS });
    } catch {
        return null;
    }
}

function mensagemDeErro(e) {
    switch (e?.name) {
        case 'NotAllowedError':
        case 'PermissionDeniedError':
            return 'Permissão da câmera negada. Libere o acesso à câmera nas configurações do navegador/app e tente de novo.';
        case 'NotFoundError':
        case 'DevicesNotFoundError':
        case 'OverconstrainedError':
            return 'Nenhuma câmera encontrada neste aparelho.';
        case 'NotReadableError':
        case 'TrackStartError':
            return 'A câmera está sendo usada por outro app. Feche-o e tente de novo.';
        default:
            return `Não foi possível abrir a câmera${e?.message ? `: ${e.message}` : '.'}`;
    }
}

export default function LeitorCamera({ onLer, onFechar }) {
    const videoRef = useRef(null);
    const onLerRef = useRef(onLer);
    onLerRef.current = onLer;
    const [erro, setErro] = useState(null);
    const [iniciando, setIniciando] = useState(true);

    useEffect(() => {
        let cancelado = false;
        let jaLeu = false;
        let parar = () => {};

        function entregar(codigo) {
            const limpo = (codigo || '').trim();
            if (cancelado || jaLeu || !limpo) return;
            jaLeu = true;
            if (navigator.vibrate) navigator.vibrate(60);
            onLerRef.current(limpo);
        }

        async function lerComNativo(detector) {
            const stream = await navigator.mediaDevices.getUserMedia(RESTRICOES_VIDEO);
            const video = videoRef.current;
            if (cancelado || !video) {
                stream.getTracks().forEach((t) => t.stop());
                return () => {};
            }
            video.srcObject = stream;
            await video.play().catch(() => {});
            let ativo = true;
            let ocupado = false;
            const intervalo = setInterval(async () => {
                if (!ativo || ocupado || video.readyState < 2) return;
                ocupado = true;
                try {
                    const achados = await detector.detect(video);
                    if (achados.length > 0) entregar(achados[0].rawValue);
                } catch {
                    // frame ruim - tenta de novo no próximo ciclo
                } finally {
                    ocupado = false;
                }
            }, 120);
            return () => {
                ativo = false;
                clearInterval(intervalo);
                stream.getTracks().forEach((t) => t.stop());
                video.srcObject = null;
            };
        }

        async function lerComZxing() {
            const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
                import('@zxing/browser'),
                import('@zxing/library'),
            ]);
            const hints = new Map();
            hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.EAN_13, BarcodeFormat.QR_CODE]);
            hints.set(DecodeHintType.TRY_HARDER, true);
            const leitor = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 100 });
            const controles = await leitor.decodeFromConstraints(RESTRICOES_VIDEO, videoRef.current, (resultado) => {
                if (resultado) entregar(resultado.getText());
            });
            if (cancelado) {
                controles.stop();
                return () => {};
            }
            return () => controles.stop();
        }

        async function iniciar() {
            if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
                setErro('A câmera só funciona em conexão segura (HTTPS). Abra o sistema pelo endereço https:// oficial.');
                setIniciando(false);
                return;
            }
            try {
                const detector = await criarDetectorNativo();
                if (cancelado) return;
                parar = detector ? await lerComNativo(detector) : await lerComZxing();
                if (!cancelado) setIniciando(false);
            } catch (e) {
                if (!cancelado) {
                    setErro(mensagemDeErro(e));
                    setIniciando(false);
                }
            }
        }

        iniciar();

        return () => {
            cancelado = true;
            parar();
        };
    }, []);

    useEffect(() => {
        function aoTeclar(e) {
            if (e.key === 'Escape') onFechar();
        }
        document.addEventListener('keydown', aoTeclar);
        return () => document.removeEventListener('keydown', aoTeclar);
    }, [onFechar]);

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Leitor de código de barras pela câmera"
            style={{
                position: 'fixed', inset: 0, zIndex: 1000, background: '#000',
                display: 'flex', flexDirection: 'column',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', color: '#fff' }}>
                <strong style={{ fontFamily: 'var(--font-display)' }}>Ler com a câmera</strong>
                <button
                    onClick={onFechar}
                    aria-label="Fechar câmera"
                    style={{
                        width: 44, minHeight: 44, height: 44, padding: 0, display: 'flex', alignItems: 'center',
                        justifyContent: 'center', background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none',
                    }}
                >
                    <X size={24} />
                </button>
            </div>

            <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                <video
                    ref={videoRef}
                    playsInline
                    muted
                    autoPlay
                    style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#000' }}
                />
                {!erro && (
                    <div
                        style={{
                            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                            width: '78%', maxWidth: 360, aspectRatio: '3 / 2', border: '2px solid rgba(255,255,255,0.85)',
                            borderRadius: 16, boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)', pointerEvents: 'none',
                        }}
                    />
                )}
                {erro && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                        <p style={{ color: '#fff', textAlign: 'center', fontSize: 16, lineHeight: 1.45, margin: 0 }}>{erro}</p>
                    </div>
                )}
            </div>

            <p style={{ color: 'rgba(255,255,255,0.85)', textAlign: 'center', fontSize: 14, margin: 0, padding: '14px 16px calc(14px + env(safe-area-inset-bottom))' }}>
                {erro ? '' : iniciando ? 'Abrindo a câmera...' : 'Aponte para o código de barras ou QR code'}
            </p>
        </div>
    );
}
