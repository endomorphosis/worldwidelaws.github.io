import React from 'react';
import ReactDOM from 'react-dom/client';
import Home from './AppStatic.tsx';
import './index.css';

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <Home />
    </React.StrictMode>,
  );
}
