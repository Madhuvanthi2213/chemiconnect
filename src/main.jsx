import React from 'react';import {createRoot} from 'react-dom/client';import App from './App.jsx';import './styles.css';
createRoot(document.getElementById('root')).render(<App/>);

// Lets the app open with no internet after it has been opened once online (needs https or localhost; production build only).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* app still works online */ }); });
}
