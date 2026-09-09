import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './ErrorBoundary';
import './index.css';

// Log (never crash) errors that happen while the Mini App is minimized in the
// background and gets restored via the Telegram status bar ("EcoHub сейчас").
window.addEventListener('error', (event) => {
  console.error('[EcoHub] global error:', event.error || event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('[EcoHub] unhandled rejection:', event.reason);
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
