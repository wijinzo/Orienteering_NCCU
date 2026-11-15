export const ACHIEVEMENTS=[
 {code:'first_finish',name:'拯救世界的高手',scope:'隊伍',description:'成為同一活動第一隊完成最終關卡的隊伍。'},
 {code:'all_locations',name:'彩蛋蒐集者',scope:'隊伍',description:'實際完成全部 13 個地點；番外補看不計入。'},
 {code:'cipher_master',name:'密碼破解高手',scope:'隊伍',description:'在地點 5 的前 5 次猜測內解開密碼。'},
 {code:'memory_collector',name:'回憶收藏家',scope:'個人',description:'看完結局，並儲存自己的政大回憶。'},
 {code:'pinball_star',name:'彈射世界新星',scope:'個人',description:'在正式地點 3 的第一輪（前 3 次彈射）清完全部奶蛙。'}
];
export function elapsedText(start,finish){
 if(!start||!Number.isFinite(Date.parse(start))||!Number.isFinite(finish))return '—';
 const seconds=Math.max(0,Math.floor((finish-Date.parse(start))/1000));
 return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':');
}
export function achievementProgress(item){
 if(item?.unlocked)return '已解鎖';if(!item)return '尚未解鎖';
 if(item.code==='first_finish')return item.status==='missed'?'本場已有隊伍率先通關':'等待第一隊通關';
 if(item.code==='all_locations')return `${item.progress}／13 個地點`;
 if(item.code==='cipher_master')return item.status==='missed'?'本次已超過 5 次猜測':`目前猜測 ${item.progress} 次`;
 if(item.code==='pinball_star')return item.status==='unknown'?'舊紀錄無法判定':item.status==='missed'?'本次未在第一輪完成':'第一輪清完即可解鎖';
 return '尚未解鎖';
}
