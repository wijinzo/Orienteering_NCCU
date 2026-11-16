export const CREDITS_MUSIC='https://www.youtube.com/watch?v=eZ4s8zc26nM';
export const CREDITS_AUDIO='/assets/music/credits.m4a?v=loudness-1';
export const CREDITS_SIGNATURE='製作｜第七組、第十組';
export const CREDITS_EPILOGUE=[
 '只要有人還記得，這段歷史就不會消失。',
 '中山館在火災後失去使用功能，於 2000 年拆除。建築雖然離開了校園，關於它的記錄仍被保存下來。',
 '根據 2012 年監察院公報，夏興國被判有期徒刑 12 年確定，刑滿出獄後，曾對火災鑑定、告發與司法程序提出陳訴。這項記載不代表原判決已被撤銷。',
 '今天，你們陪奶龍找回了五段記憶。往後再走過校園，也許會想起，那些熟悉的角落曾經留下的故事。',
 '謝謝你陪奶龍找回這些記憶。'
];
export const CREDITS_SOURCES=[
 {title:'中山館相關資料',links:[
  {label:'政大記憶網｜中山館',url:'https://nccuwiki.lib.nccu.edu.tw/index.php/中山館',note:'建築沿革與火災記錄'},
  {label:'監察院公報第 2816 期',url:'https://www-ws.cy.gov.tw/Download.ashx?icon=..pdf&n=MTAxMDAwMDI5MjgxNijlhajvvIzmnKzmnJ%2Fljp%2FlpJbntrLmqpTmoYjjgIHmnKzlrqTnlZnlrZjmqpTlnYfnhKHnm67mrKHpgKPntZApLnBkZg%3D%3D&u=LzAwMS9VcGxvYWQvQ3lPbGRGaWxlL09wX1VwbG9hZC9lRG9jL%2BWFrOWgsS8xMDEvMTAxMDAwMDI5MjgxNijlhajvvIzmnKzmnJ%2Fljp%2FlpJbntrLmqpTmoYjjgIHmnKzlrqTnlZnlrZjmqpTlnYfnhKHnm67mrKHpgKPntZApLnBkZg%3D%3D',note:'2012 年官方文件，紙本頁碼 49，記載出獄後陳訴與函復'},
  {label:'中山館相關 Instagram 貼文',url:'https://www.instagram.com/p/DQ8899HEpQM/',note:'社群延伸閱讀'},
  {label:'夏興國部落格｜個人陳述',url:'https://uranusreleo05.blogspot.com/2011/09/blog-post.html',note:'個人主張，與官方記錄及司法認定分開閱讀'}
 ]},
 {title:'更多校園故事',links:[
  {label:'政大校史與檔案資源',url:'https://archive.lib.nccu.edu.tw/'},
  {label:'政大記憶網',url:'https://nccuwiki.lib.nccu.edu.tw/index.php/首頁'},
  {label:'Dcard｜政大冷知識接龍',url:'https://www.dcard.tw/f/nccu/p/254458215',note:'校園社群分享'},
  {label:'Facebook｜政大冷知識影片',url:'https://www.facebook.com/NCCUEA/videos/1648348423179770/',note:'校園社群分享'}
 ]}
];
// A foreground frame never catches up time spent in a background tab.
export function advanceCredits(position,elapsedMs,maximum){return Math.min(Math.max(0,maximum),position+Math.min(50,Math.max(0,elapsedMs))*0.025);}
