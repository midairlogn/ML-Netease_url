import React from 'react';

export const Logo: React.FC<{ className?: string }> = ({ className }) => {
    return (
        <div className={`flex items-center gap-2 ${className}`}>
            <svg
                width="32"
                height="32"
                viewBox="0 0 32 32"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="text-white"
            >
                <path
                    d="M16 2L16 30"
                    stroke="url(#paint0_linear)"
                    strokeWidth="4"
                    strokeLinecap="round"
                />
                <path
                    d="M8 8L8 24"
                    stroke="url(#paint1_linear)"
                    strokeWidth="4"
                    strokeLinecap="round"
                />
                <path
                    d="M24 8L24 24"
                    stroke="url(#paint2_linear)"
                    strokeWidth="4"
                    strokeLinecap="round"
                />
                <defs>
                    <linearGradient
                        id="paint0_linear"
                        x1="16"
                        y1="2"
                        x2="16"
                        y2="30"
                        gradientUnits="userSpaceOnUse"
                    >
                        <stop stopColor="#8B5CF6" />
                        <stop offset="1" stopColor="#EC4899" />
                    </linearGradient>
                    <linearGradient
                        id="paint1_linear"
                        x1="8"
                        y1="8"
                        x2="8"
                        y2="24"
                        gradientUnits="userSpaceOnUse"
                    >
                        <stop stopColor="#EC4899" />
                        <stop offset="1" stopColor="#8B5CF6" />
                    </linearGradient>
                    <linearGradient
                        id="paint2_linear"
                        x1="24"
                        y1="8"
                        x2="24"
                        y2="24"
                        gradientUnits="userSpaceOnUse"
                    >
                        <stop stopColor="#EC4899" />
                        <stop offset="1" stopColor="#8B5CF6" />
                    </linearGradient>
                </defs>
            </svg>
            <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-400 tracking-tight">
                ML Netease
            </span>
        </div>
    );
};
