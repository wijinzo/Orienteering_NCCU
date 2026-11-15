export const OPENING_OPTIONS={
 help:{question:'所以說，你們願意幫本龍一個忙嗎？',options:[
  ['yes','好啊！我們來幫忙！','很好！本龍果然沒看錯人！'],
  ['guardian','你不是守護者嗎？怎麼還要我們幫忙？','守護者也只有一隻龍啊！你看我像能同時跑遍整個政大嗎！'],
  ['reward','幫忙有什麼獎勵？','記憶之境都快沒了，你還想著獎勵！先幫忙，其他的之後再說啦！']]},
 depart:{question:'你們準備好開始冒險了嗎？',options:[
  ['ready','準備好了，出發吧！','很有精神嘛！等一下爬坡的時候也要保持喔！'],
  ['where','五個地方，要從哪裡開始？','先去哪裡由你們決定！不用照順序，但五個碎片都要帶回來。'],
  ['first','先說好，我們可是第一次當守護者。','巧了，本龍也是第一次遇到記憶之境崩解！我們就一起想辦法吧！']]}
};
export const OPENING_SCENES=[
 {speaker:'旁白',text:'政大指南山深處，存在著一個名為「記憶之境」的神秘空間。'},
 {speaker:'旁白',text:'那裡保存著政大的歷史、建築，以及人們留下的回憶。'},
 {speaker:'旁白',text:'然而最近，記憶之境開始出現異常，許多珍貴的記憶逐漸破碎、消失……'},
 {text:'喂喂喂！你們幾個！對，就是你們！'},
 {text:'我是奶龍，記憶之境的守護者！'},
 {text:'最近不知道發生什麼事，記憶之境竟然開始崩解了！'},
 {text:'再這樣下去，政大好多重要的回憶都要消失啦！'},
 {slot:'help'},
 {text:'聽好了！記憶之境有五個重要的記憶碎片，現在全都散落在政大校園裡！'},
 {text:'我已經找到五個可能有線索的地方，但是光靠我一隻龍根本忙不過來！'},
 {text:'你們可以自己決定先去哪裡，每個地方都有不同的挑戰。'},
 {text:'只要把五個記憶碎片全部找回來，就有機會修復記憶之境！'},
 {text:'怎麼樣？五個地方都準備好了！'},
 {slot:'depart'},
 {text:'那就這麼說定了！'},
 {text:'記住，你們要找的是五個記憶碎片，少一個都不行！'},
 {text:'每找回一個碎片，我們就能恢復一部分失落的記憶。'},
 {text:'至於最後會發現什麼……嘿嘿，等你們找齊就知道啦！'},
 {text:'好了！別在這邊發呆了，快出發吧！'}
];
export function openingReplay(choices={}){return OPENING_SCENES.flatMap(scene=>{
 if(!scene.slot)return [scene];const item=OPENING_OPTIONS[scene.slot].options.find(([id])=>id===choices[scene.slot]);return item?[{speaker:'隊伍共同選擇',text:item[1]},{text:item[2]}]:[{speaker:'旁白',text:'這段開場沒有留下選項紀錄。'}];
});}
