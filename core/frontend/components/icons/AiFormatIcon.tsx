import React from 'react';

export const AiFormatIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <g>
        {/* Base DocumentFormattingIcon paths */}
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 7.5h7.5m-7.5 3h7.5m-7.5 3h3.75m-3.75 3h3.75" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 6.75A2.25 2.25 0 015.25 4.5h13.5A2.25 2.25 0 0121 6.75v10.5A2.25 2.25 0 0118.75 19.5H5.25A2.25 2.25 0 013 17.25V6.75z" />
    </g>
    {/* Tiny sparkle in top-left, drawn with absolute coordinates */}
    <path 
        strokeWidth={0}
        fill="currentColor" 
        className="text-yellow-400"
        d="M 4 1.5 L 5 3.5 L 7 4.5 L 5 5.5 L 4 7.5 L 3 5.5 L 1 4.5 L 3 3.5 Z" 
    />
  </svg>
);
