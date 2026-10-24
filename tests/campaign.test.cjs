const test=require('node:test'),assert=require('node:assert/strict');
const {Game,distance}=require('../core.js');
const random=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const cell=p=>Math.floor(p.y/20)*100+Math.floor(p.x/20);
function pathTo(d,from,to){
  const start=cell(from),end=cell(to),prev=new Int32Array(10000).fill(-1),queue=[start];prev[start]=start;
  for(let i=0;i<queue.length&&prev[end]<0;i++){
    const k=queue[i],x=k%100,y=Math.floor(k/100);
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=x+dx,ny=y+dy,n=ny*100+nx;
      if(nx<0||ny<0||nx>=100||ny>=100||d.grid[n]||prev[n]>=0)continue;
      prev[n]=k;queue.push(n);
    }
  }
  assert.ok(prev[end]>=0,'pilot target must be reachable');const route=[];
  for(let k=end;k!==start;k=prev[k])route.unshift({x:(k%100)*20+10,y:Math.floor(k/100)*20+10});
  return route;
}
function lineOfSight(d,a,b){const steps=Math.ceil(distance(a,b)/8);for(let i=1;i<=steps;i++)if(d.wall(a.x+(b.x-a.x)*i/steps,a.y+(b.y-a.y)*i/steps))return false;return true;}
function runCampaign(skipFirstFloorEnemies){
  const g=new Game(random(7));g.start();
  // This is a progression test, not a difficulty/skill assessment. Only the test
  // pilot gets extra health and damage; production values and maps are untouched.
  g.player.hp=g.player.maxHp=1000000;g.player.atk=500;
  const floors=new Set(),bossPhases=new Set();let route=[],routeKey='',target=null,result=null;
  for(let tick=0;tick<60000&&g.state==='playing';tick++){
    floors.add(g.floor);const p=g.player;
    const fight=!(skipFirstFloorEnemies&&g.floor===1);
    const boss=g.enemies.find(e=>e.type.includes('boss'));if(boss)bossPhases.add(`${boss.type}:${boss.phase}`);
    if(g.device?.hp>0)target=g.device;
    else if(fight&&g.enemies.length)target=g.enemies.reduce((a,b)=>distance(p,a)<distance(p,b)?a:b);
    else target=g.switches.filter(s=>!s.active).sort((a,b)=>distance(p,a)-distance(p,b))[0]||g.portal;
    const attack=target&&(g.enemies.includes(target)||target===g.device);
    let x=0,y=0;
    if(target&&!(attack&&distance(p,target)<(target.type==='heart'?90:180)&&lineOfSight(g.dungeon,p,target))){
      const key=`${g.floor}:${cell(target)}`;
      if(key!==routeKey||!route.length){route=pathTo(g.dungeon,p,target);routeKey=key;}
      while(route.length&&distance(p,route[0])<3)route.shift();
      const waypoint=route[0]||target,dx=waypoint.x-p.x,dy=waypoint.y-p.y,n=Math.hypot(dx,dy);
      if(n>0){const speed=Math.min(1,n/p.speed);x=dx/n*speed;y=dy/n*speed;}
    }
    g.step({x,y,shoot:!!attack,angle:target?Math.atan2(target.y-p.y,target.x-p.x):0});
    for(const event of g.events)if(event.type==='finish')result=event;
    g.events.length=0;
  }
  assert.equal(g.state,'victory',`pilot stopped at floor ${g.floor}, time ${g.elapsed}, enemies ${g.enemies.length}; player ${JSON.stringify({x:g.player.x,y:g.player.y})}; target ${JSON.stringify(target)}; waypoint ${JSON.stringify(route[0])}`);
  assert.equal(floors.size,10);assert.ok(result?.win);assert.equal(result.floor,10);
  if(skipFirstFloorEnemies){assert.equal(result.trueBoss,false);assert.equal(result.kills.star_boss,1);}
  else {assert.equal(result.trueBoss,true);assert.equal(result.kills.true_boss,1);for(let phase=1;phase<=4;phase++)assert.ok(bossPhases.has(`true_boss:${phase}`),`phase ${phase}`);}
  return {time:result.time,kills:result.kills};
}
test('input-driven pilot traverses floors 1–10 and clears the standard boss route',()=>runCampaign(true));
test('input-driven pilot clears floors 1–9, unlocks true boss and destroys its barrier',()=>runCampaign(false));
