import {test,expect} from 'bun:test';
import {readFile} from 'node:fs/promises';
import {HELP} from '../../src/cli-options.ts';
import {webTemplate} from '../../scripts/web-template.ts';

test('onboarding and consent disclose chat and keep demo separate from live authorization',async()=>{
 const readme=await readFile('README.md','utf8'),live=await readFile('scripts/Start-Live.cmd','utf8');
 expect(HELP).toContain('VC text chat');expect(live).toContain('VC text chat');expect(readme).toContain('VC-CHAT');
 for(const text of [HELP,live,readme])expect(text).toContain('--accept-streamkit-compat');
 expect(HELP).not.toContain('voice metadata only');expect(readme).toContain('Start-Demo.cmd');expect(readme).toContain('data/');
});
test('Dock templates contain no duplicate IDs or retired controls',async()=>{
 const html=await webTemplate('src/web/dock/index.html');const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
 expect(new Set(ids).size).toBe(ids.length);
 for(const text of ['今回のBlenderモデルとの比較','自然な仕上げ','写真風','@include'])expect(html).not.toContain(text);
 expect(html).toContain('camera-onset');expect(html).toContain('vc-chat-panel');
});
