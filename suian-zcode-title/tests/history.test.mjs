import test from "node:test";
import assert from "node:assert/strict";
import {recentSnapshot,readHistory} from "../history.mjs";
import {createBackend} from "../backend.mjs";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
const m=(id,role,text,parentID,extra={})=>({info:{id,role,parentID,...extra},parts:[{type:"text",text},{type:"reasoning",text:"不交给命名模型"}]});
test("按真实用户输入合并多条助手，取三轮并排除内部提醒与旧回退分支",()=>{
  const messages=[m("u0","user","最早需求"),m("a0","assistant","最早回答","u0"),m("u1","user","第一轮"),m("a1","assistant","回复一","u1"),m("a2","assistant","回复二","u1"),m("bad","user","已回退内容"),m("aBad","assistant","旧分支","bad"),m("notice","user","Conversation rewind applied.",null,{synthetic:true,source:"rewind"}),m("u2","user","第二轮"),m("sys","user","内部提醒",null,{semantics:{origin:"agent_runtime",uiVisibility:"hidden"}}),m("a3","assistant","第二轮回答","u2"),m("u3","user","第三轮"),m("a4","assistant","第三轮回答","u3")];
  const session={title:"原名",revert:{targetMessageID:"bad",createdMessageID:"notice",keptMessageIDs:["u0","a0","u1","a1","a2"]}};
  const snap=recentSnapshot({session,messages},"D:\\测试工程");
  assert.deepEqual(snap.context.recent_turns.map(t=>({id:t.id,messages:t.messages})),[
    {id:"u1",messages:[{role:"user",text:"第一轮"},{role:"assistant",text:"回复一\n回复二"}]},
    {id:"u2",messages:[{role:"user",text:"第二轮"},{role:"assistant",text:"第二轮回答"}]},
    {id:"u3",messages:[{role:"user",text:"第三轮"},{role:"assistant",text:"第三轮回答"}]}
  ]);
  assert.equal(snap.context.original_goal,"最早需求");
  assert.ok(!JSON.stringify(snap.context).includes("不交给命名模型"));
  const changed=recentSnapshot({session,messages:[...messages,m("u4","user","后续输入")]},"D:\\测试工程");
  assert.notEqual(changed.fingerprint,snap.fingerprint);
});

test("超过 32 MiB 的真实 SQLite 历史完整读取，命名摘要仍截取且双库不变",{timeout:15000},async t=>{
  const root=mkdtempSync(join(tmpdir(),"z-title-large-history-")),sessionDb=join(root,"session.sqlite"),indexDb=join(root,"index.sqlite");
  t.after(()=>rmSync(root,{recursive:true}));
  const sqliteBin=process.env.SQLITE_BIN||"sqlite3",sessionId="session_large_fixture",workspacePath="D:\\fixture",textLength=36*1024*1024;
  execFileSync(sqliteBin,[sessionDb,[
    "CREATE TABLE session(id,title,directory,path,revert,title_source);",
    "CREATE TABLE message(id,session_id,time_created,time_updated,data,sequence);",
    "CREATE TABLE part(id,message_id,session_id,time_created,time_updated,data,sequence);",
    `INSERT INTO session VALUES('${sessionId}','原名','${workspacePath}',NULL,NULL,'generated');`,
    `INSERT INTO message VALUES('u1','${sessionId}',1,1,json_object('role','user'),1);`,
    // 在 SQLite 内生成长正文，避免将大字符串传给进程命令行。
    `INSERT INTO part VALUES('p1','u1','${sessionId}',1,1,json_object('type','text','text','BEGIN:'||replace(hex(zeroblob(${textLength/2})),'0','x')||':END'),1);`
  ].join("\n")]);
  execFileSync(sqliteBin,[indexDb,`CREATE TABLE tasks(task_id,workspace_path,title,archived,deleted,task_status);INSERT INTO tasks VALUES('${sessionId}','${workspacePath}','原名',0,0,'completed');`]);
  const before=[sessionDb,indexDb].map(path=>createHash("sha256").update(readFileSync(path)).digest("hex"));
  const history=await readHistory({dbPath:sessionDb,sessionId,workspacePath,sqliteBin});
  assert.equal(history.messages.length,1);
  const body=history.messages[0].parts[0].text;
  assert.equal(body.length,textLength+10);
  assert.match(body,/^BEGIN:x+:END$/);
  const backend=createBackend({event:{session_id:sessionId,workspace_path:workspacePath},config:{sessionDb,indexDb,sqliteBin},
    readTitlePolicy:async()=>null,connect:async()=>{throw new Error("只读历史不应连接远控");}});
  const snapshot=await backend.read();
  backend.close();
  assert.equal(snapshot.turnCount,1);
  assert.equal(snapshot.context.original_goal,"BEGIN:"+"x".repeat(794));
  assert.deepEqual(snapshot.context.recent_turns[0].messages,[{role:"user",text:"BEGIN:"+"x".repeat(1194)}]);
  assert.deepEqual([sessionDb,indexDb].map(path=>createHash("sha256").update(readFileSync(path)).digest("hex")),before);
});
for (const sessionId of ['sess_fixture', 'session_316_fixture']) test(`SQLite 只读历史兼容 ${sessionId.split('_')[0]} 前缀，按 sequence 重建并校验工作区`,async()=>{
  const root=mkdtempSync(join(tmpdir(),"z-title-fixture-")),db=join(root,"fixture.sqlite"),sqliteBin=process.env.SQLITE_BIN||"sqlite3";
  try {
    const sql=[
      "CREATE TABLE session(id,title,directory,path,revert,title_source);",
      "CREATE TABLE message(id,session_id,time_created,time_updated,data,sequence);",
      "CREATE TABLE part(id,message_id,session_id,time_created,time_updated,data,sequence);",
      "INSERT INTO session VALUES('sess_fixture','原名','D:\\fixture',NULL,NULL,'custom');",
      "INSERT INTO message VALUES('u1','sess_fixture',1,1,'"+JSON.stringify({role:"user"})+"',1);",
      "INSERT INTO part VALUES('p2','u1','sess_fixture',1,1,'"+JSON.stringify({type:"text",text:"第二段"})+"',2);",
      "INSERT INTO part VALUES('p1','u1','sess_fixture',2,2,'"+JSON.stringify({type:"text",text:"第一段"})+"',1);"
    ].join("\n");
    execFileSync(sqliteBin,[db,sql.replaceAll('sess_fixture',sessionId)]);
    const result=await readHistory({dbPath:db,sqliteBin,sessionId,workspacePath:"D:\\fixture"});
    assert.equal(result.messages[0].info.id,"u1");
    assert.deepEqual(result.messages[0].parts.map(p=>p.text),["第一段","第二段"]);
    await assert.rejects(readHistory({dbPath:db,sqliteBin,sessionId,workspacePath:"D:\\other"}),/工作区/);
    assert.equal(execFileSync(sqliteBin,["-readonly",db,"SELECT count(*) FROM part;"],{encoding:"utf8"}).trim(),"2");
  } finally {rmSync(root,{recursive:true});}
});

