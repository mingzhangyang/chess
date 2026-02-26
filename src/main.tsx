import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { I18nProvider } from './i18n/I18nContext';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const versionedServiceWorkerUrl = `/sw.js?v=${encodeURIComponent(__APP_BUILD_ID__)}`;
    void navigator.serviceWorker.register(versionedServiceWorkerUrl);
  });
}
