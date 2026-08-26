import { Component } from 'react';
import BrandMark from './components/BrandMark';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="px-6 py-8">
          <h1 className="mb-2">
            <BrandMark size="md" />
          </h1>
          <p className="type-body">Не удалось открыть экран. Обновите страницу.</p>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, marginTop: 12 }}>
            {String(this.state.error)}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
