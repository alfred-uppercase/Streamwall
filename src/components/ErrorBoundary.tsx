import React from 'react';
import { AlertTriangle, Home, RotateCw } from 'lucide-react';
import { reportClientError } from '../lib/errorReporter';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class AppErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error?.message || 'Erreur de rendu inattendue',
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    reportClientError({
      level: 'fatal',
      message: error?.message || 'React ErrorBoundary catch',
      stack: error?.stack || null,
      context: {
        kind: 'react.ErrorBoundary',
        componentStack: errorInfo?.componentStack?.slice(0, 1500) || null,
      },
    });
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-4 grid size-14 place-items-center rounded-2xl border border-primary/30 bg-primary/10 text-primary">
          <AlertTriangle className="size-7" />
        </div>
        <h1 className="font-display text-2xl font-bold text-foreground">
          Une erreur d’affichage est survenue
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          L’incident a été enregistré automatiquement afin de faciliter sa correction. Vous pouvez
          recharger la page ou revenir à l’accueil.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            <RotateCw className="size-4" />
            <span>Recharger la page</span>
          </button>
          <a
            href="/"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-accent"
          >
            <Home className="size-4" />
            <span>Retour à l’accueil</span>
          </a>
        </div>
      </main>
    );
  }
}
