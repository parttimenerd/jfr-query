import React from 'react';

export const ArrowsPointingInIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    {...props}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 9V4.5M9 9H4.5M9 9L4.5 4.5M9 15v4.5M9 15H4.5M9 15l-4.5 4.5M15 9V4.5M15 9h4.5M15 9l4.5-4.5M15 15v4.5M15 15h4.5M15 15l4.5 4.5"
    />
  </svg>
);