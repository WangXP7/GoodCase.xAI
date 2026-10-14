import "./style.css";
import { WoollyGame } from "./game";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing #app root");

const game = new WoollyGame(root);

window.addEventListener("beforeunload", () => game.dispose(), { once: true });
