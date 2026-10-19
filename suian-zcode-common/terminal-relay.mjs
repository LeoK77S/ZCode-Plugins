import WebSocket from 'ws';

// ZCode 3.16 relay V2：以账号授权的 terminal 连接已注册设备，Desktop 直连官方 relay。
export async function startTerminalRelay({deviceSid, deviceMid, getToken, relayUrl='wss://zcode.z.ai/api/v1/remote/ws2', timeoutMs=8000, heartbeatIntervalMs=5000, heartbeatTimeoutMs=15000, WebSocketImpl=WebSocket, onData, onPairStatus}) {
  if(typeof deviceSid!=='string'||!deviceSid||typeof getToken!=='function')throw new Error('缺少设备 SID 或终端授权提供方');
  const address=new URL(relayUrl);
  if(address.protocol!=='wss:'&&!(address.protocol==='ws:'&&address.hostname==='127.0.0.1'))throw new Error('终端 relay 必须使用 WSS 或回环测试地址');
  address.searchParams.set('token',await getToken());
  if(deviceMid)address.searchParams.set('mid',deviceMid);
  const socket=new WebSocketImpl(address.href);
  const paired=Promise.withResolvers(),fault=Promise.withResolvers();
  let closing=false,authenticated=false,heartbeat,ackTimer;
  const error=(reasonCode,message)=>Object.assign(new Error(message),{stage:'relay',reasonCode});
  let timer=setTimeout(()=>fault.reject(error('relay_timeout','终端 relay 鉴权或配对超时')),timeoutMs);
  const send=message=>socket.send(JSON.stringify({...message,client_ts:Math.floor(Date.now()/1000)}));
  const close=()=>{closing=true;clearTimeout(timer);clearInterval(heartbeat);clearTimeout(ackTimer);socket.close();};
  socket.addEventListener('open',()=>send({type:'auth_init',device_sid:deviceSid,meta:{platform:'web',version:'3.16',name:'suian-zcode-common'}}));
  socket.addEventListener('error',()=>fault.reject(error('relay_connection_failed','终端 relay 连接失败')));
  socket.addEventListener('close',()=>{if(!closing)fault.reject(error('relay_connection_closed','终端 relay 连接已断开，已提交操作结果可能未知'));});
  socket.addEventListener('message',event=>{
    try {
      const message=JSON.parse(event.data);
      if(message.type==='error')throw error(message.code==='KICKED'?'terminal_kicked':'relay_rejected','终端 relay 拒绝连接：'+message.code);
      if(message.type==='auth_ack') {
        if(message.device_sid!==deviceSid)throw error('relay_identity_mismatch','终端 relay 返回的设备身份不匹配');
        authenticated=true;
        heartbeat=setInterval(()=>send({type:'pair_status_query'}),heartbeatIntervalMs);
      }
      if(authenticated&&(message.type==='auth_ack'||message.type==='pair_status_ack')) {
        clearTimeout(ackTimer);
        ackTimer=setTimeout(()=>fault.reject(error('relay_heartbeat_timeout','终端 relay 心跳确认超时')),heartbeatTimeoutMs);
        onPairStatus?.(message.pair_status);
        if(message.pair_status==='matched'){clearTimeout(timer);paired.resolve();}
      } else if(authenticated&&message.type==='data')onData?.(message.payload);
    } catch(cause) {fault.reject(cause);}
  });
  return {socket,sid:deviceSid,paired,fault,close,sendData:payload=>send({type:'data',payload})};
}
