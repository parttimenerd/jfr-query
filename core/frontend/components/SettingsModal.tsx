
import React, { useState, useContext, useEffect, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom';
import { XMarkIcon } from './icons/XMarkIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { ExclamationTriangleIcon } from './icons/ExclamationTriangleIcon';
import { BeakerIcon } from './icons/BeakerIcon';
import { PlayIcon } from './icons/PlayIcon';
import { SettingsContext, Settings } from '../context/SettingsContext';
import { providerMetadataRegistry, providerRegistry } from '../services/AiService';
import { ModelDefinition, AiProviderType } from '../services/ai/IAiProvider';

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
  const [localSettings, setLocalSettings] = useState<Settings>(settings);
  const [testResults, setTestResults] = useState<Partial<Record<AiProviderType, TestResult>>>({});
  // Track which key value was last tested per provider to detect staleness
  const testedKeys = useRef<Partial<Record<AiProviderType, string>>>({});

  // Update local state when global settings change or modal opens
  useEffect(() => {
      if (isOpen) {
          setLocalSettings(settings);
      }
  }, [isOpen, settings]);

  // Reset test result when the key for that provider changes after a test
  useEffect(() => {
    const provider = localSettings.aiProvider;
    const apiKey = localSettings[`${provider}ApiKey` as keyof Settings] as string;
    const lastTested = testedKeys.current[provider];
    if (lastTested !== undefined && lastTested !== apiKey) {
        setTestResults(prev => {
            const next = { ...prev };
            delete next[provider];
            return next;
        });
        testedKeys.current[provider] = undefined;
    }
  }, [localSettings.aiProvider, localSettings.googleApiKey, localSettings.openaiApiKey, localSettings.gardenerApiKey]);


  if (!isOpen) return null;

  const handleSave = () => {
    saveSettings(localSettings);
    onClose();
    // Reload to ensure all services re-initialize with new keys/settings
    window.location.reload();
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
      const ProviderClass = providerRegistry[provider];

      if (!apiKey) {
          setTestResults(prev => ({ ...prev, [provider]: { status: 'error', message: 'API Key is missing' } }));
          return;
      }

      setTestResults(prev => ({ ...prev, [provider]: { status: 'testing', message: 'Verifying...' } }));

      try {
          const instance = new ProviderClass(apiKey);
          const success = await instance.verifyCredentials();
          if (success) {
              testedKeys.current[provider] = apiKey;
              setTestResults(prev => ({ ...prev, [provider]: { status: 'success', message: 'Valid API Key' } }));
          } else {
              throw new Error("Verification returned false");
          }
      } catch (error: any) {
          testedKeys.current[provider] = apiKey;
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
  };
  const envVarValues: Record<AiProviderType, string | undefined> = {
      google: process.env.GEMINI_API_KEY || process.env.API_KEY,
      openai: process.env.OPENAI_API_KEY,
      gardener: process.env.GARDENER_API_KEY,
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
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">API Key</label>
                        <div className="flex gap-2">
                            <input 
                                type="password" 
                                name={currentApiKeyName}
                                value={currentApiKeyValue}
                                onChange={handleInputChange}
                                className="flex-grow bg-gray-800 border border-gray-600 rounded-md p-2 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
                                placeholder={`Enter your ${currentProviderMeta.name} API Key`}
                            />
                            <button 
                                onClick={handleTestKey}
                                disabled={!currentApiKeyValue || currentTestResult?.status === 'testing'}
                                className={`px-3 py-2 rounded-md flex items-center gap-2 transition-colors ${currentTestResult?.status === 'success' ? 'bg-green-900/30 text-green-400 border border-green-600' : currentTestResult?.status === 'error' ? 'bg-red-900/30 text-red-400 border border-red-600' : 'bg-gray-700 hover:bg-gray-600 text-gray-200'}`}
                            >
                                {currentTestResult?.status === 'testing' ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"/> : <BeakerIcon className="w-4 h-4"/>}
                                {currentTestResult?.status === 'success' ? 'Verified' : currentTestResult?.status === 'error' ? 'Failed' : 'Test Key'}
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
                </div>
            </section>

            {/* Model Config */}
            <section>
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Model Configuration</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Basic Model</label>
                        <p className="text-xs text-gray-500 mb-2">Used for formatting, simple suggestions, and fast tasks.</p>
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
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Advanced Model</label>
                        <p className="text-xs text-gray-500 mb-2">Used for complex reasoning, SQL generation, and plot suggestions.</p>
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
                    </div>
                </div>
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

export default SettingsModal;
