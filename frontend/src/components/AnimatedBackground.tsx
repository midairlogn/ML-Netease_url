import React from 'react';

export const AnimatedBackground: React.FC = () => {
    return (
        <div className="fixed inset-0 -z-10 overflow-hidden">
            {/* Base gradient */}
            <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-black to-gray-900" />

            {/* Animated blob 1 - Purple */}
            <div
                className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-30 animate-blob animate-pulse-glow"
                style={{
                    background: 'radial-gradient(circle, rgba(139, 92, 246, 0.8) 0%, rgba(139, 92, 246, 0) 70%)',
                }}
            />

            {/* Animated blob 2 - Pink */}
            <div
                className="absolute top-1/2 right-1/4 w-[500px] h-[500px] rounded-full opacity-25 animate-blob-reverse animate-pulse-glow"
                style={{
                    background: 'radial-gradient(circle, rgba(236, 72, 153, 0.8) 0%, rgba(236, 72, 153, 0) 70%)',
                    animationDelay: '2s'
                }}
            />

            {/* Animated blob 3 - Blue */}
            <div
                className="absolute bottom-1/4 left-1/2 w-[450px] h-[450px] rounded-full opacity-20 animate-blob animate-pulse-glow"
                style={{
                    background: 'radial-gradient(circle, rgba(59, 130, 246, 0.8) 0%, rgba(59, 130, 246, 0) 70%)',
                    animationDelay: '4s'
                }}
            />

            {/* Animated blob 4 - Orange */}
            <div
                className="absolute top-2/3 right-1/3 w-[400px] h-[400px] rounded-full opacity-25 animate-blob-reverse animate-pulse-glow"
                style={{
                    background: 'radial-gradient(circle, rgba(249, 115, 22, 0.7) 0%, rgba(249, 115, 22, 0) 70%)',
                    animationDelay: '6s'
                }}
            />

            {/* Noise overlay for texture */}
            <div
                className="absolute inset-0 opacity-[0.015]"
                style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' /%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' /%3E%3C/svg%3E")`,
                }}
            />
        </div>
    );
};
