import React, { useState, useEffect } from 'react';
import { X, Save, Settings as SettingsIcon, AlertCircle } from 'lucide-react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';

interface SettingsProps {
    isOpen: boolean;
    onClose: () => void;
}

export const Settings: React.FC<SettingsProps> = ({ isOpen, onClose }) => {
    const [musicu, setMusicu] = useState('');
    const [apiBaseUrl, setApiBaseUrl] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (isOpen) {
            const storedMusicu = localStorage.getItem('musicu') || '';
            const storedApiBaseUrl = localStorage.getItem('apiBaseUrl') || 'https://music.163.com/api';
            setMusicu(storedMusicu);
            setApiBaseUrl(storedApiBaseUrl);
        }
    }, [isOpen]);

    const handleSave = () => {
        setIsSaving(true);
        try {
            localStorage.setItem('musicu', musicu);
            localStorage.setItem('apiBaseUrl', apiBaseUrl);
            // Optionally dispatch an event or use context to update API config immediately
            window.dispatchEvent(new Event('settings-updated'));
            onClose();
        } catch (error) {
            console.error('Failed to save settings:', error);
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="w-full max-w-lg mx-4 glass-dark rounded-2xl border border-white/10 shadow-2xl animate-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between p-6 border-b border-white/10">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-white/5">
                            <SettingsIcon className="text-white" size={20} />
                        </div>
                        <h2 className="text-xl font-bold text-white">Settings</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-300">
                                MUSIC_U Cookie
                            </label>
                            <Input
                                value={musicu}
                                onChange={(e) => setMusicu(e.target.value)}
                                placeholder="Enter your MUSIC_U cookie value..."
                                className="w-full font-mono text-sm"
                            />
                            <p className="text-xs text-gray-500">
                                Required for high quality audio and VIP songs.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-300">
                                API Base URL
                            </label>
                            <Input
                                value={apiBaseUrl}
                                onChange={(e) => setApiBaseUrl(e.target.value)}
                                placeholder="e.g., http://localhost:3000"
                                className="w-full font-mono text-sm"
                            />
                            <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                                <AlertCircle className="text-yellow-500 shrink-0 mt-0.5" size={14} />
                                <p className="text-xs text-yellow-200/80">
                                    Since this is a pure frontend app, you might need to set up a proxy or use a CORS-enabled API endpoint.
                                    Default: https://music.163.com/api (May require CORS extension)
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-end gap-3 p-6 border-t border-white/10 bg-white/5">
                    <Button
                        variant="ghost"
                        onClick={onClose}
                        className="text-gray-400 hover:text-white"
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="min-w-[100px]"
                    >
                        {isSaving ? (
                            'Saving...'
                        ) : (
                            <>
                                <Save className="mr-2" size={16} />
                                Save Changes
                            </>
                        )}
                    </Button>
                </div>
            </div>
        </div>
    );
};
