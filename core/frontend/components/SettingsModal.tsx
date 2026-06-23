import React, { useState, useContext, useEffect, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom';
import { XMarkIcon } from './icons/XMarkIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { ExclamationTriangleIcon } from './icons/ExclamationTriangleIcon';
import { BeakerIcon } from './icons/BeakerIcon';
import { PlayIcon } from './icons/PlayIcon';
import { SettingsContext, Settings } from '../context/SettingsContext';
import { providerMetadataRegistry, providerFactoryRegistry } from '../services/AiService';
import { ModelDefinition, AiProviderType } from '../services/ai/IAiProvider';
import { CANDIDATES } from '../services/ml/candidates';
import * as EmbeddingService from '../services/ml/EmbeddingService';
import * as PlotGenerationService from '../services/ml/PlotGenerationService';
import { DataContext, DBState } from '../context/DuckDBContext';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TestStatus = 'untested' | 'testing' | 'success' | 'error';
interface TestResult {
    status: TestStatus;
    message: string;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { settings, saveSettings } = useContext(SettingsContext);
  const { mode, sourceType, serverCurrentFile, loadServerFile, dbState } = useContext(DataContext);
  const [localSettings, setLocalSettings] = useState<Settings>(settings);
  const [testResults, setTestResults] = useState<Partial<Record<AiProviderType, TestResult>>>({});
  const [newFilePath, setNewFilePath] = useState('');
  const [fileLoadError, setFileLoadError] = useState<string | null>(null);
  // Track which key value was last tested per provider to detect staleness
  const testedKeys = useRef<Partial<Record<AiProviderType, string>>>({});

  // Update local state when global settings change or modal opens
  useEffect(() => {
      if (isOpen) {
          setLocalSettings(settings);
      }
  }, [isOpen, settings]);

  // Reset test result when the key (or baseUrl for local) for that provider changes after a test
  useEffect(() => {
    const provider = localSettings.aiProvider;
    const apiKey = localSettings[`${provider}ApiKey` as keyof Settings] as string;
    const baseUrl = provider === 'local' ? (localSettings.localBaseUrl || '') : '';
    const testedVal = testedKeys.current[provider];
    const currentVal = `${apiKey}|${baseUrl}`;
    if (testedVal !== undefined && testedVal !== currentVal) {
        setTestResults(prev => {
            const next = { ...prev };
            delete next[provider];
            return next;
        });
        testedKeys.current[provider] = undefined;
    }
  }, [localSettings.aiProvider, localSettings.googleApiKey, localSettings.openaiApiKey, localSettings.gardenerApiKey, localSettings.localBaseUrl]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);


  if (!isOpen) return null;

  const handleSave = () => {
    saveSettings(localSettings);
    onClose();
    // AI service re-initializes automatically via App.tsx useEffect([settings]).
    // Only reload if switching to a completely different provider would require it,
    // but in practice the effect handles it — no full reload needed.
  };
  
  const handleProviderSelect = (provider: AiProviderType) => {
      const metadata = providerMetadataRegistry[provider];
      setLocalSettings(prev => ({ 
          ...prev, 
          aiProvider: provider,
          [`${provider}BasicModel`]: metadata.defaultModels.basic,
          [`${provider}GoodModel`]: metadata.defaultModels.advanced,
      }));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const { name, value } = e.target;
      setLocalSettings(prev => ({...prev, [name]: value }));
  };
  
  const handleTestKey = async () => {
      const provider = localSettings.aiProvider;
      const providerKey = `${provider}ApiKey` as keyof Settings;
      const apiKey = localSettings[providerKey] as string;

      // For non-local providers an API key is required; for local, the base URL
      // is what makes it "configured", and the key is optional.
      if (provider !== 'local' && !apiKey) {
          setTestResults(prev => ({ ...prev, [provider]: { status: 'error', message: 'API Key is missing' } }));
          return;
      }
      if (provider === 'local' && !localSettings.localBaseUrl) {
          setTestResults(prev => ({ ...prev, [provider]: { status: 'error', message: 'Base URL is missing' } }));
          return;
      }

      setTestResults(prev => ({ ...prev, [provider]: { status: 'testing', message: 'Verifying...' } }));

      try {
          const factory = providerFactoryRegistry[provider];
          const instance = factory(localSettings);
          const success = await instance.verifyCredentials();
          const testedVal = `${apiKey}|${provider === 'local' ? (localSettings.localBaseUrl || '') : ''}`;
          if (success) {
              testedKeys.current[provider] = testedVal;
              setTestResults(prev => ({ ...prev, [provider]: { status: 'success', message: 'Verified' } }));
          } else {
              throw new Error("Verification returned false");
          }
      } catch (error: any) {
          const testedVal = `${apiKey}|${provider === 'local' ? (localSettings.localBaseUrl || '') : ''}`;
          testedKeys.current[provider] = testedVal;
          setTestResults(prev => ({ ...prev, [provider]: { status: 'error', message: error.message || 'Verification failed' } }));
      }
  };

  const currentProviderMeta = providerMetadataRegistry[localSettings.aiProvider];
  const currentApiKeyName = `${localSettings.aiProvider}ApiKey`;
  const currentApiKeyValue = (localSettings as any)[currentApiKeyName];
  const currentTestResult = testResults[localSettings.aiProvider];

  // Detect if the current key came from an environment variable
  const envVarNames: Record<AiProviderType, string> = {
      google: 'GEMINI_API_KEY',
      openai: 'OPENAI_API_KEY',
      gardener: 'GARDENER_API_KEY',
      local: 'LOCAL_AI_API_KEY',
      browser: '',
  };
  const envVarValues: Record<AiProviderType, string | undefined> = {
      google: process.env.GEMINI_API_KEY || process.env.API_KEY,
      openai: process.env.OPENAI_API_KEY,
      gardener: process.env.GARDENER_API_KEY,
      local: process.env.LOCAL_AI_API_KEY,
      browser: undefined,
  };
  const currentEnvValue = envVarValues[localSettings.aiProvider];
  const isFromEnvVar = !!(currentEnvValue && currentApiKeyValue === currentEnvValue);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
  };

  return ReactDOM.createPortal(
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={handleBackdropClick}>
      <div className="bg-gray-800 border border-gray-700 rounded-lg shadow-2xl w-full max-w-4xl flex flex-col animate-fade-in max-h-[90vh]">
        <header className="flex-shrink-0 p-4 border-b border-gray-700 flex justify-between items-center">
          <h2 className="text-xl font-semibold text-gray-200">Settings</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-700 rounded-full">
            <XMarkIcon className="w-6 h-6" />
          </button>
        </header>
        
        <div className="flex-grow overflow-y-auto p-6 space-y-8">
            
            {/* Provider Selection */}
            <section>
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">AI Provider</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {(Object.keys(providerMetadataRegistry) as AiProviderType[]).map(key => {
                        const meta = providerMetadataRegistry[key];
                        const isSelected = localSettings.aiProvider === key;
                        const Icon = meta.icon;
                        return (
                            <button
                                key={key}
                                onClick={() => handleProviderSelect(key)}
                                className={`flex flex-col items-center p-4 rounded-lg border transition-all ${isSelected ? 'bg-cyan-900/20 border-cyan-500 ring-1 ring-cyan-500' : 'bg-gray-700/50 border-gray-600 hover:bg-gray-700'}`}
                            >
                                <Icon className={`w-8 h-8 mb-2 ${isSelected ? 'text-cyan-400' : 'text-gray-400'}`} />
                                <span className={`font-semibold ${isSelected ? 'text-white' : 'text-gray-300'}`}>{meta.name}</span>
                                <span className="text-xs text-gray-500 mt-1 text-center">{meta.description}</span>
                            </button>
                        );
                    })}
                </div>
            </section>

            {/* Credentials */}
            <section className="bg-gray-900/30 p-4 rounded-lg border border-gray-700">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Credentials for {currentProviderMeta.name}</h3>
                <div className="space-y-4">
                    {/* Base URL for local servers */}
                    {localSettings.aiProvider === 'local' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">Base URL</label>
                            <input
                                type="url"
                                name="localBaseUrl"
                                value={localSettings.localBaseUrl}
                                onChange={handleInputChange}
                                className="w-full bg-gray-800 border border-gray-600 rounded-md p-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500"
                                placeholder="http://localhost:8080"
                                pattern="https?://.+"
                                title="Must be a valid http:// or https:// URL"
                            />
                            {localSettings.localBaseUrl && !/^https?:\/\/.+/.test(localSettings.localBaseUrl) && (
                                <p className="text-xs text-red-400 mt-1">Must start with http:// or https://</p>
                            )}
                            <p className="text-xs text-gray-500 mt-1">
                                Any OpenAI-compatible <code className="font-mono">/v1/chat/completions</code> server.
                                Tested with llama.cpp <code className="font-mono">llama-server</code> (:8080), Ollama (:11434), vLLM, LM Studio.
                            </p>
                        </div>
                    )}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                            API Key
                            {localSettings.aiProvider === 'local' && <span className="text-xs text-gray-500 ml-2 font-normal">(optional — leave blank for unauthenticated local servers)</span>}
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="password"
                                name={currentApiKeyName}
                                value={currentApiKeyValue}
                                onChange={handleInputChange}
                                className="flex-grow bg-gray-800 border border-gray-600 rounded-md p-2 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
                                placeholder={localSettings.aiProvider === 'local' ? 'Optional' : `Enter your ${currentProviderMeta.name} API Key`}
                            />
                            <button
                                onClick={handleTestKey}
                                disabled={
                                    (localSettings.aiProvider !== 'local' && !currentApiKeyValue) ||
                                    (localSettings.aiProvider === 'local' && (!localSettings.localBaseUrl || !/^https?:\/\/.+/.test(localSettings.localBaseUrl))) ||
                                    currentTestResult?.status === 'testing'
                                }
                                className={`px-3 py-2 rounded-md flex items-center gap-2 transition-colors ${currentTestResult?.status === 'success' ? 'bg-green-900/30 text-green-400 border border-green-600' : currentTestResult?.status === 'error' ? 'bg-red-900/30 text-red-400 border border-red-600' : 'bg-gray-700 hover:bg-gray-600 text-gray-200'}`}
                            >
                                {currentTestResult?.status === 'testing' ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"/> : <BeakerIcon className="w-4 h-4"/>}
                                {currentTestResult?.status === 'success' ? 'Verified' : currentTestResult?.status === 'error' ? 'Failed' : 'Test'}
                            </button>
                        </div>
                        {currentTestResult?.status === 'error' && <p className="text-xs text-red-400 mt-1">{currentTestResult.message}</p>}
                        {isFromEnvVar && (
                            <p className="text-xs text-cyan-500 mt-1 flex items-center gap-1">
                                <CheckCircleIcon className="w-3 h-3 flex-shrink-0" />
                                Loaded from <code className="font-mono bg-gray-800 px-1 rounded">{envVarNames[localSettings.aiProvider]}</code> environment variable
                            </p>
                        )}
                        {currentProviderMeta.isInternal && (
                            <div className="mt-2 flex items-start gap-2 text-yellow-500 bg-yellow-900/20 p-2 rounded text-xs">
                                <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                <p>This is an internal service. Ensure you are connected to the appropriate network/VPN.</p>
                            </div>
                        )}
                    </div>
                    {/* Local-only: max_tokens cap */}
                    {localSettings.aiProvider === 'local' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">Max Output Tokens</label>
                            <input
                                type="number"
                                name="localMaxTokens"
                                min="128"
                                max="32768"
                                step="128"
                                value={localSettings.localMaxTokens}
                                onChange={(e) => setLocalSettings(prev => ({ ...prev, localMaxTokens: Math.max(128, parseInt(e.target.value, 10) || 2048) }))}
                                className="w-full bg-gray-800 border border-gray-600 rounded-md p-2 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
                            />
                            <p className="text-xs text-gray-500 mt-1">
                                Cap output length to bound generation time on slow CPUs (default 2048).
                            </p>
                        </div>
                    )}
                </div>
            </section>

            {/* Data Source (server mode only) */}
            {mode === 'server' && (
                <section>
                    <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Data Source</h3>
                    <div className="space-y-3">
                        {serverCurrentFile && (
                            <p className="text-sm text-gray-300">
                                Current:{' '}
                                <span className="font-mono text-gray-200">{serverCurrentFile}</span>
                                {sourceType && (
                                    <span className={`ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${sourceType === 'jfr' ? 'border-cyan-700/60 text-cyan-400 bg-cyan-900/20' : 'border-blue-700/60 text-blue-400 bg-blue-900/20'}`}>
                                        {sourceType === 'jfr' ? 'JFR' : 'DuckDB'}
                                    </span>
                                )}
                            </p>
                        )}
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={newFilePath}
                                onChange={e => { setNewFilePath(e.target.value); setFileLoadError(null); }}
                                placeholder="/path/to/recording.jfr or mydb.duckdb"
                                className="flex-grow bg-gray-800 border border-gray-600 rounded-md p-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500"
                            />
                            <button
                                onClick={async () => {
                                    if (!newFilePath.trim()) return;
                                    setFileLoadError(null);
                                    try {
                                        await loadServerFile(newFilePath.trim());
                                        setNewFilePath('');
                                    } catch (e: any) {
                                        setFileLoadError(e.message || 'Load failed');
                                    }
                                }}
                                disabled={!newFilePath.trim() || dbState === DBState.IMPORTING}
                                className="px-3 py-2 text-sm rounded-md bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors whitespace-nowrap"
                            >
                                {dbState === DBState.IMPORTING ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"/> : 'Load'}
                            </button>
                        </div>
                        {fileLoadError && (
                            <p className="text-xs text-red-400">{fileLoadError}</p>
                        )}
                        <p className="text-xs text-gray-500">Enter a server-side path to a .jfr or .duckdb file to hot-reload without restarting the server.</p>
                    </div>
                </section>
            )}

            {/* Display */}
            <section>
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Display</h3>
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Display</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Time Format</label>
                        <p className="text-xs text-gray-500 mb-2">How timestamps are displayed in tables and charts.</p>
                        <select
                            name="timeFormat"
                            value={localSettings.timeFormat}
                            onChange={handleInputChange}
                            className="w-full bg-gray-800 border border-gray-600 rounded-md p-2 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
                        >
                            <option value="HH:mm:ss.SS">HH:mm:ss.SS (default)</option>
                            <option value="HH:mm:ss">HH:mm:ss</option>
                            <option value="HH:mm:ss.SSS">HH:mm:ss.SSS (ms precision)</option>
                            <option value="yyyy-MM-dd HH:mm:ss">yyyy-MM-dd HH:mm:ss</option>
                            <option value="ISO">ISO 8601</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Decimal Places</label>
                        <p className="text-xs text-gray-500 mb-2">Significant digits shown for numeric values.</p>
                        <input
                            type="number"
                            name="decimalPlaces"
                            min="0"
                            max="12"
                            value={localSettings.decimalPlaces}
                            onChange={(e) => setLocalSettings(prev => ({ ...prev, decimalPlaces: Math.max(0, Math.min(12, parseInt(e.target.value, 10) || 0)) }))}
                            className="w-full bg-gray-800 border border-gray-600 rounded-md p-2 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
                        />
                    </div>
                </div>
            </section>

            {/* Model Config */}
            <section>
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Model Configuration</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Basic Model</label>
                        <p className="text-xs text-gray-500 mb-2">Used for formatting, simple suggestions, and fast tasks.</p>
                        {localSettings.aiProvider === 'local' ? (
                            <>
                                <input
                                    list="local-model-options"
                                    name="localBasicModel"
                                    value={localSettings.localBasicModel}
                                    onChange={handleInputChange}
                                    className="w-full bg-gray-800 border border-gray-600 rounded-md p-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500"
                                    placeholder="e.g. qwen3:1.7b"
                                />
                            </>
                        ) : (
                            <select
                                name={`${localSettings.aiProvider}BasicModel`}
                                value={(localSettings as any)[`${localSettings.aiProvider}BasicModel`]}
                                onChange={handleInputChange}
                                className="w-full bg-gray-800 border border-gray-600 rounded-md p-2 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
                            >
                                {currentProviderMeta.models.map(m => (
                                    <option key={m.id} value={m.id}>{m.name} {m.group ? `(${m.group})` : ''}</option>
                                ))}
                            </select>
                        )}
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Advanced Model</label>
                        <p className="text-xs text-gray-500 mb-2">Used for complex reasoning, SQL generation, and plot suggestions.</p>
                        {localSettings.aiProvider === 'local' ? (
                            <input
                                list="local-model-options"
                                name="localGoodModel"
                                value={localSettings.localGoodModel}
                                onChange={handleInputChange}
                                className="w-full bg-gray-800 border border-gray-600 rounded-md p-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500"
                                placeholder="e.g. qwen3:9b"
                            />
                        ) : (
                            <select
                                name={`${localSettings.aiProvider}GoodModel`}
                                value={(localSettings as any)[`${localSettings.aiProvider}GoodModel`]}
                                onChange={handleInputChange}
                                className="w-full bg-gray-800 border border-gray-600 rounded-md p-2 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
                            >
                                {currentProviderMeta.models.map(m => (
                                    <option key={m.id} value={m.id}>{m.name} {m.group ? `(${m.group})` : ''}</option>
                                ))}
                            </select>
                        )}
                    </div>
                </div>
                {localSettings.aiProvider === 'local' && (
                    <>
                        <datalist id="local-model-options">
                            {currentProviderMeta.models.map(m => (
                                <option key={m.id} value={m.id}>{m.description}</option>
                            ))}
                        </datalist>
                        <p className="text-xs text-gray-500 mt-3">
                            Type any model id served by your endpoint. The Basic model is used for fast tasks (formatting, plot fixes); the Advanced model handles agent chat and inline edits.
                            For best results with 9B-class quantized models (Qwen3, Llama 3), use a server with GPU offload.
                        </p>
                    </>
                )}
                {localSettings.aiProvider === 'browser' && (
                    <BrowserModelPicker
                        modelId={localSettings.browserModelId}
                        onChange={(id) => setLocalSettings(prev => ({ ...prev, browserModelId: id }))}
                    />
                )}
            </section>
        </div>

        <footer className="flex-shrink-0 p-4 border-t border-gray-700 flex justify-end items-center">
            <div className="flex gap-3">
                <button onClick={onClose} className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-md text-gray-200 transition-colors">Cancel</button>
                <button onClick={handleSave} className="px-4 py-2 text-sm bg-cyan-600 hover:bg-cyan-700 rounded-md font-semibold text-white shadow-lg shadow-cyan-900/20 transition-colors">Save & Reload</button>
            </div>
        </footer>
      </div>
    </div>,
    document.body
  );
};

