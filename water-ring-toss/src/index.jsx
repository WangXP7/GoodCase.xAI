import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { Canvas } from "@react-three/fiber";
import { Leva } from "leva";
import Experience from "./Experience.jsx";

const compactHud = window.matchMedia("(max-width: 1024px)");

function useCompactHud() {
    const [compact, setCompact] = useState(compactHud.matches);

    useEffect(() => {
        const onChange = (event) => setCompact(event.matches);
        compactHud.addEventListener("change", onChange);
        return () => compactHud.removeEventListener("change", onChange);
    }, []);

    return compact;
}

function App() {
    const compact = useCompactHud();

    return (
        <>
            <Leva collapsed hidden={compact} />
            <Canvas
                camera={{
                    fov: 45,
                    near: 0.1,
                    far: 200,
                    position: [0, 0, 4],
                }}
            >
                <Experience />
            </Canvas>
        </>
    );
}

const root = ReactDOM.createRoot(document.querySelector("#root"));

root.render(<App />);

const hud = document.querySelector(".hud");
const hudToggle = hud?.querySelector(".hud-toggle");

function setHudOpen(open) {
    if (!hud || !hudToggle) return;

    hud.classList.toggle("is-open", open);
    hudToggle.setAttribute("aria-expanded", String(open));
    hudToggle.setAttribute(
        "aria-label",
        open ? "Close how to play" : "How to play",
    );
}

hudToggle?.addEventListener("click", () => {
    if (!compactHud.matches) return;
    setHudOpen(!hud.classList.contains("is-open"));
});

document.addEventListener("pointerdown", (event) => {
    if (!hud?.classList.contains("is-open")) return;
    if (hud.contains(event.target)) return;
    setHudOpen(false);
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setHudOpen(false);
});

compactHud.addEventListener("change", (event) => {
    if (!event.matches) setHudOpen(false);
});
