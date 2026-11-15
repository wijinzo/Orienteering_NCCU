import {STORY_INTRO,STORY_END,storyReply,PINBALL_REPLIES} from './story-data.js';
import {STORY_OPTIONS} from './story-vote.js';
import {FINALE_PAGES,REFLECTIONS} from './finale-data.js';
import {openingReplay} from './prologue-data.js';
export const STORY_TITLES={0:'開場｜奶龍的委託',1:'地點 1｜政大小天才',2:'地點 2｜奶蛙學長',3:'地點 3｜奶蛋彈珠',4:'地點 4｜石碑挑戰',5:'地點 5｜數字密碼',6:'地點 6｜奶龍來電',7:'地點 7｜找回時間線',8:'地點 8｜奶龍來電',9:'地點 9｜建築的記憶',10:'地點 10｜最後的記憶',11:'地點 11｜找奶蛙',12:'地點 12｜遺失的訊息',13:'地點 13｜拼回老照片'};
const imageFor=speaker=>speaker==='奶蛋'?'/assets/characters/naiegg.png':speaker==='奶蛙們'?'/assets/characters/naifrog.png':speaker?.includes('學長')?'/assets/characters/senior.png':'/assets/characters/nailong.png';
const normalize=(item,cp)=>typeof item==='string'?{text:item,character:cp===2?'奶蛙學長':'奶龍',image:cp===2?imageFor('學長'):imageFor('奶龍')}:{text:item[1],character:item[0],image:cp===2?imageFor('學長'):imageFor(item[0]),hideActor:item[2]===false};
const narration=text=>({character:'旁白',text});
const selected=(cp,slot,choice)=>{const label=STORY_OPTIONS[`${cp}:${slot}`]?.find(([id])=>id===choice)?.[1];return label?[{character:'隊伍共同選擇',text:label}]:[];};
export function replayScenes({checkpoint:cp,run:r}){
 if(cp===0)return openingReplay(r.choices).map(item=>({...item,character:item.speaker??'奶龍'}));
 if(cp===10){const reflection=REFLECTIONS[r.reflection];return [...selected(10,'guess','nailong'),...FINALE_PAGES.map(item=>({...item,character:item.speaker})),...(reflection?[{character:'你的感想',text:reflection.label},{text:reflection.reply}]:[])];}
 const scenes=(STORY_INTRO[cp]??[]).map(item=>normalize(item,cp));scenes.push(...selected(cp,'intro',r.choice));
 const reply=storyReply(cp,r.choice);if(reply)scenes.push({text:reply,character:cp===2?'奶蛙學長':'奶龍',image:cp===2?imageFor('學長'):imageFor('奶龍')});
 if(cp===3)scenes.push(...PINBALL_REPLIES[r.choice==='egg'?'egg':'care'].map(item=>normalize(item,cp)));
 scenes.push(narration('關卡結束'));
 if(cp===1)scenes.push(...(r.passed?['不是，沒人跟我說走在政大真的會遇到政大小天才','接下來去四維堂門口吧！那裡還有需要你們幫忙的事。']:['你們超過兩個人答錯！！你一點都不懂我們政大😭😭😭','快去校碑，那裡有某人留給你們的訊息']).map(text=>({text})));
 else if(cp===4)scenes.push(...(r.passed?['看來你們有點東西，這是關於記憶碎片位置的線索，能不能找到就憑你們的本事了','下一站，教育學院！看看你們能不能把接下來的線索解開。']:['就這樣也想找記憶碎片？快去綜院，那裡有某人留下的訊息']).map(text=>({text})));
 else scenes.push(...(STORY_END[cp]??[]).map((item,index)=>cp===2?{text:item,character:index===3?'玩家':'奶蛙學長',image:imageFor('學長')}:normalize(item,cp)));
 if(cp===5){scenes.push(...selected(5,'ending',r.ending_choice));if(r.ending_choice)scenes.push({text:r.ending_choice==='history'?'1998……這個年份好熟悉，可是本龍現在還想不起完整的事情。先把其他碎片找回來吧。':'嗯，先記好這組數字。也許等記憶恢復，就知道它為什麼留在這裡了。'});scenes.push({text:'下一站去傳院吧！'});}
 if(cp===7)scenes.push({text:'太好了，雖然只是暫時停止，但至少為我們爭取了一些時間，幹得好！'});
 return scenes;
}
