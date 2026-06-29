import React from 'react';

interface Props {
    fallback: React.ReactNode;
    children: React.ReactNode;
}

interface State { hasError: boolean }

export class PlotErrorBoundary extends React.Component<Props, State> {
    state: State = { hasError: false };

    static getDerivedStateFromError(): State {
        return { hasError: true };
    }

    componentDidCatch(error: unknown) {
        console.warn('[PlotErrorBoundary] plot render failed', error);
    }

    render() {
        if (this.state.hasError) return this.props.fallback;
        return this.props.children;
    }
}
