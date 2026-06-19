import React from 'react';

export const MarkdownIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    {...props}
  >
    {/* Outer rectangle */}
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.75 4.5h16.5a1.5 1.5 0 011.5 1.5v12a1.5 1.5 0 01-1.5 1.5H3.75a1.5 1.5 0 01-1.5-1.5v-12a1.5 1.5 0 011.5-1.5z"
    />
    {/* 'M' shape */}
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M8.25 15v-6l2.25 2.25L12.75 9v6"
    />
    {/* Down arrow */}
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15 12.75l1.5-1.5 1.5 1.5"
    />
  </svg>
);
