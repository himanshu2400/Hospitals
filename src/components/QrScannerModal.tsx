import { useEffect, useRef, useState } from 'react';
import { X, AlertCircle, Camera, Loader2 } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';

type Props = {
  onScan: (url: string) => void;
  onClose: () => void;
};

export function QrScannerModal({ onScan, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    let mounted = true;
    const elementId = 'qr-reader-container';

    async function startScanner() {
      try {
        const scanner = new Html5Qrcode(elementId);
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => {
            if (!mounted) return;
            scanner.stop().catch(() => {});
            onScan(decodedText);
          },
          () => {},
        );
        if (!mounted) {
          scanner.stop().catch(() => {});
          return;
        }
        setStarting(false);
      } catch (err) {
        if (!mounted) return;
        setStarting(false);
        setError(
          err instanceof Error
            ? err.message
            : 'Could not access camera. Check permissions or use the paste link option below.',
        );
      }
    }

    startScanner();

    return () => {
      mounted = false;
      const scanner = scannerRef.current;
      if (scanner) {
        scanner.stop().catch(() => {});
        scanner.clear();
      }
    };
  }, [onScan]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm px-4 fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl ring-1 ring-slate-200 p-6 max-w-sm w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-900 flex items-center gap-2">
            <Camera className="w-5 h-5" />
            Scan QR code
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {starting && !error && (
          <div className="flex flex-col items-center py-10 text-slate-500">
            <Loader2 className="w-6 h-6 animate-spin mb-2" />
            <p className="text-sm">Starting camera…</p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!error && (
          <div id="qr-reader-container" ref={containerRef} className="rounded-xl overflow-hidden" />
        )}

        <p className="text-xs text-slate-400 text-center mt-3">
          Point your camera at the doctor's queue QR code.
        </p>
      </div>
    </div>
  );
}
