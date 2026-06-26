import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { DataProvider } from './context/DuckDBContext';
import { SettingsProvider } from './context/SettingsContext';
import { CellAliasProvider } from './context/CellAliasContext';
import { PlotSchemaProvider } from './components/editor/plot/schemaProvider';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <SettingsProvider>
        <DataProvider>
            <CellAliasProvider>
                <PlotSchemaProvider>
                    <App />
                </PlotSchemaProvider>
            </CellAliasProvider>
        </DataProvider>
    </SettingsProvider>
  </React.StrictMode>
);
