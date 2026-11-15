export const MEMORY_PARTS=[
 {checkpoint:11,word:'歷史',branch:1},
 {checkpoint:13,word:'研究',branch:2},
 {checkpoint:9,word:'政大',branch:3},
 {checkpoint:12,word:'火',branch:4},
 {checkpoint:7,word:'1998',branch:5}
];
export const collectedParts=completed=>MEMORY_PARTS.filter(p=>completed?.includes(String(p.checkpoint)));
export const validMemoryOrder=order=>Array.isArray(order)&&order.length===5&&new Set(order).size===5&&order.every(id=>Number.isInteger(id)&&id>=0&&id<5);
export const solvedMemoryOrder=order=>validMemoryOrder(order)&&order.every((id,index)=>id===index);