const BrowserModelPicker: React.FC<{ modelId: string; onChange: (id: string) => void }> = ({
    modelId,
    onChange,
}) => {
    const [embReady, setEmbReady] = useState(EmbeddingService.isReady());
    const [genReady, setGenReady] = useState(PlotGenerationService.isModelReady(modelId));
    const [downloading, setDownloading] = useState(false);
    const [progress, setProgress] = useState(0);

    const handleDownload = async () => {
        setDownloading(true);
        setProgress(0);
        try {
            await EmbeddingService.ensureLoaded();
            setEmbReady(true);
            await PlotGenerationService.ensureModelLoaded(modelId, (loaded, total) => {
                setProgress(total > 0 ? Math.round((loaded / total) * 100) : 0);
            });
            setGenReady(true);
        } catch (err) {
            console.error('Browser model download failed:', err);
        } finally {
            setDownloading(false);
        }
    };

    return (
        <div className="mt-4 space-y-3">
            <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Plot Config Model</label>
                <p className="text-xs text-gray-500 mb-2">Choose which model generates plot configurations. Only affects "Suggest Plot" — chat requires a cloud or local provider.</p>
                <select
                    value={modelId}
                    onChange={e => onChange(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-600 rounded-md p-2 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
                >
                    {Object.values(CANDIDATES).map(c => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                </select>
            </div>
            <div className="flex items-center gap-4">
                <button
                    onClick={handleDownload}
                    disabled={downloading || (embReady && genReady)}
                    className="px-3 py-2 text-sm rounded-md bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-gray-200 transition-colors"
                >
                    {downloading ? `Downloading… ${progress}%` : embReady && genReady ? 'Ready' : 'Download models'}
                </button>
                <div className="text-xs text-gray-500 flex gap-3">
                    <span className={embReady ? 'text-green-400' : 'text-gray-500'}>
                        {embReady ? '✓' : '○'} MiniLM (autocomplete, ~6MB)
                    </span>
                    <span className={genReady ? 'text-green-400' : 'text-gray-500'}>
                        {genReady ? '✓' : '○'} Plot model ({CANDIDATES[modelId]?.approxSizeMb ?? '?'}MB)
                    </span>
                </div>
            </div>
            {downloading && progress > 0 && (
                <div className="w-full bg-gray-700 rounded-full h-1.5">
                    <div
                        className="bg-cyan-500 h-1.5 rounded-full transition-all"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            )}
        </div>
    );
};

export default SettingsModal;
