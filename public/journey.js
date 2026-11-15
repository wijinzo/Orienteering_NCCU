import {startSightings,stopSightings} from './sightings.js';
import {startMemories,stopMemories,createMemoryCenter} from './memories.js';
import {MEMORY_PARTS} from './memory-data.js';
import {isSoloTeam,teamDisplayName} from './play-mode.js';
let finalSelected=false,memorySummary=null,foregroundTeamPending=false;
const $ = id => document.getElementById(id);
const branches = [
    { roman: 'I', start: 1, end: 11, detour: 8 },
    { roman: 'II', start: 2, end: 13 },
    { roman: 'III', start: 3, end: 9 },
    { roman: 'IV', start: 4, end: 12, detour: 6 },
    { roman: 'V', start: 5, end: 7 },
];
let api, player, team = null, timer, selected = 0, progress, gameProgress = null, activeRun = null, busy = false, version = 0, requestVersion = 0, unlocked = false;
export function stopJourney() { stopMemories(); stopSightings(); finalSelected=false; memorySummary=null; clearTimeout(timer); version++; player = null; team = null; gameProgress = null; activeRun = null; window.dispatchEvent(new Event('journey-stopped')); }
export function selectTab(name) {
    if (!unlocked) name = 'team';
    document.querySelector('.app-shell').dataset.page = name;
    window.dispatchEvent(new CustomEvent('journey-tab', { detail: name }));
    for (const panel of document.querySelectorAll('.tab-panel')) panel.hidden = panel.id !== `${name}-panel`;
    for (const button of document.querySelectorAll('.bottom-nav button')) {
        if (button.dataset.tab === name) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    }
}
function has(id) { const source = [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13].includes(id) && gameProgress ? gameProgress : progress; return source?.completed_checkpoints.includes(String(id)) ?? false; }
function isSelectedRun() { return !!activeRun && (selected === 0 ? [1,8,11].includes(activeRun.checkpoint) : selected === 1 ? [2,13].includes(activeRun.checkpoint) : selected === 2 ? [3,9].includes(activeRun.checkpoint) : selected === 3 ? [4,6,12].includes(activeRun.checkpoint) : selected === 4 ? [5,7].includes(activeRun.checkpoint) : activeRun.checkpoint === branches[selected].start); }
export function renderJourneyProgress(value) { progress = value; renderFlower(); }
function renderFlower() {
    $('fragment-count').textContent = branches.filter(b => has(b.end)).length;
    $('memory-flower').replaceChildren(...branches.map((b, i) => {
        const button = document.createElement('button'); button.className = 'petal'; button.style.setProperty('--angle', `${i * 72}deg`); button.setAttribute('aria-pressed', String(selected === i));
        const shape = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        shape.setAttribute('viewBox', '0 0 280 280');
        shape.setAttribute('aria-hidden', 'true');
        const outline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        outline.setAttribute('d', 'M140 140 L79 56 C85 -10 195 -10 201 56 Z');
        shape.append(outline);
        const label = document.createElement('span');
        if(has(b.end)){
            label.classList.add('petal-with-fragment');const title=document.createElement('small');title.className='petal-branch-title';title.textContent=`記憶 ${b.roman}`;
            const word=document.createElement('strong');word.className='petal-fragment';word.textContent=MEMORY_PARTS[i].word;label.append(title,word);
        }else label.append(`記憶 ${b.roman}`);
        const status = document.createElement('small'); status.textContent = has(b.end) ? '✓ 已完成' : has(b.start) ? '進行中' : '未開始'; label.append(status); button.append(shape, label); button.onclick = () => { selected = i; finalSelected=false; renderFlower(); }; return button;
    }));
    $('memory-flower').append(createMemoryCenter());
    let access=$('memory-access');if(!access){access=document.createElement('button');access.id='memory-access';access.type='button';access.className='memory-access';access.onclick=()=>window.dispatchEvent(new Event('open-memories'));$('memory-flower').after(access);}access.textContent=`查看記憶碎片 ${branches.filter(b=>has(b.end)).length}／5`;
    const b = branches[selected], completed = has(b.end);
    $('mission-title').textContent = `記憶 ${b.roman}`; $('mission-status').textContent = completed ? '已完成' : has(b.start) ? '進行中' : '尚未開始';
    const routeChoices = [0,3].includes(selected) && gameProgress ? gameProgress.choices : progress?.choices;
    const detour = b.detour && (routeChoices?.[`branch_${selected + 1}_detour`] === true || has(b.detour));
    const route = [b.start, ...(detour ? [b.detour] : []), b.end];
    $('mission-place').replaceChildren('地點進度：');
    for (const [index, id] of route.entries()) {
        if (index > 0) {
            const arrow = document.createElement('span');
            arrow.className = 'checkpoint-arrow';
            arrow.textContent = '→';
            $('mission-place').append(arrow);
        }
        const number = document.createElement('span');
        number.className = 'checkpoint-number';
        number.textContent = String(id);
        number.dataset.state = completed || has(id) ? 'completed' : 'current';
        number.title = `地點 ${id} · ${completed || has(id) ? '已完成' : '待完成'}`;
        $('mission-place').append(number);
        if (!completed && !has(id)) break;
    }
    if (completed) {
        const check = document.createElement('span');
        check.className = 'checkpoint-complete';
        check.textContent = '✓';
        check.setAttribute('role', 'img');
        check.setAttribute('aria-label', '這條支線全部完成');
        $('mission-place').append(check);
    }
    $('mission-copy').textContent = completed ? '可以選擇其他花瓣，繼續探索。' : '和夥伴前往對應地點，尋找這條支線的記憶。';
    $('mission-action').textContent = team?.phase === 'elected' ? isSelectedRun() && activeRun.phase !== 'finished' ? `接續地點 ${activeRun.checkpoint} 的任務 →` : selected === 1 ? '查看支線二 →' : selected === 2 ? '查看支線三 →' : selected === 3 ? '查看支線四 →' : selected === 4 ? '查看支線五 →' : selected === 0 && activeRun?.checkpoint === 2 ? '查看支線一 →' : '前往掃碼 →' : '查看隊伍準備狀態 →';
    if(finalSelected&&memorySummary?.revealed&&memorySummary?.completed_at){$('mission-title').textContent=has(10)?'冒險完成':'最後一站';$('mission-status').textContent=has(10)?'已完成':'已開放';$('mission-place').replaceChildren('地點：');const number=document.createElement('span');number.className='checkpoint-number';number.textContent='10';$('mission-place').append(number);$('mission-copy').textContent='最後一個地點已出現，帶著找回的記憶前往現場吧。';$('mission-action').textContent=has(10)?'回看結局／我的回憶 →':'前往掃碼 →';}
}
function message(text) { $('team-error').textContent = text; $('team-error').hidden = !text; }
function renderTeam() {
    const wasUnlocked = unlocked;
    unlocked = team?.phase === 'elected';
    $('home-view').dataset.stage = unlocked ? 'exploring' : 'waiting';
    if (!unlocked) selectTab('team');
    else if (!wasUnlocked) { selectTab('explore'); window.scrollTo(0, 0); }
    $('team-loading').hidden = true; $('join-form').hidden = !!team; $('team-content').hidden = !team;
    const solo=isSoloTeam(team);
    $('team-label').textContent = teamDisplayName(team); $('role-label').textContent = solo?'冒險者':team?.leader_id === player?.id ? '隊長' : team ? '隊員' : '探路者';
    $('adventurer-label').textContent = team?.members.find(member => member.id === player?.id)?.name || '冒險者';
    renderFlower(); if (!team) return;
    window.dispatchEvent(new CustomEvent('team-state', { detail: team }));
    $('player-label').textContent=solo?player.player_code.slice(0,8):player.player_code;
    $('team-name').textContent = solo?'你的個人進度會獨立保存':`${teamDisplayName(team)} · 你的編號 ${player.player_code}`;
    $('team-page-title').textContent = solo?'我的個人冒險':team.phase === 'lobby' ? '等待夥伴集合' : team.phase === 'voting' ? '選出我們的隊長' : '我們的隊伍';
    $('team-page-description').textContent = solo?'這段旅程由你決定，進度與正式隊伍分開保存。':team.phase === 'lobby' ? '填好冒險者名字，確認本次參與的隊員都到齊了，再準備出發。' : team.phase === 'voting' ? '全員投完並選出隊長後，將自動進入探索首頁。' : '和夥伴一起，找回校園裡的記憶。';
    $('team-phase').textContent = solo?'個人模式':{ lobby: '集合中', voting: '隊長投票', elected: '已選出隊長' }[team.phase];
    $('member-list').replaceChildren(...team.members.map(member => {
        const li = document.createElement('li'), name = document.createElement('span'), state = document.createElement('span'); name.textContent = `${member.name || '尚未填寫名字'}${member.id === player.id ? '（你）' : ''}`;
        const code = document.createElement('small'); code.textContent = `編號 ${member.code}`; name.append(code);
        state.textContent = solo?'冒險者':team.phase === 'lobby' ? (member.ready ? '已準備' : '等待準備') : member.id === team.leader_id ? '隊長' : team.phase === 'voting' ? (team.electors.includes(member.id) ? team.voted_ids.includes(member.id) ? '已投票' : '待投票' : '下輪旅程加入') : '隊員'; li.append(name, state); return li;
    }));
    for (const [phase, id] of [['lobby', 'lobby-controls'], ['voting', 'voting-controls'], ['elected', 'elected-controls']]) $(id).hidden = team.phase !== phase;
    $('leave-team-button').hidden=!['lobby','voting'].includes(team.phase);
    if (team.phase === 'lobby') {
        const me = team.members.find(m => m.id === player.id);
        if ($('adventurer-name').dataset.player !== player.id) { $('adventurer-name').value = me?.name ?? ''; $('adventurer-name').dataset.player = player.id; }
        $('name-status').textContent = me?.name ? `已儲存：${me.name}` : '請先設定你的冒險者名字。';
        $('ready-button').disabled = busy || !me?.name;
        $('ready-count').textContent = `已準備 ${team.members.filter(m => m.ready).length}／${team.members.length} 人`;
        $('ready-button').textContent = team.members.find(m => m.id === player.id)?.ready ? '取消準備' : '準備出發';
    }
    if (team.phase === 'voting') {
        $('vote-heading').textContent = team.round > 1 ? `第 ${team.round} 輪 · 請重新選出隊長` : '選出這趟旅程的隊長';
        $('vote-count').textContent = `已投票 ${team.voted_count}／${team.electors.length} 人`;
        const canVote = team.electors.includes(player.id) && !team.voted_ids.includes(player.id);
        $('vote-form').hidden = !canVote; $('vote-wait').hidden = canVote;
        $('vote-wait').textContent = team.electors.includes(player.id) ? '你的選票已送出，等待其他隊員完成。' : '本輪投票已開始，你將在隊長選出後一起出發。';
        // Keep an unsubmitted selection during polling, but never across rounds.
        const chosen = $('candidate-list').dataset.round === String(team.round) ? $('candidate-list').querySelector(':checked')?.value : null;
        $('candidate-list').replaceChildren(); const legend = document.createElement('legend'); legend.textContent = '選擇你推薦的隊長'; $('candidate-list').append(legend); $('candidate-list').dataset.round = team.round;
        for (const id of team.candidates) { const member = team.members.find(m => m.id === id), label = document.createElement('label'), input = document.createElement('input'); label.className = 'candidate'; input.type = 'radio'; input.name = 'candidate'; input.value = id; input.required = true; input.checked = id === chosen; label.append(input, `${member.name || '隊員'} · ${member.code}${id === player.id ? '（你）' : ''}`); $('candidate-list').append(label); }
    }
    if (team.phase === 'elected') {$('leader-result').textContent = solo?'所有關卡都由你操作':`本次隊長：${team.members.find(m => m.id === team.leader_id)?.name || '隊員'}`;$('leader-result').nextElementSibling.textContent=solo?'可自行掃碼、選擇對話和完成遊戲，不需要等待其他人。':'隊長負責到站掃碼與一般任務提交，團隊任務由大家一起參與。';}
}
async function refresh(force=false) {
    if (!player || document.hidden) return;
    if(busy){if(force)foregroundTeamPending=true;return;}
    if (!force && team?.phase === 'elected' && document.querySelector('.app-shell').dataset.page !== 'team') return;
    const attempt = version, request = ++requestVersion;
    try { const result = await api('/api/team',{wait:force||!$('team-loading').hidden,waitLabel:'正在接回隊伍狀態…'}); if (attempt !== version || request !== requestVersion) return; team = result.team; message(''); renderTeam(); }
    catch (error) { if (attempt === version) { $('team-loading').hidden = true; message(error.message); } }
}
async function poll() { const attempt = version; await refresh(); if (player && attempt === version) timer = setTimeout(poll, 3000); }
async function action(name, body) {
    if (busy) return; busy = true; const attempt = version; ++requestVersion;
    const buttons = [...$('team-panel').querySelectorAll('button')]; buttons.forEach(b => b.disabled = true); message('');
    try { const result = await api(`/api/team/${name}`, { method: 'POST', body }); if (attempt !== version) return; team = result.team; renderTeam(); }
    catch (error) { if (attempt === version) message(error.message); }
    finally { busy = false;if(foregroundTeamPending){foregroundTeamPending=false;refresh(true);} buttons.forEach(b => b.disabled = false); if (attempt === version && team?.phase === 'lobby') $('ready-button').disabled = !team.members.find(m => m.id === player.id)?.name; }
}
export function startJourney(client, currentPlayer) {
    stopJourney(); api = client; player = currentPlayer; startMemories(client,currentPlayer); startSightings(currentPlayer); unlocked = false; $('home-view').dataset.stage = 'waiting'; $('team-loading').hidden = false; $('join-form').hidden = true; $('team-content').hidden = true; selectTab('team'); renderFlower(); poll();
}
for (const button of document.querySelectorAll('[data-tab]')) button.onclick = () => selectTab(button.dataset.tab);
$('team-shortcut').onclick = () => selectTab('team'); $('back-explore').onclick = () => selectTab('explore');
$('mission-action').onclick = () => { if(finalSelected&&memorySummary?.revealed){if(has(10))window.dispatchEvent(new CustomEvent('open-checkpoint',{detail:[10]}));else selectTab('scan');return;} if (isSelectedRun() && activeRun.phase !== 'finished') window.dispatchEvent(new Event('resume-checkpoint')); else if (selected === 1 && team?.phase === 'elected') window.dispatchEvent(new CustomEvent('open-checkpoint',{detail:has(2)?[13]:[2]})); else if (selected === 0 && [2,13].includes(activeRun?.checkpoint) && team?.phase === 'elected') window.dispatchEvent(new CustomEvent('open-checkpoint',{detail:[11,1]})); else if(selected === 2 && team?.phase === 'elected') window.dispatchEvent(new CustomEvent('open-checkpoint',{detail:has(3)?[9]:[3]})); else if(selected === 3 && team?.phase === 'elected') window.dispatchEvent(new CustomEvent('open-checkpoint',{detail:has(4)?(has(6)?[12]:[6,12]):[4]})); else if(selected === 4 && team?.phase === 'elected') window.dispatchEvent(new CustomEvent('open-checkpoint',{detail:has(5)?[7]:[5]})); else selectTab(team?.phase === 'elected' ? 'scan' : 'team'); };
window.addEventListener('checkpoint-progress', event => { gameProgress = event.detail; renderFlower(); });
window.addEventListener('checkpoint-state', event => { activeRun = event.detail; renderFlower(); });
window.addEventListener('open-code-entry', () => selectTab('scan'));
window.addEventListener('open-scan-tab', () => selectTab('scan'));
$('refresh-team').onclick = () => refresh(true);
$('name-form').onsubmit = event => { event.preventDefault(); action('name', { name: $('adventurer-name').value.trim() }); };
$('ready-button').onclick = () => action('ready', { ready: !team.members.find(m => m.id === player.id)?.ready });
$('vote-form').onsubmit = event => { event.preventDefault(); const choice = $('candidate-list').querySelector(':checked'); if (choice) action('vote', { candidate: choice.value, round: team.round }); };
const icons = { explore: 'M3 11 12 3l9 8M5 10v11h5v-7h4v7h5V10', records: 'M5 3h14v18H5zM8 7h8M8 11h8M8 15h6', scan: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M5 12h14', contacts: 'M4 4h16v13H9l-5 4V4zM8 8h8M8 12h5', team: 'M15 21v-3a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v3M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M16 4a3 3 0 0 1 0 6M21 21v-3a4 4 0 0 0-4-4' };
for (const button of document.querySelectorAll('.bottom-nav button')) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.7'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); path.setAttribute('d', icons[button.dataset.tab]); svg.append(path); button.firstElementChild.replaceChildren(svg);
}

window.addEventListener('memory-state',event=>{memorySummary=event.detail;if(event.detail.completed_checkpoints)gameProgress={...gameProgress,completed_checkpoints:event.detail.completed_checkpoints};renderFlower();});
window.addEventListener('memory-home-return',()=>{selectTab('explore');window.scrollTo(0,0);renderFlower();});
window.addEventListener('memory-final-select',()=>{finalSelected=true;selectTab('explore');renderFlower();});

window.addEventListener('sighting-home',()=>{selectTab('explore');window.scrollTo(0,0);});

document.addEventListener('visibilitychange',()=>{if(document.hidden)requestVersion++;else if(player)refresh(true);});
window.addEventListener('online',()=>{if(player&&!document.hidden)refresh(true);});
