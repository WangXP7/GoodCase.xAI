import { createContext, useContext, useMemo, useRef } from "react";

export const PLUS_ORIGIN = [0.6, -0.46, 0];
export const CROSS_ORIGIN = [-0.6, -0.46, 0];

const GameContext = createContext(null);

export function GameProvider({ children, radius, strength, gravity }) {
    const pumpsRef = useRef({ plus: 0, cross: 0 });
    const paramsRef = useRef({ radius, strength, gravity });
    paramsRef.current.radius = radius;
    paramsRef.current.strength = strength;
    paramsRef.current.gravity = gravity;

    const api = useMemo(
        () => ({
            pumpsRef,
            paramsRef,
            setPumpLevel: (side, level) => {
                pumpsRef.current[side] = level;
            },
            triggerBurst: (side) => {
                pumpsRef.current[`${side}Burst`] = 1;
            },
        }),
        [],
    );

    return <GameContext.Provider value={api}>{children}</GameContext.Provider>;
}

export function useGame() {
    const context = useContext(GameContext);
    if (!context) {
        throw new Error("useGame must be used within GameProvider");
    }
    return context;
}
