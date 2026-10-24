const test=require('node:test');
const assert=require('node:assert/strict');
const {Game,Dungeon,TYPES,center}=require('../core.js');
function seeded(seed=1){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
function newGame(seed=1){const g=new Game(seeded(seed));g.start();g.events=[];return g;}
test('generated floors have reachable rooms and switches, with no wall spawns',()=>{
  for(let seed=1;seed<=30;seed++)for(let floor=1;floor<=10;floor++){
    const g=newGame(seed);g.loadFloor(floor);const d=g.dungeon,p=center(d.rooms[0]),start=Math.floor(p.y/20)*100+Math.floor(p.x/20);
    const visited=new Set([start]),queue=[start];
    for(let i=0;i<queue.length;i++){const n=queue[i],x=n%100,y=Math.floor(n/100);for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy,k=ny*100+nx;if(nx>=0&&nx<100&&ny>=0&&ny<100&&!d.grid[k]&&!visited.has(k)){visited.add(k);queue.push(k);}}}
    for(const q of [...d.rooms.map(center),...g.switches,...g.enemies,...(g.power?[g.power]:[])])assert.ok(visited.has(Math.floor(q.y/20)*100+Math.floor(q.x/20)),`unreachable spawn seed ${seed}, floor ${floor}`);
    assert.equal(d.wall(g.player.x,g.player.y),false);
  }
});
test('all switches open exit and entering it heals, clears projectiles and advances',()=>{
  const g=newGame();g.player.hp=1;g.switches.forEach(s=>s.active=true);g.step();assert.ok(g.portal);
  Object.assign(g.player,g.portal);g.portal.delay=0;g.bullets.push({x:0,y:0,angle:0,speed:0,enemy:true,damage:1,dead:false});g.step();
  assert.equal(g.floor,2);assert.equal(g.player.hp,g.player.maxHp);assert.equal(g.bullets.length,0);
});
test('true boss needs all kills AND the 300 second threshold',()=>{
  for(const [all,time,expected] of [[true,300,true],[true,300.01,false],[false,100,false]]){
    const g=newGame();g.loadFloor(9);g.enemies=[];g.allKilled=all;g.elapsed=time;g.nextFloor();assert.equal(g.enemies[0].type,expected?'true_boss':'star_boss');
  }
});
test('true boss transitions through four phases and device blocks then releases damage',()=>{
  const g=newGame();g.trueBoss=true;g.loadFloor(10);const e=g.enemies[0];g.updateEnemy(e);assert.equal(e.phase,1);
  e.hp=e.maxHp*.7;g.updateEnemy(e);assert.equal(e.phase,2);
  e.hp=e.maxHp*.5;g.updateEnemy(e);assert.equal(e.phase,3);assert.ok(g.device);assert.ok(e.barrier);
  g.shot({x:e.x,y:e.y,atk:100},0,false,{speed:0});g.updateBullets();assert.equal(e.hp,6000);
  g.shot({...g.device,atk:1500},0,false,{speed:0});g.updateBullets();assert.equal(g.device.hp,0);assert.equal(e.barrier,false);
  g.updateEnemy(e);assert.equal(e.phase,4);g.shot({x:e.x,y:e.y,atk:100},0,false,{speed:0});g.updateBullets();assert.equal(e.hp,5900);
});
test('player explosive rounds split into 24; enemy rounds split into 12',()=>{
  for(const [enemy,count] of [[false,24],[true,12]]){const g=newGame();g.loadFloor(10);g.enemies=[];g.shot({x:500,y:500,atk:20},0,enemy,{explosive:true,speed:0});for(let i=0;i<30;i++)g.updateBullets();assert.equal(g.bullets.length,count);assert.ok(g.bullets.every(b=>!b.explosive));}
});
test('token effects and level cap; huge experience cannot loop past level 10',()=>{
  const g=newGame();g.player.exp=1e7;g.collect({type:'triangle',color:'red'});assert.equal(g.player.level,10);assert.equal(g.player.atk,66);
  g.player.hp=1;g.collect({type:'heart',color:'pink'});assert.equal(g.player.hp,101);
  g.collect({type:'octagon',color:'orange'});assert.equal(g.player.invBonus,8);
  g.collect({type:'pentagon',color:'purple'});assert.equal(g.player.duration,.2);
});
test('pause freezes timers and damage; victory/death each report once',()=>{
  const g=newGame();g.state='paused';const before=g.frame;g.step({shoot:true});assert.equal(g.frame,before);assert.equal(g.bullets.length,0);
  g.state='playing';g.loadFloor(10);g.enemies=[];g.nextFloor();g.finish(true);assert.equal(g.events.filter(e=>e.type==='finish').length,1);assert.equal(g.state,'victory');
  const dead=newGame();dead.player.hp=0;dead.step();dead.step();assert.equal(dead.state,'gameover');assert.equal(dead.events.filter(e=>e.type==='finish').length,1);
});
test('enemy types perform their distinctive attacks',()=>{
  for(const [type,ticks] of [['square',50],['pentagon',60],['hexagon',70],['star_boss',8]]){const g=newGame();g.loadFloor(10);g.enemies=[g.enemy(type,1000,1000)];g.player.x=1000;g.player.y=1250;for(let i=0;i<ticks;i++)g.updateEnemy(g.enemies[0]);assert.ok(g.bullets.length>0,type);}
  const g=newGame();g.loadFloor(10);const commander=g.enemy('octagon',1000,1000),ally=g.enemy('square',1100,1000);g.enemies=[commander,ally];commander.aggro=true;commander.timer=479;for(let i=0;i<60;i++)g.updateEnemy(commander);assert.ok(ally.inv>0);
});
test('bounded simulation survives multi-minute boss patterns',()=>{
  const g=newGame();g.trueBoss=true;g.loadFloor(10);
  for(let i=0;i<7200;i++){g.player.hp=g.player.maxHp;g.step({x:Math.sin(i/100),y:Math.cos(i/100),shoot:true,angle:i/60});g.events.length=0;assert.ok(Number.isFinite(g.player.x));assert.ok(g.bullets.length<10000);}
});
test('boss defeat removes fragments from enemy explosives splitting on the same tick',()=>{
  const g=newGame();g.loadFloor(10);const boss=g.enemies[0];
  g.shot({x:500,y:500,atk:30},0,true,{explosive:true,speed:0});g.bullets[0].life=1;
  g.shot({x:boss.x,y:boss.y,atk:boss.hp},0,false,{speed:0});g.updateBullets();
  assert.equal(g.enemies.length,0);assert.equal(g.bullets.filter(b=>b.enemy).length,0);
});
