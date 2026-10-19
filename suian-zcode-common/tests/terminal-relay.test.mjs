import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import WebSocket, {WebSocketServer} from 'ws';
import * as remote from '../remote.mjs';

test('3.16 终端使用短期 token 和设备 SID 鉴权，不发送旧版 role/hash', {timeout:3000}, async t => {
  const server = new WebSocketServer({host:'127.0.0.1',port:0});
  await once(server,'listening');
  t.after(()=>{for(const socket of server.clients)socket.terminate();return new Promise(resolve=>server.close(resolve));});
  const received=[];
  server.on('connection',(socket,request)=>{
    const url=new URL(request.url,'http://127.0.0.1');
    assert.equal(url.pathname,'/api/v1/remote/ws2');
    assert.equal(url.searchParams.get('token'),'test-terminal-token');
    socket.on('message',data=>{
      const message=JSON.parse(data);
      received.push(message);
      if(message.type==='auth_init')socket.send(JSON.stringify({type:'auth_ack',device_sid:'d_test',terminal_sid:'t_test',pair_status:'matched'}));
      if(message.type==='data')socket.send(JSON.stringify({type:'data',payload:{answer:42}}));
    });
  });
  const payload=Promise.withResolvers();
  assert.equal(typeof remote.startTerminalRelay,'function');
  const relay=await remote.startTerminalRelay({deviceSid:'d_test',getToken:async()=>'test-terminal-token',relayUrl:`ws://127.0.0.1:${server.address().port}/api/v1/remote/ws2`,WebSocketImpl:WebSocket,onData:payload.resolve,timeoutMs:1000});
  t.after(()=>relay.close());
  await Promise.race([relay.paired.promise,relay.fault.promise]);
  assert.deepEqual(Object.keys(received[0]).sort(),['client_ts','device_sid','meta','type']);
  assert.equal(received[0].meta.name,'suian-zcode-common');
  relay.sendData({question:1});
  assert.deepEqual(await payload.promise,{answer:42});
});

test('3.16 终端心跳 ACK 超时明确失败，不继续报告连接健康', {timeout:2000}, async t=>{
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
  t.after(()=>{for(const socket of server.clients)socket.terminate();server.close();});
  server.on('connection',socket=>socket.on('message',data=>{
    if(JSON.parse(data).type==='auth_init')socket.send(JSON.stringify({type:'auth_ack',device_sid:'d_test',pair_status:'matched'}));
  }));
  const relay=await remote.startTerminalRelay({deviceSid:'d_test',getToken:async()=>'test',relayUrl:`ws://127.0.0.1:${server.address().port}/api/v1/remote/ws2`,heartbeatIntervalMs:10,heartbeatTimeoutMs:40});
  t.after(()=>relay.close());
  await Promise.race([relay.paired.promise,relay.fault.promise]);
  await assert.rejects(relay.fault.promise,{reasonCode:'relay_heartbeat_timeout'});
});

test('3.16 终端被替换后报告 KICKED，不自动争抢连接', {timeout:2000}, async t=>{
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
  t.after(()=>{for(const socket of server.clients)socket.terminate();server.close();});
  let connections=0;
  server.on('connection',socket=>{connections++;socket.on('message',()=>socket.send(JSON.stringify({type:'error',code:'KICKED'})));});
  const relay=await remote.startTerminalRelay({deviceSid:'d_test',getToken:async()=>'test',relayUrl:`ws://127.0.0.1:${server.address().port}/api/v1/remote/ws2`});
  t.after(()=>relay.close());
  await assert.rejects(relay.fault.promise,{reasonCode:'terminal_kicked'});
  assert.equal(connections,1);
});
