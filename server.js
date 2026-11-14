const http = require('http');
const { Server } = require('socket.io');
const server = http.createServer();
const io = new Server(server, { cors: { origin: '*' } });
const rooms = new Map(), waiting = [];
const PORT = process.env.PORT || 3000;
const types = {minchi:[3.1,1,1],ki:[5.1,.62,.9],dash:[4.4,.82,.95],power:[2.5,1.35,1.45],magic:[3.4,.92,1.05],ninja:[4.2,.8,1.05],ice:[2.9,1.2,.95],fire:[3.6,.9,1.2]};
const floor=438, platforms=[{x:130,y:340,w:190},{x:390,y:285,w:180},{x:640,y:340,w:190}];
const makeCode=()=>{let s;do{s=Math.random().toString(36).slice(2,7).toUpperCase()}while(rooms.has(s));return s};
function makePlayer(id,type,i){return{id,type:types[type]?type:'minchi',x:[220,700,450,820][i],y:350,vx:0,vy:0,face:i? -1:1,stocks:3,damage:0,ground:false,attack:0,attackType:'punch',cool:0,stun:0,guard:0,alive:true,invuln:0,input:{}}}
function info(r){return{code:r.code,hostId:r.hostId,status:r.status,players:r.players.map(p=>({id:p.id,type:p.type,stocks:p.stocks,alive:p.alive}))}}
function state(r){return{players:r.players.map(({input,...p})=>p),meat:r.meat,effects:r.effects}}
function broadcast(r){io.to(r.code).emit('room:update',info(r))}
function add(socket,r,type){if(r.players.length>=4)throw Error('部屋は満員です');r.players.push(makePlayer(socket.id,type,r.players.length));socket.join(r.code);socket.data.room=r.code;socket.emit('room:joined',{room:info(r),playerId:socket.id,host:r.hostId===socket.id,mode:r.mode});broadcast(r)}
function start(r){if(r.players.length<2){io.to(r.code).emit('room:error','対戦には2人以上必要です');return}r.status='playing';r.started=true;io.to(r.code).emit('game:start',{state:state(r)});broadcast(r)}
function ko(p,r){if(!p.alive)return;p.stocks--;p.damage=0;p.attack=0;p.vx=0;p.vy=0;r.meat.push({x:p.x,y:floor-4,t:300});if(p.stocks<=0)p.alive=false;else{p.x=100+Math.random()*760;p.y=160;p.stun=55;p.invuln=90}}
function hurt(t,a,r){if(!t.alive||t.invuln>0)return;if(t.guard){t.vx+=a.face*1.2;return}const n=(a.attackType==='kick'?13:8)*types[a.type][2];t.damage=Math.min(100,t.damage+n);t.stun=16;t.vx=a.face*(4.8+t.damage*.075)/types[t.type][1];t.vy=-3-t.damage*.025;r.effects.push({x:t.x,y:t.y-30,text:'+'+Math.round(n)+'%'});a.attack=0;if(t.damage>=100)ko(t,r)}
function tick(r){if(!r.started)return;for(const p of r.players){if(!p.alive)continue;const k=p.input;p.cool=Math.max(0,p.cool-1);p.attack=Math.max(0,p.attack-1);p.stun=Math.max(0,p.stun-1);p.invuln=Math.max(0,p.invuln-1);p.guard=k.guard?2:0;if(!p.stun){if(k.left){p.vx-=.65;p.face=-1}if(k.right){p.vx+=.65;p.face=1}if(k.jump&&p.ground)p.vy=-10.5;if((k.punch||k.kick)&&!p.cool&&!p.attack){p.attack=k.kick?17:12;p.attackType=k.kick?'kick':'punch';p.cool=k.kick?34:24}if(k.dash&&!p.cool){p.vx=p.face*9;p.cool=55}}p.vx*=p.guard?.75:.84;p.vx=Math.max(-8,Math.min(8,p.vx));p.vy+=.48;p.x+=p.vx;p.y+=p.vy;p.ground=false;if(p.y+26>=floor&&p.x>20&&p.x<940){p.y=floor-26;p.vy=0;p.ground=true}for(const q of platforms)if(p.vy>=0&&p.x>q.x&&p.x<q.x+q.w&&p.y+26>=q.y&&p.y+26-p.vy<q.y+5){p.y=q.y-26;p.vy=0;p.ground=true}if(p.x< -25||p.x>985||p.y>580)ko(p,r)}for(const a of r.players){if(!a.alive||a.attack<7)continue;for(const b of r.players){if(a===b||!b.alive)continue;const dx=b.x-a.x;if(Math.sign(dx)===a.face&&Math.abs(dx)<(a.attackType==='kick'?82:62)&&Math.abs(b.y-a.y)<48){hurt(b,a,r);break}}}r.meat=r.meat.filter(x=>--x.t>0);r.effects=r.effects.slice(-20);io.to(r.code).emit('game:state',state(r));const alive=r.players.filter(p=>p.alive);if(alive.length<=1){r.started=false;r.status='finished';io.to(r.code).emit('game:over',{message:alive.length?'勝者が決定！':'全員脱落！'});broadcast(r)}}
function leave(s){const code=s.data.room;if(!code)return;const r=rooms.get(code);s.leave(code);s.data.room=null;if(!r)return;r.players=r.players.filter(p=>p.id!==s.id);if(!r.players.length){rooms.delete(code);return}if(r.hostId===s.id)r.hostId=r.players[0].id;if(r.started&&r.players.filter(p=>p.alive).length<=1){r.started=false;io.to(code).emit('game:over',{message:'相手が退出しました'})}broadcast(r)}
io.on('connection',s=>{
 s.on('room:create',d=>{try{const code=makeCode(),r={code,hostId:s.id,mode:'friend',status:'waiting',players:[],meat:[],effects:[],started:false};rooms.set(code,r);add(s,r,d.fighter)}catch(e){s.emit('room:error',e.message)}});
 s.on('room:join',d=>{try{const r=rooms.get(String(d.code||'').toUpperCase());if(!r)throw Error('部屋コードが見つかりません');if(r.status!=='waiting')throw Error('試合中の部屋です');add(s,r,d.fighter)}catch(e){s.emit('room:error',e.message)}});
 s.on('room:start',()=>{const r=rooms.get(s.data.room);if(r&&r.hostId===s.id)start(r)});
 s.on('room:leave',()=>leave(s));
 s.on('player:input',input=>{const r=rooms.get(s.data.room);if(!r||!r.started)return;const p=r.players.find(x=>x.id===s.id);if(!p)return;const v={};for(const k of ['left','right','jump','punch','kick','guard','dash'])v[k]=!!input[k];p.input=v});
 s.on('match:join',d=>{const other=waiting.shift();if(other&&other.connected){const code=makeCode(),r={code,hostId:other.id,mode:'random',status:'waiting',players:[],meat:[],effects:[],started:false};rooms.set(code,r);try{add(other,r,other.fighter);add(s,r,d.fighter);start(r)}catch(e){s.emit('room:error',e.message)}}else{waiting.push(Object.assign(s,{fighter:d.fighter}));s.emit('room:error','対戦相手を検索中…この画面を開いたまま待ってね')}});
 s.on('disconnect',()=>{const i=waiting.findIndex(x=>x.id===s.id);if(i>=0)waiting.splice(i,1);leave(s)});
});
setInterval(()=>rooms.forEach(tick),1000/30);
server.listen(PORT,()=>console.log('MINCHI CLASH listening on '+PORT));
