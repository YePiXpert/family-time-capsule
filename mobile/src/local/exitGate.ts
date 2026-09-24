/**
 * 编辑页与写信页离开的次序：操作途中按的返回先记着，这轮操作结束再走；
 * 操作自己已定了去处（保存后去记录页、封存后去信），记着的返回就作废，不能把去处盖掉。
 */
export class ExitGate {
  private held: (() => void) | null = null;
  private target: (() => void) | null = null;
  private decided = false;
  /** 操作进行中按了返回。 */
  hold(exit: () => void): void {
    this.held = exit;
  }
  /** 定下离开后去哪儿；此后记着的返回都不再补走。 */
  decide(action: () => void): void {
    this.target = action;
    this.decided = true;
  }
  /** 一轮操作结束：还要补走的返回，没有就是 null。 */
  release(): (() => void) | null {
    const exit = this.held;
    this.held = null;
    return exit && !this.decided ? exit : null;
  }
  /** 放行之后取出去处，只取一次。 */
  take(): (() => void) | null {
    const action = this.target;
    this.target = null;
    return action;
  }
}
