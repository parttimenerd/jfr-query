import React from 'react';

export const FunctionIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
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
      d="M16.5 6.375a5.25 5.25 0 00-5.25-5.25H8.25a5.25 5.25 0 00-5.25 5.25v1.5A5.25 5.25 0 008.25 15h2.25a5.25 5.25 0 005.25-5.25v-1.5m-5.25 0V3.75m0 3.75H3.75m12.75 0h3.75"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.5 12.75a5.25 5.25 0 00-5.25-5.25H8.25a5.25 5.25 0 00-5.25 5.25v1.5A5.25 5.25 0 008.25 21h2.25a5.25 5.25 0 005.25-5.25v-1.5m-5.25 0v-3.75m0 3.75H3.75m12.75 0h3.75"
    />
  </svg>
);
