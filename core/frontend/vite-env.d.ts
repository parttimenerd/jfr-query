/// <reference types="vite/client" />

declare module '*.bin?url' {
    const url: string;
    export default url;
}
