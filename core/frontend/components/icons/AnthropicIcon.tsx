import React from 'react';

export const AnthropicIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    {...props}
  >
    {/* Stylised "A" shape representing Anthropic */}
    <path d="M13.5 3h-3L4 21h3.5l1.4-4h6.2l1.4 4H20L13.5 3zm-3.7 11 2.2-6.4 2.2 6.4H9.8z" />
  </svg>
);
