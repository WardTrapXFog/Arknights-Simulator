// Sandbox entry: application behavior is composed by controller.js.
import { bootSandbox } from './controller.js';
import * as hud from './hud.js';

bootSandbox().catch((e) => {
  console.error(e);
  const el = document.getElementById('app');
  if (el) el.innerHTML = `<pre style="padding:24px;color:#ff8f86;font:13px/1.6 monospace;white-space:pre-wrap">载入失败：${hud.esc(e?.stack || e?.message || e)}</pre>`;
});
