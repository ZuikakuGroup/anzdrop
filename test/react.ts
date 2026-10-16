import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export function createReactHarness() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return { container, root: createRoot(container) };
}

export async function disposeReactHarness(root: Root, container: HTMLDivElement) {
  await act(async () => root.unmount());
  container.remove();
}

export async function mountHook<T>(useHook: () => T) {
  const { root, container } = createReactHarness();
  let value: T;
  function Harness(): ReactNode { value = useHook(); return null; }
  await act(async () => root.render(createElement(Harness)));
  return {
    get current() { return value; },
    rerender: () => act(async () => root.render(createElement(Harness))),
    unmount: () => disposeReactHarness(root, container),
  };
}
