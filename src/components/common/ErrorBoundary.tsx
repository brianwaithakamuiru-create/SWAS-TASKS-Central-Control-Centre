import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || 'An unexpected error occurred in the administration console.',
    };
  }

  override render() {
    if (this.state.hasError) {
      let parsedError = this.state.errorMessage;
      try {
        const obj = JSON.parse(this.state.errorMessage) as {
          error?: string;
          operationType?: string;
          path?: string;
        };
        if (obj.error && obj.operationType) {
          parsedError = `${obj.operationType.toUpperCase()} on '${obj.path || 'unknown'}': ${obj.error}`;
        }
      } catch {
        // plain error string
      }

      return (
        <div className="min-h-screen bg-[#F3F6FA] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-slate-200 rounded-lg p-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-[#D34552] shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-[#172B46]">
                  Control Centre Exception Caught
                </h2>
                <p className="mt-2 text-sm text-[#75869D] break-words">{parsedError}</p>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#1265C8] hover:bg-[#102B50] rounded-md transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reload Workspace
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
