interface FilaLogoProps {
  size?: 'sm' | 'md' | 'lg';
  variant?: 'gradient' | 'light';
  className?: string;
}

const heights = {
  sm: 'h-20',
  md: 'h-24',
  lg: 'h-28',
};

const srcs = {
  gradient: '/Fila_Gradient_Transparent.png',
  light:    '/Fila_Light_Transparent.png',
};

export function FilaLogo({ size = 'md', variant = 'gradient', className }: FilaLogoProps) {
  return (
    <img
      src={srcs[variant]}
      alt="Fila"
      className={`${heights[size]} w-auto object-contain ${className ?? ''}`}
    />
  );
}
