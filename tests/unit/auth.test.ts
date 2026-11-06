import {expect,test} from 'bun:test';
import {StreamKitCompatAuth} from '../../src/discord/auth-provider.ts';
import type {RpcClient} from '../../src/discord/rpc-client.ts';
test('compatibility authentication is inert without explicit consent',async()=>{
 let calls=0;const rpc:Pick<RpcClient,'request'>={request:async()=>{calls++;return {};}};
 await expect(new StreamKitCompatAuth(false).authenticate(rpc,true)).rejects.toThrow('COMPAT_CONSENT_REQUIRED');expect(calls).toBe(0);
});
test('only read scopes are requested; token is reused in memory and expiry requires explicit consent',async()=>{
 const calls:{cmd:string;args:unknown}[]=[];let now=0,exchanges=0;
 const rpc:Pick<RpcClient,'request'>={request:async(cmd,args)=>{calls.push({cmd,args});return cmd==='AUTHORIZE'?{code:'CODE'}:{};}};
 const auth=new StreamKitCompatAuth(true,async(url,options)=>{exchanges++;expect(url).toBe('https://streamkit.discord.com/overlay/token');expect(options.redirect).toBe('error');return Response.json({access_token:'SECRET',expires_in:1});},()=>now);
 await auth.authenticate(rpc,true);await auth.authenticate(rpc,false);
 expect(calls[0]?.args).toEqual({client_id:auth.clientId,scopes:['rpc','rpc.voice.read']});expect(exchanges).toBe(1);
 now=1001;await expect(auth.authenticate(rpc,false)).rejects.toThrow('AUTH_REQUIRED');expect(exchanges).toBe(1);
});
test('upstream exchange error never exposes a token or raw response',async()=>{
 const rpc:Pick<RpcClient,'request'>={request:async()=>({code:'CODE'})};
 const auth=new StreamKitCompatAuth(true,async()=>{throw new Error('SECRET');});
 try{await auth.authenticate(rpc,true);throw new Error('unexpected success');}catch(e){expect(String(e)).toContain('AUTH_EXCHANGE_FAILED');expect(String(e)).not.toContain('SECRET');}
});
