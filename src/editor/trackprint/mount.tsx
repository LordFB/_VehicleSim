import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

export function mountTrackPrintEditor(container: HTMLElement): void {
  container.replaceChildren();
  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
