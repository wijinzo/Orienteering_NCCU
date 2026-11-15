// User-supplied historical narrative, preserved verbatim; not independently fact-checked.
export const HISTORY_TEXT="你知道嗎？民國87年（1998年），政治大學中山館發生震驚全校的縱火案。一名就讀中山科學研究所的學生夏姓男子，因操行成績過低，失去校務會議代表及研學會總幹事的資格，對校方逐漸產生不滿，甚至曾在校務會議中與師長發生衝突。累積的怨氣最終演變成報復行動，他開始以縱火破壞校園，將中山館作為第一個目標。校方發現後，隨即展開調查並加強校園巡邏，然而夏姓男子並未就此收手，過了一段時間後再次返回中山館縱火，這次更使用燃燒時間較長的酒精膏，導致火勢延燒至深夜，儘管警消人員全力搶救，館內仍遭受嚴重損毀，教授辦公室中的著作與研究資料幾乎付之一炬。經過校方與警方合作調查，最終成功逮捕夏姓男子，並以公共危險罪起訴，判處有期徒刑12年。然而，事件並未隨著嫌犯落網而結束，校園接連出現模仿縱火案件，火警頻繁發生，使師生長期處於不安之中。為防止類似事件再次發生，消防局派遣消防車進駐校園一個月，教育部也補助政大900萬元，自民國89年起逐步建置監視設備，學校更進一步成立校安中心。這場縱火案不僅重創中山館，也成為政大校園安全制度改革的重要轉捩點。";

export function paginateText(text,max=65){
 const chars=Array.from(text),pages=[];let offset=0;
 while(offset<chars.length){let size=Math.min(max,chars.length-offset);if(offset+size<chars.length){const chunk=chars.slice(offset,offset+size);let boundary=-1;chunk.forEach((c,i)=>{if('，。；！？、'.includes(c)&&i>=Math.floor(max*.55))boundary=i+1;});if(boundary>0)size=boundary;}pages.push(chars.slice(offset,offset+size).join(''));offset+=size;}
 return pages;
}
export const FINALE_PAGES=[
 {speaker:'奶龍',text:'黃黃的、胖胖、又可愛，沒錯一定是皮卡丘！',kind:'reveal'},
 {speaker:'玩家',text:'……你不是奶龍嗎？'},
 {speaker:'奶龍',text:'嘿嘿，猜對啦！本龍只是想看看，你們會不會真的選皮卡丘。'},
 {speaker:'奶龍',text:'本龍一路看著你們把它們找回來……可是現在真的拼在一起，還是覺得好厲害！'},
 {speaker:'奶龍',text:'剛才還東一片、西一片的，本龍看得腦袋都打結了。還好有你們，願意陪本龍一個地方、一個地方慢慢找。'},
 {speaker:'奶龍',text:'歷史、研究、政大、火……還有 1998！嗯，這次本龍有記住，沒有少數一個。'},
 {speaker:'奶龍',text:'啊，是中山館。照片拼好的時候，那段模模糊糊的記憶，也跟著回來了。',kind:'photo'},
 {speaker:'奶龍',text:'本龍平常忘東忘西，可是這一段……不想再弄丟了。你們陪本龍聽一聽，好不好？',kind:'photo'},
 ...paginateText(HISTORY_TEXT).map(text=>({speaker:'奶龍',text,kind:'history'})),
 {speaker:'奶龍',text:'火燒掉的不只是建築，還有很多人花了很久、很久才留下的心血。',kind:'history'},
 {speaker:'奶龍',text:'有些東西沒辦法重新找回來，但我們還可以記得它。',kind:'history'},
 {speaker:'奶龍',text:'只要有人還記得，這段歷史就不會消失。',kind:'history'}
];
export const REFLECTIONS={
 campus:{label:'原來每天經過的校園，藏著這樣的故事。',reply:'對呀！本龍以前也只顧著走過去。今天有你們陪著停下來，才發現這裡還藏著這麼多回憶。'},
 remember:{label:'還好這段記憶沒有真的消失。',reply:'嗯嗯！本龍的腦袋偶爾會漏一點點，可是現在有你們也記得，就安心多了。以後路過，幫本龍再想起它一次喔。'},
 mine:{label:'我也有一段想留下的政大回憶。',reply:'真的嗎？本龍想聽！不用是什麼了不起的大事，和朋友笑過的一天，也可以是很珍貴的回憶呀。'}
};
