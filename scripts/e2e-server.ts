import { AppEngine } from '../src/domain/engine.ts';
import { startServer } from '../src/server/app.ts';
import { demoEvents } from '../src/replay/demo.ts';
const start=performance.now();
const engine=new AppEngine({source:'demo',serverEpoch:'e2e-only'});
for(const event of demoEvents())engine.apply(event);
// Test-only capabilities. This entry point never reads Discord or persistent user data.
const app=startServer({engine,keys:{read:'1'.repeat(64),control:'2'.repeat(64)},assets:await Bun.file('.generated/web-assets.json').json(),port:31339,now:()=>performance.now()-start});
const stop=()=>{void app.stop().then(()=>process.exit(0));};
process.on('SIGTERM',stop);process.on('SIGINT',stop);
