/* Prism Core: deterministic 60 Hz simulation, independent of the browser UI. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2, TILE = 20, SIZE = 100;
  const EXP = [50,150,250,400,600,800,1000,1200,1500];
  const TYPES = {
    triangle: {hp:80, atk:20, speed:3.75, radius:15, color:'#ff6178', sides:3, exp:20},
    square: {hp:200, atk:20, speed:1.5, radius:18, color:'#73f6a5', sides:4, exp:40},
    heart: {hp:50, atk:0, speed:3.75, radius:16, color:'#ff9bcb', sides:0, exp:80},
    pentagon: {hp:350, atk:30, speed:1.35, radius:20, color:'#b78aff', sides:5, exp:80},
    hexagon: {hp:300, atk:50, speed:3.9, radius:22, color:'#6ce3ff', sides:6, exp:150},
    octagon: {hp:500, atk:10, speed:.99, radius:24, color:'#ffb967', sides:8, exp:200},
    star_boss: {hp:8000, atk:50, speed:.75, radius:80, color:'#ffe589', sides:10, exp:0},
    true_boss: {hp:12000, atk:60, speed:.45, radius:100, color:'#eef8ff', sides:4, exp:0}
  };
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  const center = r => ({x:Math.floor(r.x+r.w/2)*TILE,y:Math.floor(r.y+r.h/2)*TILE});
  class Dungeon {
    constructor(floor, random=Math.random) {
      this.random=random; this.grid=new Uint8Array(SIZE*SIZE).fill(1); this.rooms=[];
      this.seen=new Uint8Array(SIZE*SIZE);
      if(floor===10){this.grid.fill(0);this.rooms=[{x:0,y:0,w:100,h:100}];return;}
      const sizes=Array.from({length:this.int(floor<=4?2:5,floor<=4?6:9)},()=>this.pick([25,17,11])).sort((a,b)=>b-a);
      for(const initial of sizes){
        let placed=false;
        for(const size of [25,17,11].filter(s=>s<=initial)){
          for(let n=0;n<10&&!placed;n++){
            const r={x:this.int(5,95-size),y:this.int(5,95-size),w:size,h:size};
            if(this.rooms.some(q=>r.x<q.x+q.w+3&&r.x+r.w+3>q.x&&r.y<q.y+q.h+3&&r.y+r.h+3>q.y))continue;
            this.rooms.push(r);this.carve(r.x,r.y,r.w,r.h);placed=true;
          }
          if(placed)break;
        }
      }
      if(!this.rooms.length){this.rooms.push({x:40,y:40,w:17,h:17});this.carve(40,40,17,17);}
      for(let i=1;i<this.rooms.length;i++){
        const a=center(this.rooms[i-1]),b=center(this.rooms[i]);
        const x1=a.x/TILE,y1=a.y/TILE,x2=b.x/TILE,y2=b.y/TILE;
        const horizontalFirst=this.random()<.5;
        this.carve(Math.min(x1,x2),(horizontalFirst?y1:y2)-2,Math.abs(x2-x1)+1,4);
        this.carve((horizontalFirst?x2:x1)-2,Math.min(y1,y2),4,Math.abs(y2-y1)+1);
      }
    }
    int(a,b){return a+Math.floor(this.random()*(b-a+1));}
    pick(a){return a[this.int(0,a.length-1)];}
    carve(x,y,w,h){for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++)if(i>=0&&j>=0&&i<SIZE&&j<SIZE)this.grid[j*SIZE+i]=0;}
    wall(x,y){return x<0||y<0||x>=2000||y>=2000||this.grid[Math.floor(y/TILE)*SIZE+Math.floor(x/TILE)]!==0;}
    point(r){return {x:this.int(r.x+1,r.x+r.w-2)*TILE+10,y:this.int(r.y+1,r.y+r.h-2)*TILE+10};}
    discover(p){
      const gx=Math.floor(p.x/TILE),gy=Math.floor(p.y/TILE);
      for(let y=gy-5;y<=gy+5;y++)for(let x=gx-5;x<=gx+5;x++)if(x>=0&&y>=0&&x<SIZE&&y<SIZE)this.seen[y*SIZE+x]=1;
      for(const r of this.rooms)if(gx>=r.x&&gx<r.x+r.w&&gy>=r.y&&gy<r.y+r.h)
        for(let y=r.y;y<r.y+r.h;y++)for(let x=r.x;x<r.x+r.w;x++)this.seen[y*SIZE+x]=1;
    }
  }
  class Game {
    constructor(random=Math.random){this.random=random;this.events=[];this.state='home';this.frame=0;}
    emit(type,data={}){this.events.push({type,...data});}
    start(){
      this.frame=0;this.elapsed=0;this.kills={};this.allKilled=true;this.trueBoss=false;this.state='playing';
      this.player={x:0,y:0,radius:8,hp:200,maxHp:200,atk:20,speed:6,level:1,exp:0,inv:0,explosive:0,homing:0,duration:0,invBonus:0,atkBonus:0,hpBonus:0,speedBonus:0};
      this.loadFloor(1);
    }
    loadFloor(floor){
      this.floor=floor;this.dungeon=new Dungeon(floor,this.random);this.enemies=[];this.bullets=[];this.tokens=[];this.switches=[];this.effects=[];this.device=null;this.power=null;this.portal=null;this.cooldown=0;
      Object.assign(this.player,center(this.dungeon.rooms[0]));this.player.hp=this.player.maxHp;
      if(floor===10){this.player.y+=300;this.enemies.push(this.enemy(this.trueBoss?'true_boss':'star_boss',1000,1000));}
      else {
        const count=5+floor+this.dungeon.int(0,3);
        for(let n=0;n<count*5&&this.enemies.length<count;n++){
          const r=this.dungeon.pick(this.dungeon.rooms),c=center(r);
          const p={x:c.x+this.dungeon.int(-Math.ceil(r.w/3),Math.floor(r.w/3))*20,y:c.y+this.dungeon.int(-Math.ceil(r.h/3),Math.floor(r.h/3))*20};
          if(distance(p,this.player)<200||this.dungeon.wall(p.x,p.y))continue;
          const roll=this.random();let type;
          if(floor<=3)type=roll<.1?'heart':roll<.6?'triangle':'square';
          else if(floor<=6)type=roll<.1?'heart':roll<.2?'octagon':roll<.3?'triangle':roll<.65?'square':'pentagon';
          else type=roll<.1?'heart':roll<.2?'octagon':roll<.4?'square':roll<.7?'pentagon':'hexagon';
          if(type==='octagon'&&this.enemies.some(e=>e.type===type))type=floor<=6?'triangle':'square';
          const e=this.enemy(type,p.x,p.y);
          if(this.enemies.every(q=>distance(e,q)>e.radius+q.radius+8))this.enemies.push(e);
        }
        const rooms=[...this.dungeon.rooms];
        for(let i=rooms.length-1;i>0;i--){const j=this.dungeon.int(0,i);[rooms[i],rooms[j]]=[rooms[j],rooms[i]];}
        const countSwitches=rooms.length>=7?3:rooms.length>=4?2:1;
        this.switches=rooms.slice(0,countSwitches).map(r=>({...this.dungeon.point(r),active:false}));
      }
      if(floor===10||this.random()<.5){
        const rooms=floor===10?this.dungeon.rooms:this.dungeon.rooms.slice(1);
        if(rooms.length){let p;for(let n=0;n<100;n++){p=this.dungeon.point(this.dungeon.pick(rooms));if(floor<10||distance(p,{x:1000,y:1000})>=300)break;}
          this.power={...p,type:this.random()<.5?'explosive':'homing'};}
      }
      this.dungeon.discover(this.player);this.emit('floor',{floor,trueBoss:this.trueBoss});
    }
    enemy(type,x,y){const t=TYPES[type],boss=type.includes('boss'),group=boss?0:Math.floor((this.floor-1)/2);return {...t,type,x,y,hp:t.hp+30*group,maxHp:t.hp+30*group,atk:t.atk+10*group,group,aggro:boss,inv:0,timer:0,wave:0,phase:1,barrier:false,triggered:false,pattern:false,homingTimer:0};}
    move(entity,dx,dy,separate=false){
      const clear=(x,y)=>!this.dungeon.wall(x,y)&&(!separate||this.enemies.every(q=>q===entity||q.hp<=0||Math.hypot(q.x-x,q.y-y)>=q.radius+entity.radius+2));
      if(clear(entity.x+dx,entity.y))entity.x+=dx;
      if(clear(entity.x,entity.y+dy))entity.y+=dy;
    }
    shot(source,angle,enemy=false,options={}){
      const explosive=!!options.explosive;
      this.bullets.push({x:source.x,y:source.y,angle,enemy,damage:source.atk,radius:explosive?20:enemy?5:4,speed:enemy?(explosive?5:6):7,life:explosive?30:-1,homing:0,delay:0,dead:false,...options});
      if(enemy)this.emit('sound',{name:explosive?'explosion_shoot':'enemy_shoot'});
    }
    ring(e,count,offset,speed){for(let i=0;i<count;i++)this.shot(e,i*TAU/count+offset,true,{speed});}
    hitPlayer(damage,cooldown=30+this.player.invBonus){
      const p=this.player;if(p.inv>0)return;
      p.hp=Math.max(0,p.hp-damage);p.inv=cooldown;this.effect(p,`−${damage}`,'#ff6178');this.emit('sound',{name:'player_damage'});
    }
    effect(p,text,color){this.effects.push({x:p.x,y:p.y,text,color,life:45});}
    updateEnemy(e){
      const p=this.player,d=distance(e,p);e.inv=Math.max(0,e.inv-1);
      e.aggro=e.aggro||d<(e.type==='heart'||e.type==='octagon'?1000:400);if(!e.aggro)return;
      let factor=1;if(e.type==='heart')factor=d<150?-1:d>200?1:0;
      if(d>0)this.move(e,(p.x-e.x)/d*e.speed*factor,(p.y-e.y)/d*e.speed*factor,true);
      if(e.type==='triangle'&&distance(e,p)<e.radius+p.radius)this.hitPlayer(e.atk,60);
      e.timer++;
      const angle=Math.atan2(p.y-e.y,p.x-e.x),time=this.frame*1000/60;
      if(e.type==='square'&&e.timer>=50){e.timer=0;this.shot(e,angle,true,{homing:20});}
      if(e.type==='pentagon'&&e.timer>=60){e.timer=0;this.ring(e,10,time*.008,6);}
      if(e.type==='hexagon'&&e.timer>=70){e.timer=0;this.shot(e,angle,true,{explosive:true,speed:6});}
      if(e.type==='octagon'||e.type==='heart'){
        const heal=e.type==='heart',duration=heal?30:60,maxRadius=heal?300:400;
        if(heal&&d>300&&!this.enemies.some(q=>q!==e&&distance(e,q)<=300))e.timer--;
        if(e.timer>=(heal?90:480)){e.timer=0;e.wave=duration;e.healed=false;}
        if(e.wave>0){e.wave--;const r=(duration-e.wave)/duration*maxRadius;
          for(const q of this.enemies)if(q!==e&&q.hp>0){const dist=distance(e,q);
            if(!heal&&dist<=r)q.inv=180;
            else if(heal&&dist<=r&&dist>r-20&&q.hp<q.maxHp){q.hp=Math.min(q.maxHp,q.hp+60+e.group*10);e.healed=true;this.emit('sound',{name:'heal'});}
          }
          if(heal&&!e.healed&&d<=r&&d>r-20){p.hp=Math.min(p.maxHp,p.hp+60+e.group*10);e.healed=true;this.emit('sound',{name:'heal'});}
        }
      }
      if(e.type==='star_boss'&&e.timer>=8){e.timer=0;const first=e.hp>e.maxHp/2;this.ring(e,first?12:18,time*(first?.0005:-.001),first?4:4.5);}
      if(e.type==='true_boss'){
        if(e.hp/e.maxHp>.75)e.phase=1;
        else if(e.hp/e.maxHp>.5)e.phase=2;
        else if(!e.triggered){e.phase=3;e.barrier=true;e.triggered=true;let pos;
          for(let n=0;n<10;n++){const a=this.random()*TAU,r=200+this.random()*200;pos={x:e.x+Math.cos(a)*r,y:e.y+Math.sin(a)*r};if(!this.dungeon.wall(pos.x,pos.y))break;}
          if(this.dungeon.wall(pos.x,pos.y))pos={x:clamp(e.x,40,1960),y:clamp(e.y-300,40,1960)};
          this.device={...pos,hp:1500,maxHp:1500};this.emit('sound',{name:'barrier_activate'});
        }else e.phase=e.barrier?3:4;
        const interval=[0,15,12,100,8][e.phase];
        if(e.timer>=interval){e.timer=0;e.pattern=!e.pattern;
          if(e.phase===1)this.ring(e,e.pattern?12:24,time*.0005,4);
          if(e.phase===2)this.shot(e,this.random()*TAU,true,{explosive:true,speed:5});
          if(e.phase===3)for(let i=0;i<8;i++)this.shot(e,i*TAU/8+time*.005,true,{speed:5,homing:60,delay:60});
          if(e.phase===4)this.ring(e,e.pattern?16:24,time*-.0005,3);
        }
        if(e.phase===4&&++e.homingTimer>=180){e.homingTimer=0;this.shot(e,angle,true,{speed:4,homing:120});}
      }
    }
    kill(e){
      this.kills[e.type]=(this.kills[e.type]||0)+1;
      this.emit('kill',{enemy:e.type});this.emit('sound',{name:'enemy_defeat'});
      if(e.type.includes('boss')){for(const b of this.bullets)if(b.enemy)b.dead=true;}
      else this.tokens.push({x:e.x,y:e.y,type:e.type,color:e.color});
      for(let i=0;i<10;i++)this.effects.push({x:e.x,y:e.y,color:e.color,life:25,dx:(this.random()-.5)*7,dy:(this.random()-.5)*7});
    }
    collect(token){
      const p=this.player;p.exp+=TYPES[token.type].exp;
      while(p.level<10&&p.exp>=EXP[p.level-1]){p.exp-=EXP[p.level-1];p.level++;p.maxHp+=20;p.hp=p.maxHp;p.atk+=5;this.emit('sound',{name:'level_up'});this.effect(p,'LEVEL UP','#ffe589');}
      if(p.level>=10)p.exp=0;
      let label='';
      switch(token.type){
        case 'triangle':p.atk++;p.atkBonus++;label='+1 ATK';break;
        case 'square':p.maxHp+=2;p.hp+=2;p.hpBonus+=2;label='+2 HP';break;
        case 'pentagon':p.duration+=.2;label='+0.2s';break;
        case 'hexagon':p.speed+=.05;p.speedBonus+=.05;label='+0.05 SPD';break;
        case 'octagon':p.invBonus+=8;label='+8 INV';break;
        case 'heart':p.hp=Math.min(p.maxHp,p.hp+100);label='+100 HP';break;
      }
      this.effect(p,label,token.color);this.emit('sound',{name:'item_get'});
    }
    updateBullets(){
      const p=this.player,newBullets=[];
      let bossDefeated=false;
      for(const b of this.bullets){
        if(b.dead)continue;
        if(b.delay>0)b.delay--;
        else if(b.homing>0){let target=p;
          if(!b.enemy)target=this.enemies.filter(e=>e.hp>0).reduce((best,e)=>!best||distance(b,e)<distance(b,best)?e:best,null);
          if(target)b.angle=Math.atan2(target.y-b.y,target.x-b.x);b.homing--;
        }
        b.x+=Math.cos(b.angle)*b.speed;b.y+=Math.sin(b.angle)*b.speed;
        if(this.dungeon.wall(b.x,b.y)){b.dead=true;continue;}
        if(b.life>0&&--b.life===0){
          const count=b.enemy?12:24;for(let i=0;i<count;i++)newBullets.push({...b,angle:i*TAU/count,life:-1,explosive:false,radius:b.enemy?5:4,speed:b.enemy?6:7,homing:0,delay:0});b.dead=true;continue;
        }
        if(b.enemy){if(distance(b,p)<b.radius+p.radius){this.hitPlayer(b.damage);b.dead=true;}}
        else {
          for(const e of this.enemies)if(e.hp>0&&distance(b,e)<b.radius+e.radius){
            const damage=e.inv>0||e.barrier?0:b.damage;e.hp=Math.max(0,e.hp-damage);b.dead=true;
            this.effect(b,damage?String(damage):'GUARD',e.color);this.emit('sound',{name:'enemy_damage'});
            if(e.hp===0){this.kill(e);if(e.type.includes('boss'))bossDefeated=true;}break;
          }
          if(!b.dead&&this.device&&this.device.hp>0&&distance(b,this.device)<20+b.radius){
            this.device.hp=Math.max(0,this.device.hp-b.damage);b.dead=true;this.effect(b,String(b.damage),'#6ce3ff');
            if(this.device.hp===0){for(const e of this.enemies)e.barrier=false;this.emit('sound',{name:'barrier_destroy'});}
          }
        }
      }
      this.bullets=this.bullets.filter(b=>!b.dead).concat(newBullets).filter(b=>!bossDefeated||!b.enemy);this.enemies=this.enemies.filter(e=>e.hp>0);
    }
    finish(win){if(this.state!=='playing')return;this.state=win?'victory':'gameover';this.emit('finish',{win,floor:this.floor,time:this.elapsed,level:this.player.level,kills:{...this.kills},trueBoss:this.trueBoss});}
    nextFloor(){
      this.allKilled=this.allKilled&&this.enemies.length===0;
      if(this.floor===10){this.finish(true);return;}
      if(this.floor===9)this.trueBoss=this.allKilled&&this.elapsed<=300;
      this.loadFloor(this.floor+1);this.emit('sound',{name:'warp_enter'});
    }
    step(input={}){
      if(this.state!=='playing')return;
      this.frame++;this.elapsed=this.frame/60;
      const p=this.player;let dx=input.x||0,dy=input.y||0;const len=Math.hypot(dx,dy);if(len>1){dx/=len;dy/=len;}
      this.move(p,dx*p.speed,dy*p.speed);p.inv=Math.max(0,p.inv-1);p.explosive=Math.max(0,p.explosive-1);p.homing=Math.max(0,p.homing-1);
      this.cooldown=Math.max(0,this.cooldown-1);
      if(input.shoot&&this.cooldown===0){this.shot(p,input.angle||0,false,{explosive:p.explosive>0,homing:p.homing>0?600:0});this.cooldown=10;this.emit('sound',{name:p.explosive?'explosion_shoot':'player_shoot'});}
      for(const e of this.enemies)this.updateEnemy(e);
      this.updateBullets();
      // Death takes priority over a switch, heal pickup or floor transition on this tick.
      if(p.hp<=0){this.finish(false);return;}
      this.tokens=this.tokens.filter(t=>{if(distance(p,t)<23){this.collect(t);return false;}return true;});
      if(this.power&&distance(p,this.power)<23){p[this.power.type]=300+Math.round(p.duration*60);this.emit('sound',{name:'item_get'});this.power=null;}
      for(const sw of this.switches)if(!sw.active&&Math.abs(p.x-sw.x)<=28&&Math.abs(p.y-sw.y)<=18){sw.active=true;this.emit('sound',{name:'button_click'});}
      if(!this.portal&&(this.floor===10?this.enemies.length===0:this.switches.every(sw=>sw.active))){this.portal=center(this.dungeon.pick(this.dungeon.rooms));this.portal.delay=30;this.emit('portal');}
      if(this.portal){if(this.portal.delay>0)this.portal.delay--;else if(distance(p,this.portal)<28){this.nextFloor();return;}}
      this.dungeon.discover(p);
      for(const fx of this.effects){fx.life--;fx.x+=fx.dx||0;fx.y+=fx.dy||-.5;}
      this.effects=this.effects.filter(f=>f.life>0).slice(-180);
    }
  }
  const api={Game,Dungeon,TYPES,EXP,TAU,TILE,SIZE,clamp,distance,center};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.Prism=api;
})(typeof globalThis!=='undefined'?globalThis:this);
