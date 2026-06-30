import { Component } from 'react';
import { createErrorBoundaryState } from '../lib/errorBoundaryState.js';

export class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return createErrorBoundaryState(error);
  }

  componentDidCatch(error, info) {
    console.error('App render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="app-error-boundary">
          <div className="app-error-boundary-panel">
            <div className="app-error-boundary-title">Interface crashed</div>
            <div className="app-error-boundary-message">{this.state.message}</div>
            <button type="button" className="btn" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
