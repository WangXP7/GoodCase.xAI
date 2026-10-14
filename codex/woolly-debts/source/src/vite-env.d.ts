/// <reference types="vite/client" />

interface Window {
  desktop?: {
    setFullscreen(value: boolean): Promise<boolean>;
    getVersion(): Promise<string>;
  };
  __woollyGame?: import("./game").DebugGameApi;
}
