export const isSoloTeam=team=>team?.mode==='solo';
export const teamDisplayName=team=>isSoloTeam(team)?'個人冒險':team?`第 ${Number(team.code)} 組`:'正在讀取組別';
