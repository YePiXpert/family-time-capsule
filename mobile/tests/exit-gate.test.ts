import { expect, it, vi } from "vitest";
import { ExitGate } from "../src/local/exitGate";

it("封存／保存途中按返回：操作定了去处，记着的返回作废，只去定下的地方", () => {
  const gate = new ExitGate();
  const back = vi.fn(), toLetter = vi.fn();
  gate.hold(back);
  gate.decide(toLetter);
  expect(gate.release()).toBeNull();
  gate.take()?.();
  expect(toLetter).toHaveBeenCalledOnce();
  expect(back).not.toHaveBeenCalled();
  expect(gate.take()).toBeNull();
});
it("操作失败没定去处：记着的返回在操作结束后补走，且只补一次", () => {
  const gate = new ExitGate();
  const back = vi.fn();
  gate.hold(back);
  expect(gate.release()).toBe(back);
  expect(gate.release()).toBeNull();
  expect(gate.take()).toBeNull();
});
it("定了去处之后再按的返回也不补走", () => {
  const gate = new ExitGate();
  const save = vi.fn(), back = vi.fn();
  gate.decide(save);
  gate.hold(back);
  expect(gate.release()).toBeNull();
  expect(gate.take()).toBe(save);
});
