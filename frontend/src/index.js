import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './i18n';
import AppRouter from './AppRouter';
import reportWebVitals from './reportWebVitals';
import { initTokenStoreWithTimeout } from './tokenStore';
import { initNativeShell } from './nativeShell';

const root = ReactDOM.createRoot(document.getElementById('root'));
initTokenStoreWithTimeout(3000).finally(() => {
  root.render(
    <React.StrictMode>
      <AppRouter />
    </React.StrictMode>
  );
});

initNativeShell().catch(() => {});

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
