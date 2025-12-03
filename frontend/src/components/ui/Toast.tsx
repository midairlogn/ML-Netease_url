import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, AlertCircle, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
    id: string;
    type: ToastType;
    message: string;
}

interface ToastProps {
    toasts: ToastMessage[];
    onRemove: (id: string) => void;
}

export const ToastContainer: React.FC<ToastProps> = ({ toasts, onRemove }) => {
    return (
        <div className="fixed top-24 right-6 z-[100] flex flex-col gap-3 pointer-events-none">
            <AnimatePresence>
                {toasts.map((toast) => (
                    <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
                ))}
            </AnimatePresence>
        </div>
    );
};

const ToastItem: React.FC<{ toast: ToastMessage; onRemove: (id: string) => void }> = ({
    toast,
    onRemove,
}) => {
    useEffect(() => {
        const timer = setTimeout(() => {
            onRemove(toast.id);
        }, 3000);
        return () => clearTimeout(timer);
    }, [toast.id, onRemove]);

    return (
        <motion.div
            initial={{ opacity: 0, x: 50, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.9 }}
            layout
            className="pointer-events-auto min-w-[300px] bg-[#1c1c1e]/90 backdrop-blur-md border border-white/10 rounded-xl shadow-2xl p-4 flex items-start gap-3"
        >
            <div className="mt-0.5">
                {toast.type === 'success' && <CheckCircle size={20} className="text-green-400" />}
                {toast.type === 'error' && <AlertCircle size={20} className="text-red-400" />}
                {toast.type === 'info' && <AlertCircle size={20} className="text-blue-400" />}
            </div>
            <div className="flex-1">
                <h4 className="text-sm font-medium text-white">
                    {toast.type === 'success' ? 'Success' : toast.type === 'error' ? 'Error' : 'Info'}
                </h4>
                <p className="text-sm text-gray-400 mt-0.5 leading-relaxed">{toast.message}</p>
            </div>
            <button
                onClick={() => onRemove(toast.id)}
                className="text-gray-500 hover:text-white transition-colors"
            >
                <X size={16} />
            </button>
        </motion.div>
    );
};
