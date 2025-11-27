import React from 'react';
import { cn } from './Button';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> { }

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
    ({ className, ...props }, ref) => {
        return (
            <div
                ref={ref}
                className={cn(
                    'rounded-2xl glass-dark shadow-xl border-white/10',
                    className
                )}
                {...props}
            />
        );
    }
);

Card.displayName = 'Card';
