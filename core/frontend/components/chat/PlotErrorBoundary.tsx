import React from 'react';

interface Props {
    fallback: React.ReactNode;
    children: React.ReactNode;
    /** When this value changes the error state is cleared so the child retries. */
    resetKey?: unknown;
}

interface State { hasError: boolean; resetKey?: unknown }

export class PlotErrorBoundary extends React.Component<Props, State> {
    state: State = { hasError: false, resetKey: undefined };

    static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
        if (props.resetKey !== state.resetKey) {
            return { hasError: false, resetKey: props.resetKey };
        }
        return null;
    }

    static getDerivedStateFromError(): Partial<State> {
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
