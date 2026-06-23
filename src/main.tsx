import {StrictMode, Component, ErrorInfo, ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State;
  public props: Props;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Capturado por ErrorBoundary:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-zinc-950 text-zinc-100 font-sans">
          <div className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <h2 className="text-base font-semibold text-rose-400 flex items-center gap-2">
              🚨 Algo salió mal en VoiceCloner
            </h2>
            <p className="text-zinc-400 text-xs leading-relaxed">
              La interfaz de la aplicación ha experimentado un problema inesperado. Puede estar relacionado con las políticas de restricción del navegador o el entorno sandboxed del iframe.
            </p>
            <div className="p-3 bg-black/40 rounded-xl text-rose-300 font-mono text-[10px] overflow-auto max-h-40 leading-relaxed border border-white/5">
              {this.state.error?.stack || this.state.error?.toString() || "Error desconocido"}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-violet-600 hover:bg-violet-700 transition-all font-semibold text-xs py-2.5 rounded-xl text-white cursor-pointer"
            >
              Reiniciar Aplicación
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
