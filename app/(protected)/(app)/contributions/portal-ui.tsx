"use client";

import QRCode from "qrcode";
import { useActionState, useEffect, useState } from "react";
import { createPortalAction, mutatePortalAction } from "./actions";

const inputClass = "rounded-lg border border-foreground/15 bg-background px-3 py-2 text-sm";

function PortalLink({ token, message }: { token: string; message?: string }) {
  const [svg, setSvg] = useState("");
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const contributionUrl = `${window.location.origin}/contribute/${token}`;
    let live = true;
    void QRCode.toString(contributionUrl, { type: "svg", margin: 1, width: 220, errorCorrectionLevel: "M" })
      .then((value) => {
        if (live) {
          setUrl(contributionUrl);
          setSvg(value);
        }
      });
    return () => { live = false; };
  }, [token]);
  return (
    <div className="mt-3 rounded-xl border border-accent/40 bg-background p-4">
      <p className="text-sm font-medium">链接只显示这一次，请现在保存或发送：</p>
      <p className="mt-2 break-all rounded-lg border border-line p-3 text-sm">{url || "正在生成本机链接…"}</p>
      {svg ? <div className="mt-3 w-fit rounded-lg bg-white p-2" aria-label="投递箱二维码" dangerouslySetInnerHTML={{ __html: svg }} /> : null}
      <button type="button" disabled={!url} className="ui-button-secondary mt-3" onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true))}>{copied ? "已复制" : "复制链接"}</button>
      {message ? <p className="mt-2 text-xs text-muted">{message}</p> : null}
    </div>
  );
}

export function PortalCreateForm({ people }: { people: Array<{ id: string; displayName: string }> }) {
  const [state, action, pending] = useActionState(createPortalAction, undefined);
  if (state?.token) return <PortalLink token={state.token} />;
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="title" required maxLength={100} className={inputClass} placeholder="例如：满月照片收集" aria-label="投递箱标题" />
        <select name="recipientPersonId" className={inputClass} aria-label="建议关联人物" defaultValue="">
          <option value="">不关联人物</option>
          {people.map((entry) => <option key={entry.id} value={entry.id}>{entry.displayName}</option>)}
        </select>
      </div>
      <textarea name="description" required maxLength={500} rows={3} className={inputClass} placeholder="告诉家人想收集什么；不会暴露档案内部信息。" aria-label="投递箱说明" />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">有效天数<input name="ttlDays" type="number" min={1} max={365} defaultValue={30} className={`${inputClass} mt-1 w-full`} /></label>
        <label className="text-sm">最多提交次数<input name="maxSubmissions" type="number" min={1} max={1000} defaultValue={20} className={`${inputClass} mt-1 w-full`} /></label>
        <label className="text-sm">每次最多文件<input name="maxFilesPerSubmission" type="number" min={0} max={100} defaultValue={10} className={`${inputClass} mt-1 w-full`} /></label>
      </div>
      <fieldset className="rounded-xl border border-line p-3">
        <legend className="px-1 text-sm font-medium">允许内容</legend>
        <div className="mt-1 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {[['allowImages','照片',true],['allowAudio','音频',true],['allowVideo','视频',true],['allowDocuments','PDF / 文档',true],['allowText','文字',true],['allowBrowserRecording','浏览器录音',true],['allowGuestName','填写称呼',false],['allowReuse','提交后继续使用链接',true]].map(([name,label,enabled]) => (
            <label key={String(name)} className="flex items-center gap-2"><input type="checkbox" name={String(name)} defaultChecked={Boolean(enabled)} />{String(label)}</label>
          ))}
        </div>
      </fieldset>
      <button type="submit" disabled={pending} className="ui-button-primary w-fit">{pending ? "创建中…" : "创建投递箱"}</button>
      {state?.error ? <p role="alert" className="text-sm text-red-700">创建失败：{state.error}</p> : null}
    </form>
  );
}

export function PortalControls({ portalId, status }: { portalId: string; status: string }) {
  const [state, action, pending] = useActionState(mutatePortalAction, undefined);
  return (
    <div>
      <form action={action} className="mt-3 flex flex-wrap gap-2">
        <input type="hidden" name="portalId" value={portalId} />
        {status === "open" ? <button name="operation" value="pause" disabled={pending} className="ui-button-secondary">暂停</button> : null}
        {status === "paused" ? <button name="operation" value="reopen" disabled={pending} className="ui-button-secondary">重新开放</button> : null}
        {status !== "closed" ? <button name="operation" value="extend" disabled={pending} className="ui-button-secondary">延长 30 天</button> : null}
        <button name="operation" value="regenerate" disabled={pending} className="ui-button-secondary">重新生成链接</button>
        {status !== "closed" ? <button name="operation" value="revoke" disabled={pending} className="ui-button-secondary text-red-700">撤销</button> : null}
      </form>
      {state?.token ? <PortalLink token={state.token} message={state.message} /> : null}
      {state?.message && !state.token ? <p role="status" className="mt-2 text-xs text-muted">{state.message}</p> : null}
      {state?.error ? <p role="alert" className="mt-2 text-xs text-red-700">操作失败：{state.error}</p> : null}
    </div>
  );
}
