/* ============================
   BODWEAVER — App Logic
   ============================ */

// ===========================
// SUPABASE BACKEND INIT (Vercel 호환)
// ===========================
const SUPABASE_URL = 'YOUR_SUPABASE_URL_HERE';      // 1. Supabase Project URL 입력
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY_HERE'; // 2. Supabase API Key 입력

let supabase = null;
if (typeof window.supabase !== 'undefined') {
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

function isSupabaseConfigured() {
  if (SUPABASE_URL.includes('YOUR_')) {
    console.warn('⚠️ Supabase API 키가 아직 입력되지 않았습니다. 현재는 로컬(프론트엔드) 기반으로 화면이 동작합니다.');
    return false;
  }
  return true;
}

// ===========================
// PREVENT NATIVE CONTEXT MENU & DRAG
// ===========================
document.addEventListener('contextmenu', e => {
  if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
    e.preventDefault();
  }
});
document.addEventListener('dragstart', e => e.preventDefault());

// ===========================
// NETWORK CANVAS (Splash)
// ===========================
(function initCanvas() {
  const canvas = document.getElementById('network-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, nodes = [], animId;

  function resize() {
    W = canvas.width = canvas.parentElement.offsetWidth;
    H = canvas.height = canvas.parentElement.offsetHeight;
  }

  function createNodes(n) {
    nodes = [];
    for (let i = 0; i < n; i++) {
      nodes.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: Math.random() * 2 + 1
      });
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      a.x += a.vx; a.y += a.vy;
      if (a.x < 0 || a.x > W) a.vx *= -1;
      if (a.y < 0 || a.y > H) a.vy *= -1;

      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 120) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(59,130,246,${(1 - dist / 120) * 0.4})`;
          ctx.lineWidth = 1;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      ctx.beginPath();
      ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
      ctx.fillStyle = i % 3 === 0 ? 'rgba(59,130,246,0.8)' : 'rgba(255,255,255,0.4)';
      ctx.fill();
    }
    animId = requestAnimationFrame(draw);
  }

  resize();
  createNodes(40);
  draw();

  window.addEventListener('resize', () => {
    cancelAnimationFrame(animId);
    resize();
    createNodes(40);
    draw();
  });
})();

// ===========================
// SCREEN ROUTER
// ===========================
const screens = {};
let currentScreen = 'splash';

function getScreen(id) {
  if (!screens[id]) screens[id] = document.getElementById(`screen-${id}`);
  return screens[id];
}

// Screen order for direction detection (lower index = "left/back")
const SCREEN_ORDER = {
  splash: 0,
  home: 1,
  explore: 2,
  match: 2,
  chat: 2,
  profile: 3,
  settings: 4,
  plus: 4,
};

function goTo(id) {
  const from = getScreen(currentScreen);
  const to   = getScreen(id);
  if (!to || currentScreen === id) return;

  // Auto-detect direction by screen order
  const fromIdx = SCREEN_ORDER[currentScreen] ?? 99;
  const toIdx   = SCREEN_ORDER[id] ?? 99;
  const dir = toIdx >= fromIdx ? 'forward' : 'back';

  // Exiting: slide out opposite of entry direction
  from.classList.remove('active');
  from.style.transition = 'opacity 0.28s ease, transform 0.28s cubic-bezier(0.4,0,0.2,1)';
  from.style.opacity    = '0';
  from.style.transform  = dir === 'forward' ? 'translateX(-24px)' : 'translateX(24px)';
  setTimeout(() => {
    from.style.transition = '';
    from.style.opacity    = '';
    from.style.transform  = '';
    from.classList.remove('exiting');
  }, 300);

  // Entering: start off-screen, animate to center
  to.style.transition = 'none';
  to.style.opacity    = '0';
  to.style.transform  = dir === 'forward' ? 'translateX(28px)' : 'translateX(-28px)';
  to.classList.add('active');
  to.offsetHeight; // force reflow
  to.style.transition = 'opacity 0.28s ease, transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)';
  to.style.opacity    = '1';
  to.style.transform  = 'translateX(0)';
  setTimeout(() => {
    to.style.transition = '';
    to.style.opacity    = '';
    to.style.transform  = '';
  }, 300);

  currentScreen = id;
  // Always sync nav active state
  document.querySelectorAll('.bottom-nav').forEach(nav => {
    nav.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const t = nav.querySelector(`[data-screen="${id}"]`);
    if (t) t.classList.add('active');
  });
}



// ===========================
// SPLASH
// ===========================
async function socialLogin(providerName, provider) {
  showToast(`🔄 ${providerName} 로그인 중...`);
  if (isSupabaseConfigured() && provider) {
    try {
      const { error } = await supabase.auth.signInWithOAuth({ provider });
      if (error) throw error;
      // OAuth 리다이렉트 후 자동 처리됨 (supabase가 세션 저장)
    } catch (err) {
      showToast(`로그인 오류: ${err.message}`);
    }
  } else {
    // 목업 모드
    setTimeout(() => {
      showToast(`✅ ${providerName} 로그인 성공!`);
      localStorage.setItem('bw_user', providerName);
      goTo('home');
      renderDynamicRooms();
    }, 1000);
  }
}

// 전화번호 로그인 (OTP)
async function phoneLogin() {
  if (isSupabaseConfigured()) {
    const phone = prompt('전화번호를 입력하세요 (예: +821012345678)');
    if (!phone) return;
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) { showToast('전송 실패: ' + error.message); return; }
    showToast('📱 인증 코드가 전송되었습니다.');
    const otp = prompt('받으신 6자리 코드를 입력하세요');
    if (!otp) return;
    const { error: err2 } = await supabase.auth.verifyOtp({ phone, token: otp, type: 'sms' });
    if (err2) { showToast('인증 실패: ' + err2.message); return; }
    showToast('✅ 전화번호 인증 성공!');
    goTo('home');
    renderDynamicRooms();
  } else {
    showToast('🔄 전화번호 로그인 중...');
    setTimeout(() => { showToast('✅ 로그인 성공!'); goTo('home'); }, 1000);
  }
}

document.getElementById('login-kakao')?.addEventListener('click', () => socialLogin('카카오', null));
document.getElementById('login-google')?.addEventListener('click', () => socialLogin('구글', 'google'));
document.getElementById('login-apple')?.addEventListener('click', () => socialLogin('Apple', 'apple'));

document.getElementById('splash-login')?.addEventListener('click', (e) => {
  e.preventDefault();
  phoneLogin();
});

// Supabase Auth 세션 감지 (OAuth 리다이렉트 후)
if (isSupabaseConfigured()) {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) {
      showToast('✅ 로그인 완료!');
      goTo('home');
      renderDynamicRooms();
    }
  });
}

// ===========================
// HOME
// ===========================
document.getElementById('home-match-btn').addEventListener('click', () => goTo('match'));
document.getElementById('home-explore-btn').addEventListener('click', () => goTo('explore'));
document.getElementById('notif-btn').addEventListener('click', () => showToast('🔔 알림 3개'));
document.getElementById('profile-btn-top').addEventListener('click', () => goTo('profile'));
document.getElementById('see-all-rooms').addEventListener('click', (e) => { e.preventDefault(); goTo('explore'); });
document.getElementById('banner-plus').addEventListener('click', () => goTo('plus'));
document.getElementById('banner-plus-btn').addEventListener('click', () => goTo('plus'));

document.querySelectorAll('.join-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    btn.textContent = '연결 완료 ✓';
    btn.style.background = 'var(--green)';
    showToast('✅ 함께하기 신청 완료!');
  });
});

document.querySelectorAll('.cat-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
  });
});

// Match cards click
document.querySelectorAll('.match-card').forEach(card => {
  card.addEventListener('click', () => goTo('match'));
});

// ===========================
// MATCH FLOW
// ===========================
let selectedGame = '뱅!';
let matchingTimer = null;

// ===========================
// GAME INFO POPUP DATA
// ===========================
const GAME_DB = {
  '뱅!':       { thumb:'🎲', genre:'파티', players:'3~7인', time:'45분', difficulty:'⭐⭐', fun:'🔥🔥🔥', rooms:'12개', desc:'서부 시대를 배경으로 보안관, 무법자, 배신자 등 숨겨진 역할을 맡아 싸우는 카드 게임이에요. 팀을 추리하고 심리전을 펼치는 재미가 가득해요!', tip:'초보자도 10분이면 규칙을 배울 수 있어요! 인원이 많을수록 더 재밌어요 😊' },
  '카탄':      { thumb:'🃏', genre:'전략', players:'3~4인', time:'90분', difficulty:'⭐⭐⭐', fun:'🔥🔥🔥', rooms:'8개', desc:'섬에서 자원을 모아 도시와 도로를 건설하는 전략 게임이에요. 협상과 거래가 핵심이라 처음 만나는 사람들과도 금방 친해져요!', tip:'항구 근처에 정착지를 세우면 자원 교환이 유리해요 🏠' },
  '루미큐브':  { thumb:'🎯', genre:'전략', players:'2~4인', time:'60분', difficulty:'⭐⭐⭐', fun:'🔥🔥', rooms:'6개', desc:'숫자 타일을 색깔·숫자 조합으로 맞춰 내려놓는 타일 전략 게임이에요. 집중력과 순발력, 두뇌 회전이 필요해요!', tip:'처음 30점을 내려놓는 조건을 꼭 맞춰야 게임이 시작돼요 🎯' },
  '코드네임':  { thumb:'🕵️', genre:'추리/파티', players:'4~8인', time:'30분', difficulty:'⭐⭐', fun:'🔥🔥🔥', rooms:'9개', desc:'두 팀으로 나뉘어 스파이 마스터의 힌트로 우리 편 단어를 맞추는 팀 협력 게임이에요. 한 단어로 여러 단어를 연결하는 창의력이 핵심!', tip:'힌트를 너무 어렵게 주면 팀원이 반대 편 카드를 고를 수 있어요 😅' },
  '스플렌더':  { thumb:'💎', genre:'전략', players:'2~4인', time:'60분', difficulty:'⭐⭐⭐', fun:'🔥🔥', rooms:'4개', desc:'보석 토큰을 모아 카드를 구매하고 귀족을 영접해 승점을 쌓는 엔진 빌딩 전략 게임이에요. 단순한 룰에 깊은 전략이 숨어 있어요!', tip:'영구 보석 카드를 빨리 쌓을수록 후반이 편해요 💎' },
  '아줄':      { thumb:'🔷', genre:'전략', players:'2~4인', time:'45분', difficulty:'⭐⭐', fun:'🔥🔥🔥', rooms:'3개', desc:'포르투갈 타일 공예에서 영감을 받은 아름다운 전략 게임이에요. 타일을 가져와 보드에 패턴을 완성하고 가장 많은 점수를 획득하세요!', tip:'상대가 가져가길 원하는 타일을 공장에 남기는 견제가 중요해요 🔷' },
  '할리갈리':  { thumb:'🔔', genre:'파티', players:'2~6인', time:'20분', difficulty:'⭐', fun:'🔥🔥🔥', rooms:'5개', desc:'과일 카드를 뒤집다가 같은 과일이 5개 모이면 종을 치는 반응 속도 게임이에요. 단순하지만 폭발적으로 재밌어서 온 가족이 즐길 수 있어요!', tip:'종을 치기 전에 숫자를 빨리 합산하는 게 핵심이에요 🔔 실수하면 카드를 줘야 해요!' },
  '마피아':    { thumb:'🎭', genre:'추리/파티', players:'5~12인', time:'30분', difficulty:'⭐⭐', fun:'🔥🔥🔥', rooms:'7개', desc:'마피아와 시민으로 나뉘어 서로를 추리하고 투표로 제거하는 심리전 게임이에요. 인원이 많고 개성 강한 사람이 많을수록 훨씬 재밌어요!', tip:'마피아는 낮에 의심받지 않도록 적극적으로 발언하는 게 유리해요 🎭' },
  '다빈치코드': { thumb:'🔢', genre:'추리', players:'2~4인', time:'20분', difficulty:'⭐⭐', fun:'🔥🔥', rooms:'2개', desc:'상대방의 숫자 타일을 추리해 맞추는 두뇌 싸움 게임이에요. 간단하고 빠르게 즐길 수 있어서 게임 전 워밍업으로 딱이에요!', tip:'0부터 11까지 오름차순으로 세워야 해요. 눈치껏 상대의 패턴을 읽어보세요 🔢' },
  '타임라인':  { thumb:'⏱', genre:'파티/퀴즈', players:'2~8인', time:'20분', difficulty:'⭐', fun:'🔥🔥', rooms:'3개', desc:'역사적 사건이나 발명품을 올바른 연대순으로 배치하는 퀴즈형 카드 게임이에요. 역사 지식이 없어도 감으로 즐길 수 있어요!', tip:'완전히 모르는 사건은 이미 놓인 카드들 사이에 전략적으로 끼워넣어 보세요 ⏱' },
};

function openGameInfoPopup(gameName) {
  const d = GAME_DB[gameName];
  if (!d) return;
  document.getElementById('gi-thumb').textContent = d.thumb;
  document.getElementById('gi-name').textContent = gameName;
  document.getElementById('gi-genre').textContent = d.genre;
  document.getElementById('gi-players').textContent = d.players;
  document.getElementById('gi-time').textContent = d.time;
  document.getElementById('gi-desc').textContent = d.desc;
  document.getElementById('gi-difficulty').textContent = d.difficulty;
  document.getElementById('gi-fun').textContent = d.fun;
  document.getElementById('gi-rooms').textContent = d.rooms;
  document.getElementById('gi-tip-text').textContent = d.tip;
  document.getElementById('gi-match-btn').dataset.game = gameName;
  document.getElementById('game-info-modal').classList.remove('hidden');
}

function closeGameInfoPopup() {
  document.getElementById('game-info-modal').classList.add('hidden');
}

document.getElementById('game-info-close').addEventListener('click', closeGameInfoPopup);
document.getElementById('game-info-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('game-info-modal')) closeGameInfoPopup();
});

document.getElementById('gi-match-btn').addEventListener('click', () => {
  const game = document.getElementById('gi-match-btn').dataset.game;
  document.querySelectorAll('.game-item').forEach(i => i.classList.remove('selected'));
  const target = document.querySelector(`.game-item[data-game="${game}"]`);
  if (target) { target.classList.add('selected'); selectedGame = game; }
  closeGameInfoPopup();
  goToStep(2);
});

// Game selection — click to select AND show info popup
document.querySelectorAll('.game-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.game-item').forEach(i => i.classList.remove('selected'));
    item.classList.add('selected');
    selectedGame = item.dataset.game;
    openGameInfoPopup(selectedGame);
  });
});

// Step 1 → 2
document.getElementById('next-step-1').addEventListener('click', () => {
  goToStep(2);
});

// Step 2 → 3 (start matching + 백엔드 방 생성)
document.getElementById('next-step-2').addEventListener('click', async () => {
  // 매칭 전에 Supabase DB에 방 데이터 저장
  const place = document.querySelector('.opt-chip.active')?.textContent || '장소 미정';
  const levelChip = document.querySelectorAll('.option-chips')[1]?.querySelector('.opt-chip.active');
  const level = levelChip?.textContent || '모두 환영';
  const roomObj = {
    game: `🎮 ${selectedGame}`,
    status: '모집중',
    status_cls: 'open',
    title: `${selectedGame} 같이 하실 분!`,
    place: place,
    time: '오늘',
    members: 1,
    max_members: 4,
    level: level,
    description: '보드위버에서 만든 모임이에요.'
  };
  await createRoomInBackend(roomObj);
  goToStep(3);
  startMatching();
  // 방 생성 후 홈 화면 리스트 새로고침
  renderDynamicRooms();
});

// Back Step 2 → 1
document.getElementById('prev-step-2').addEventListener('click', () => {
  goToStep(1);
});

// Option chips toggle
document.querySelectorAll('.opt-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const group = chip.closest('.option-chips');
    group.querySelectorAll('.opt-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
  });
});

function goToStep(n) {
  document.querySelectorAll('.match-step').forEach(s => s.classList.remove('active'));
  document.getElementById(`match-step-${n}`).classList.add('active');
  document.querySelectorAll('.step').forEach((s, i) => {
    s.classList.remove('active', 'done');
    if (i + 1 < n) s.classList.add('done');
    if (i + 1 === n) s.classList.add('active');
  });
}

function startMatching() {
  const loading = document.getElementById('matching-loading');
  const done = document.getElementById('matching-done');
  loading.style.display = 'flex';
  done.classList.add('hidden');

  if (matchingTimer) clearTimeout(matchingTimer);
  matchingTimer = setTimeout(() => {
    loading.style.display = 'none';
    done.classList.remove('hidden');
  }, 3000);
}

document.getElementById('go-chat-btn').addEventListener('click', () => {
  goTo('chat');
  setTimeout(() => openChatroom(), 200);
  resetMatchFlow();
});

document.getElementById('done-home-btn').addEventListener('click', () => {
  goTo('home');
  resetMatchFlow();
});

document.querySelector('[data-back="home"]').addEventListener('click', () => {
  goTo('home');
  resetMatchFlow();
});

function resetMatchFlow() {
  if (matchingTimer) clearTimeout(matchingTimer);
  goToStep(1);
}

// Game search
document.getElementById('game-search').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  document.querySelectorAll('.game-item').forEach(item => {
    const name = item.dataset.game.toLowerCase();
    item.style.display = name.includes(q) || q === '' ? '' : 'none';
  });
});

// ===========================
// EXPLORE TABS
// ===========================
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const tabId = tab.dataset.tab;
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).classList.add('active');
  });
});

document.querySelectorAll('#tab-rooms .join-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    btn.textContent = '완료 ✓';
    btn.style.background = 'var(--green)';
    showToast('✅ 참여 신청 완료!');
  });
});

document.getElementById('filter-btn').addEventListener('click', () => showToast('🔍 필터 기능 준비 중'));

// Explore cards → match
document.querySelectorAll('.explore-card').forEach(card => {
  card.addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-sm-primary')) return;
    goTo('match');
  });
});

// ===========================
// CHAT & CHATROOM
// ===========================
function openChatroom(roomId) {
  currentRoomId = roomId || 'global';
  const overlay = document.getElementById('chatroom');
  overlay.classList.remove('hidden');
  overlay.style.display = 'flex';
  requestAnimationFrame(() => overlay.classList.add('show'));
  scrollChatToBottom();
  // 실시간 채팅 구독 시작 (Supabase 연결 시)
  listenToChatUpdates((newMsg) => {
    appendChatBubble({ text: newMsg.text, isMe: false, sender: newMsg.sender });
  });
}

function closeChatroom() {
  const overlay = document.getElementById('chatroom');
  overlay.classList.remove('show');
  setTimeout(() => {
    overlay.classList.add('hidden');
  }, 350);
}

document.getElementById('open-chatroom').addEventListener('click', openChatroom);
document.getElementById('close-chatroom').addEventListener('click', closeChatroom);

const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');
const sendBtn = document.getElementById('send-btn');

let currentRoomId = null; // 현재 열린 채팅방 ID

function appendChatBubble({ text, isMe, sender }) {
  const msg = document.createElement('div');
  msg.className = isMe ? 'msg sent' : 'msg received';
  if (isMe) {
    msg.innerHTML = `<div class="msg-bubble">${text}</div>`;
  } else {
    const initial = sender ? sender[0] : '?';
    const col = 'linear-gradient(135deg,#3B82F6,#8B5CF6)';
    msg.innerHTML = `<div class="ava xs" style="background:${col}">${initial}</div><div class="msg-bubble">${text}</div>`;
  }
  chatMessages.appendChild(msg);
  scrollChatToBottom();
}

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;

  // 즉시 내 말풍선 렌더링 (로컬)
  appendChatBubble({ text, isMe: true, sender: '나' });
  chatInput.value = '';

  // Supabase로 메시지 전송
  await sendChatMessage(currentRoomId || 'global', text, '나');

  // Supabase 없을 때만 자동 답장 (목업 모드)
  if (!isSupabaseConfigured()) {
    setTimeout(() => {
      const replies = ['좋아요! 기대돼요 😊', '저도요! 빨리 만나고 싶어요 🎮', '오늘 너무 재밌을 것 같아요!', '👍👍'];
      const randName = ['지', '수'][Math.floor(Math.random() * 2)];
      appendChatBubble({ text: replies[Math.floor(Math.random() * replies.length)], isMe: false, sender: randName });
    }, 1000 + Math.random() * 800);
  }
}

sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

function scrollChatToBottom() {
  setTimeout(() => {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }, 50);
}

// ===========================
// PROFILE
// ===========================
document.getElementById('profile-plus-btn').addEventListener('click', () => goTo('plus'));
document.getElementById('settings-btn').onclick = () => { goTo('settings'); syncNav(''); };

// ===========================
// WEAVER PLUS
// ===========================
document.getElementById('back-plus').addEventListener('click', () => goTo('profile'));

// ===========================
// SETTINGS
// ===========================
document.getElementById('back-settings').addEventListener('click', () => goTo('profile'));
document.getElementById('settings-edit-profile').addEventListener('click', () => openEditSheet());
document.getElementById('si-phone').addEventListener('click', () => openEditSheet());
document.getElementById('si-email').addEventListener('click', () => openEditSheet());
document.getElementById('si-location').addEventListener('click', () => openEditSheet());
document.getElementById('si-range').addEventListener('click', () => showToast('현재 위치 설정으로 적용되었습니다'));
document.getElementById('si-privacy').addEventListener('click', () => window.open('privacy.html', '_blank'));
document.getElementById('si-terms').addEventListener('click', () => window.open('terms.html', '_blank'));
document.getElementById('si-faq').addEventListener('click', () => showToast('고객센터: ujin141@naver.com'));
document.getElementById('si-feedback').addEventListener('click', () => {
  navigator.clipboard?.writeText('ujin141@naver.com').then(() => showToast('📧 이메일 복사됨: ujin141@naver.com'));
});
document.getElementById('si-version').addEventListener('click', () => showToast('환경: BODWEAVER v1.0.0 (최신 빌드)'));
document.getElementById('si-logout').addEventListener('click', () => {
  showToast('🚪 로그아웃 완료');
  setTimeout(() => { goTo('splash'); }, 1200);
});
document.getElementById('si-withdraw').addEventListener('click', () => {
  document.getElementById('withdraw-modal').classList.remove('hidden');
});
document.querySelectorAll('.toggle input').forEach(tog => {
  tog.addEventListener('change', () => {
    showToast(tog.checked ? '✅ 알림 켜짐' : '🔕 알림 꺼짐');
  });
});

document.querySelectorAll('.plan-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.plan-card').forEach(c => {
      c.classList.remove('recommended');
      c.style.borderColor = '';
    });
    card.classList.add('recommended');
  });
});

let isPlusUser = false;
let freeMatchesLeft = 3;
const freeMatchMax = 5;

function updateMatchCounterUI() {
  if (isPlusUser) return;
  const gpText = document.getElementById('gp-text');
  if (gpText) {
    gpText.innerHTML = `이번 달 남은 매칭: <strong>${freeMatchesLeft}/${freeMatchMax}회</strong>`;
  }
  const ringCircle = document.getElementById('gp-ring-circle');
  if (ringCircle) {
    const totalDash = 125.6; // 2 * pi * 20 ≈ 125.6
    const ratio = freeMatchesLeft / freeMatchMax;
    ringCircle.style.strokeDashoffset = totalDash * (1 - ratio);
  }
  const ringLabel = document.getElementById('gp-ring-label');
  if (ringLabel) {
    ringLabel.textContent = `${Math.round((freeMatchesLeft / freeMatchMax)*100)}%`;
  }
}

function upgradeToPlus() {
  isPlusUser = true;
  document.getElementById('my-plus-badge')?.classList.remove('hidden');
  
  const gpBadge = document.getElementById('gp-badge');
  if (gpBadge) {
    gpBadge.textContent = '✦ PLUS';
    gpBadge.style.background = 'linear-gradient(135deg, #8B5CF6, #3B82F6)';
    gpBadge.style.color = '#fff';
    gpBadge.style.border = 'none';
  }
  
  const gpText = document.getElementById('gp-text');
  if (gpText) {
    gpText.innerHTML = '이번 달 남은 매칭: <strong>무제한</strong>';
  }
  
  const ringCircle = document.getElementById('gp-ring-circle');
  if (ringCircle) {
    ringCircle.style.strokeDashoffset = '0';
    ringCircle.setAttribute('stroke', '#8B5CF6'); 
  }
  
  const ringLabel = document.getElementById('gp-ring-label');
  if (ringLabel) {
    ringLabel.innerHTML = '♾️';
  }
  
  const upgradeText = document.getElementById('gp-upgrade-text');
  if (upgradeText) {
    upgradeText.textContent = '플러스 혜택 사용 중';
  }
  
  showToast('🎉 위버 플러스 가입을 환영합니다!');
}

document.getElementById('plus-subscribe-btn')?.addEventListener('click', () => {
  upgradeToPlus();
  setTimeout(() => goTo('profile'), 1500);
});

document.querySelectorAll('[id="profile-plus-btn"]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!isPlusUser) {
      goTo('plus');
    } else {
      showToast('이미 위버 플러스 혜택을 이용 중입니다!');
    }
  });
});

// Initialize free match UI on load
updateMatchCounterUI();

// ===========================
// TOAST
// ===========================
let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, 2200);
}

// ===========================
// NAV ACTIVE SYNC (single handler — no duplicates)
// ===========================
function syncNav(screenId) {
  document.querySelectorAll('.bottom-nav').forEach(nav => {
    nav.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const target = nav.querySelector(`[data-screen="${screenId}"]`);
    if (target) target.classList.add('active');
  });
}

// Wire ALL [data-screen] buttons via onclick (goTo handles syncNav internally)
document.querySelectorAll('[data-screen]').forEach(btn => {
  btn.onclick = (e) => {
    e.stopPropagation && e.stopPropagation();
    const target = btn.dataset.screen;
    if (target && currentScreen !== target) goTo(target);
  };
});

// Sync nav on initial page load
syncNav('home');

// ===========================
// NOTIFICATION DRAWER
// ===========================
function openNotifDrawer() {
  document.getElementById('notif-drawer').classList.remove('hidden');
}
function closeNotifDrawer() {
  document.getElementById('notif-drawer').classList.add('hidden');
}
// Rewire notif-btn
document.getElementById('notif-btn').onclick = openNotifDrawer;
document.getElementById('notif-close').addEventListener('click', closeNotifDrawer);
document.getElementById('notif-backdrop').addEventListener('click', closeNotifDrawer);
document.querySelectorAll('.notif-item').forEach(item => {
  item.addEventListener('click', () => {
    item.classList.remove('unread');
    closeNotifDrawer();
    showToast('알림 확인 완료');
  });
});

// ===========================
// ROOM DETAIL SHEET
// ===========================
const ROOM_DATA = [
  { id:'1', game:'🎲 뱅!', status:'모집중', statusCls:'open', title:'강남에서 뱅! 같이 할 사람', place:'강남역 보드카페', time:'오늘 오후 7시', members:'2 / 6명', level:'모두 환영', desc:'뱅! 초보도 환영해요. 규칙은 현장에서 설명해드릴게요. 편하게 연락주세요 😊' },
  { id:'2', game:'🃏 카탄', status:'모집중', statusCls:'open', title:'카탄 초보 환영 🤝', place:'홍대 게임바', time:'오늘 오후 6시', members:'3 / 4명', level:'초보 환영', desc:'카탄 처음이어도 괜찮아요! 같이 규칙 보면서 시작할게요. 오세요 🎉' },
  { id:'3', game:'🎯 루미큐브', status:'오늘 저녁', statusCls:'soon', title:'루미큐브 고수 구합니다', place:'신촌 카페', time:'오늘 저녁 8시', members:'1 / 4명', level:'중급 이상', desc:'루미큐브 좀 하시는 분들이랑 즐겁게 한 판 하고 싶어요. 실력자 우대 😈' },
];

function openRoomSheet(id) {
  const data = ROOM_DATA.find(r => r.id === id) || ROOM_DATA[0];
  document.getElementById('sd-game').textContent = data.game;
  document.getElementById('sd-status').textContent = data.status;
  document.getElementById('sd-status').className = `match-status ${data.statusCls}`;
  document.getElementById('sd-title').textContent = data.title;
  document.getElementById('sd-place').textContent = data.place;
  document.getElementById('sd-time').textContent = data.time;
  document.getElementById('sd-members').textContent = data.members;
  document.getElementById('sd-level').textContent = data.level;
  document.getElementById('sd-desc').textContent = data.desc;
  document.getElementById('room-sheet').classList.remove('hidden');
}
function closeRoomSheet() {
  document.getElementById('room-sheet').classList.add('hidden');
}
document.getElementById('sheet-backdrop').addEventListener('click', closeRoomSheet);
document.getElementById('sd-join-btn').addEventListener('click', () => {
  if (!isPlusUser && freeMatchesLeft <= 0) {
    closeRoomSheet();
    showToast('매칭 횟수를 모두 소진했습니다. 위버 플러스를 이용해 보세요!');
    setTimeout(() => goTo('plus'), 1500);
    return;
  }
  
  if (!isPlusUser) {
    freeMatchesLeft--;
    updateMatchCounterUI();
  }
  
  closeRoomSheet();
  showToast(isPlusUser ? '✅ [PLUS] 프리미엄 매칭 완료!' : '✅ 함께하기 신청 완료!');
});
document.getElementById('sd-chat-btn').addEventListener('click', () => {
  closeRoomSheet();
  goTo('chat');
  syncNav('chat');
  setTimeout(() => openChatroom(), 200);
});

// Rewire match cards to open sheet
document.querySelectorAll('.match-card').forEach(card => {
  card.onclick = (e) => {
    if (e.target.classList.contains('btn-sm-primary') || e.target.classList.contains('join-btn')) return;
    openRoomSheet(card.dataset.id || '1');
  };
});

// Rewire explore cards too
document.querySelectorAll('.explore-card').forEach(card => {
  card.onclick = (e) => {
    if (e.target.classList.contains('btn-sm-primary')) return;
    openRoomSheet(card.dataset.id?.replace('r','') || '1');
  };
});

// Rewire filter btn
document.getElementById('filter-btn').onclick = () => {
  document.getElementById('filter-panel').classList.remove('hidden');
};
document.getElementById('filter-backdrop').addEventListener('click', () => document.getElementById('filter-panel').classList.add('hidden'));
document.getElementById('filter-close').addEventListener('click', () => document.getElementById('filter-panel').classList.add('hidden'));
document.getElementById('filter-apply').addEventListener('click', () => {
  document.getElementById('filter-panel').classList.add('hidden');
  showToast('🔍 필터 적용 완료');
});
document.getElementById('filter-reset').addEventListener('click', () => {
  document.querySelectorAll('#filter-panel .opt-chip').forEach((c,i) => {
    c.classList.toggle('active', i === 0 || c.textContent === '전체' || c.textContent === '무관');
  });
});

// ===========================
// RATING MODAL
// ===========================
let selectedStars = 0;
const starLabels = ['', '별로였어요', '그저 그랬어요', '좋았어요', '재밌었어요!', '최고였어요! 🎉'];

function openRatingModal() {
  selectedStars = 0;
  document.querySelectorAll('.star').forEach(s => s.classList.remove('active'));
  document.getElementById('star-label').textContent = '탭해서 평가하기';
  document.querySelectorAll('.review-tag').forEach(t => t.classList.remove('selected'));
  document.getElementById('rating-modal').classList.remove('hidden');
}
function closeRatingModal() {
  document.getElementById('rating-modal').classList.add('hidden');
}

document.querySelectorAll('.star').forEach(star => {
  star.addEventListener('click', () => {
    selectedStars = parseInt(star.dataset.v);
    document.querySelectorAll('.star').forEach((s, i) => {
      s.classList.toggle('active', i < selectedStars);
    });
    document.getElementById('star-label').textContent = starLabels[selectedStars];
  });
  star.addEventListener('mouseenter', () => {
    const v = parseInt(star.dataset.v);
    document.querySelectorAll('.star').forEach((s, i) => s.classList.toggle('active', i < v));
  });
});
document.getElementById('star-row').addEventListener('mouseleave', () => {
  document.querySelectorAll('.star').forEach((s, i) => s.classList.toggle('active', i < selectedStars));
});
document.querySelectorAll('.review-tag').forEach(tag => {
  tag.addEventListener('click', () => tag.classList.toggle('selected'));
});
document.getElementById('rating-submit').addEventListener('click', () => {
  closeRatingModal();
  showToast('⭐ 후기가 등록됐어요. 감사해요!');
});
document.getElementById('rating-skip').addEventListener('click', closeRatingModal);

// Show rating modal after going home from match completion
const _origDoneHome = document.getElementById('done-home-btn');
_origDoneHome.onclick = () => {
  goTo('home'); syncNav('home'); resetMatchFlow();
  setTimeout(() => openRatingModal(), 600);
};

// ===========================
// LIVE COUNTER ANIMATION
// ===========================
let liveCount = 32;
const liveEl = document.getElementById('live-count');
setInterval(() => {
  const delta = Math.floor(Math.random() * 3) - 1;
  liveCount = Math.max(25, Math.min(50, liveCount + delta));
  if (liveEl) { liveEl.textContent = liveCount; liveEl.style.transform = 'scale(1.2)'; setTimeout(() => liveEl.style.transform = '', 200); }
}, 4000);

// ===========================
// PROFILE EDIT
// ===========================
let currentAvatarColor = 'linear-gradient(135deg,#3B82F6,#8B5CF6)';

function openEditSheet() {
  document.getElementById('edit-sheet').classList.remove('hidden');
  // Sync current name
  const nameEl = document.getElementById('ef-name');
  const bioEl  = document.getElementById('ef-bio');
  updateCount('ef-name', 'ef-name-count', 16);
  updateCount('ef-bio', 'ef-bio-count', 60);
}
function closeEditSheet() {
  document.getElementById('edit-sheet').classList.add('hidden');
}

// Open from profile avatar edit btn too
document.querySelector('.avatar-edit-btn')?.addEventListener('click', openEditSheet);

document.getElementById('edit-cancel').addEventListener('click', closeEditSheet);
document.getElementById('edit-backdrop').addEventListener('click', closeEditSheet);

// Character counters
function updateCount(inputId, countId, max) {
  const el = document.getElementById(inputId);
  const cnt = document.getElementById(countId);
  if (el && cnt) cnt.textContent = `${el.value.length}/${max}`;
}
document.getElementById('ef-name').addEventListener('input', () => updateCount('ef-name','ef-name-count',16));
document.getElementById('ef-bio').addEventListener('input',  () => updateCount('ef-bio','ef-bio-count',60));

// Avatar color picker
document.querySelectorAll('.ava-opt-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ava-opt-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    currentAvatarColor = btn.dataset.color;
    document.getElementById('edit-avatar-display').style.background = currentAvatarColor;
    document.getElementById('edit-avatar-display').textContent = 'U';
  });
});
// Mark first as selected by default
document.querySelector('.ava-opt-btn')?.classList.add('selected');

// Avatar image upload
document.getElementById('avatar-upload')?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    currentAvatarColor = `url(${ev.target.result}) center/cover no-repeat`;
    const display = document.getElementById('edit-avatar-display');
    display.style.background = currentAvatarColor;
    display.textContent = ''; // clear text when image is shown
    document.querySelectorAll('.ava-opt-btn').forEach(b => b.classList.remove('selected'));
  };
  reader.readAsDataURL(file);
});

// Area chip toggle
document.querySelectorAll('.edit-select-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.edit-select-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
  });
});

// Game pill remove
document.getElementById('game-tag-input').addEventListener('click', (e) => {
  if (e.target.classList.contains('pill-x')) {
    e.target.closest('.game-tag-pill')?.remove();
  }
});

// Game picker open/close
document.getElementById('pill-add-btn').addEventListener('click', () => {
  document.getElementById('game-picker').classList.remove('hidden');
  // Mark picked games
  const picked = [...document.querySelectorAll('.game-tag-pill')].map(p => p.dataset.g);
  document.querySelectorAll('.picker-item').forEach(item => {
    item.classList.toggle('picked', picked.includes(item.dataset.g));
  });
});
document.getElementById('picker-close').addEventListener('click', () => document.getElementById('game-picker').classList.add('hidden'));
document.getElementById('picker-backdrop').addEventListener('click', () => document.getElementById('game-picker').classList.add('hidden'));

// Add game from picker
const GAME_EMOJIS = {
  '뱅!':'🎲','카탄':'🃏','루미큐브':'🎯','코드네임':'🕵️',
  '스플렌더':'💎','아줄':'🔷','할리갈리':'🔔','마피아':'🎭',
  '다빈치코드':'🔢','타임라인':'⏱'
};
document.querySelectorAll('.picker-item').forEach(item => {
  item.addEventListener('click', () => {
    const g = item.dataset.g;
    const already = [...document.querySelectorAll('.game-tag-pill')].some(p => p.dataset.g === g);
    if (already) {
      document.querySelector(`.game-tag-pill[data-g="${g}"]`)?.remove();
      item.classList.remove('picked');
    } else {
      const pill = document.createElement('div');
      pill.className = 'game-tag-pill';
      pill.dataset.g = g;
      pill.innerHTML = `${GAME_EMOJIS[g] || '🎮'} ${g} <span class="pill-x">×</span>`;
      const addBtn = document.getElementById('pill-add-btn');
      document.getElementById('game-tag-input').insertBefore(pill, addBtn);
      item.classList.add('picked');
    }
  });
});

// SAVE — update live profile
document.getElementById('edit-save').addEventListener('click', () => {
  const newName   = document.getElementById('ef-name').value.trim() || '나의 보드위버';
  const newHandle = document.getElementById('ef-handle').value.trim() || 'bodweaver_user';
  const area      = document.querySelector('.edit-select-chip.active')?.dataset.area || '강남';
  const games     = [...document.querySelectorAll('.game-tag-pill')].map(p => p.dataset.g);

  // Update profile screen
  document.querySelector('#screen-profile h2').textContent = newName;
  document.querySelector('#screen-profile .profile-handle').textContent = `@${newHandle}`;
  // Update avatars color
  document.querySelectorAll('.profile-avatar, .sp-avatar, #edit-avatar-display').forEach(a => {
    a.style.background = currentAvatarColor;
    a.textContent = currentAvatarColor.startsWith('url') ? '' : 'U';
  });
  // Update fav-game chips
  const chipWrap = document.querySelector('.fav-game-chips');
  if (chipWrap) {
    const existing = [...chipWrap.querySelectorAll('.fav-chip:not(.add-chip)')];
    existing.forEach(c => c.remove());
    games.forEach(g => {
      const span = document.createElement('span');
      span.className = 'fav-chip';
      span.textContent = `${GAME_EMOJIS[g] || '🎮'} ${g}`;
      chipWrap.insertBefore(span, chipWrap.querySelector('.add-chip'));
    });
  }
  // Update settings card
  document.querySelector('.sp-info strong').textContent = newName;
  document.querySelector('.sp-info span').textContent = `@${newHandle}`;
  // Update location in settings
  document.querySelector('#si-location .si-val').textContent = `서울 ${area}`;

  closeEditSheet();
  showToast('✅ 프로필이 저장됐어요!');
});

// ===========================
// WITHDRAW & TERMS
// ===========================
document.getElementById('withdraw-cancel').addEventListener('click', () => {
  document.getElementById('withdraw-modal').classList.add('hidden');
});
document.getElementById('withdraw-confirm').addEventListener('click', () => {
  document.getElementById('withdraw-modal').classList.add('hidden');
  showToast('회원탈퇴가 완료되었습니다. 안녕히 가세요.');
  setTimeout(() => goTo('splash'), 1500);
});

function openTermsModal(type) {
  document.getElementById('terms-title').textContent = type === 'privacy' ? '개인정보 처리방침' : '이용약관';
  document.getElementById('terms-modal').classList.remove('hidden');
}
document.getElementById('terms-close').addEventListener('click', () => {
  document.getElementById('terms-modal').classList.add('hidden');
});

// ===========================
// REPORT SYSTEM
// ===========================
function openReportModal() {
  document.querySelectorAll('.report-tag').forEach(t => t.classList.remove('selected'));
  document.getElementById('report-reason').value = '';
  document.getElementById('report-modal').classList.remove('hidden');
}
document.getElementById('btn-report-chat')?.addEventListener('click', openReportModal);
document.getElementById('btn-report-room')?.addEventListener('click', openReportModal);
document.getElementById('report-cancel').addEventListener('click', () => {
  document.getElementById('report-modal').classList.add('hidden');
});
document.getElementById('report-submit').addEventListener('click', () => {
  document.getElementById('report-modal').classList.add('hidden');
  showToast('신고 및 차단이 완료되었습니다. 조치하겠습니다.');
});
// The report-tag instances shouldn't interfere with review-tag general bindings, but we can bind them here just in case.
// Review tags are already bound above in RATING MODAL section, but for report specific tags.
document.querySelectorAll('.report-tag').forEach(tag => {
  tag.addEventListener('click', (e) => {
    // Avoid double toggle if review-tag logic catches it too, but let's just make sure it behaves.
    // The previous review-tag selector was `.review-tag` so it toggles 'selected'. That's fine.
  });
});

/* =========================================
   [백엔드] SUPABASE API SERVICE
   - Vercel 배포 시 서버 역할 수행
   ========================================= */

// 1. 모임 리스트 불러오기 (GET)
async function fetchRoomsFromBackend() {
  if (!isSupabaseConfigured()) return typeof ROOM_DATA !== 'undefined' ? ROOM_DATA : []; 
  
  try {
    const { data, error } = await supabase.from('rooms').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    console.log('✅ 백엔드 DB 통신 성공 (모임 리스트):', data);
    return data;
  } catch (err) {
    console.error('❌ 백엔드 통신 에러:', err);
    return [];
  }
}

// 2. 모임 생성하기 (INSERT)
async function createRoomInBackend(roomObj) {
  if (!isSupabaseConfigured()) return;
  try {
    const { error } = await supabase.from('rooms').insert([roomObj]);
    if (error) throw error;
    console.log('✅ 모임 생성 완료');
  } catch (err) {
    console.error('모임 생성 에러:', err);
  }
}

// 3. 실시간 채팅 메시지 보내기 (INSERT)
async function sendChatMessage(roomId, text, senderName) {
  if (!isSupabaseConfigured()) return;
  try {
    const { error } = await supabase.from('messages').insert([
      { room_id: roomId, text: text, sender: senderName }
    ]);
    if (error) throw error;
  } catch (err) {
    console.error('채팅 전송 에러:', err);
  }
}

// 4. 실시간 채팅 구독 (WebSockets)
function listenToChatUpdates(callback) {
  if (!isSupabaseConfigured()) return;
  
  // Realtime 리스너 등록
  supabase
    .channel('chat_room_channel')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
      console.log('🔔 [실시간] 새 메시지 감지:', payload.new);
      callback(payload.new); // 화면에 즉시 렌더링
    })
    .subscribe();
}

// 콘솔에 안내문 출력
console.log('🚀 서버리스 백엔드 로직 준비 완료. Supabase API Key를 입력하세요.');

/* =========================================
   [백엔드] UI DYNAMIC RENDERING 연동
   ========================================= */

// 동적 HTML 렌더링 함수
async function renderDynamicRooms() {
  const rooms = await fetchRoomsFromBackend();
  const homeContainer = document.getElementById('dynamic-rooms-home');
  const exploreContainer = document.querySelector('#screen-explore .matches-grid');
  
  if (!rooms || rooms.length === 0) {
    const emptyMsg = '<p style="text-align:center; width:100%; color:#888; margin-top:20px;">아직 만들어진 모임이 없어요.</p>';
    if (homeContainer) homeContainer.innerHTML = emptyMsg;
    if (exploreContainer) exploreContainer.innerHTML = emptyMsg;
    return;
  }

  const htmlString = rooms.map(room => `
    <div class="match-card" data-id="${room.id || 'new'}">
      <div class="match-card-header">
        <span class="game-tag">${room.game}</span>
        <span class="match-status ${room.status_cls || 'open'}">${room.status}</span>
      </div>
      <h3>${room.title}</h3>
      <div class="match-meta">
        <span>📍 ${room.place}</span>
        <span>👥 ${room.members}/${room.max_members || 4}명</span>
      </div>
      <div class="match-avatars">
        <div class="ava" style="background:#8B5CF6">✨</div>
        <div class="ava ava-empty">+${(room.max_members || 4) - (room.members || 1)}</div>
      </div>
      <button class="btn-sm-primary join-btn">함께하기</button>
    </div>
  `).join('');

  if (homeContainer) homeContainer.innerHTML = htmlString;
  if (exploreContainer) exploreContainer.innerHTML = htmlString;

  // 동적 버튼에 클릭 이벤트 달아주기
  document.querySelectorAll('.match-card').forEach(card => {
    card.addEventListener('click', () => {
      openRoomSheet();
    });
  });
}

// 앱 실행 시(초기화) 백엔드 데이터를 화면에 렌더링
document.addEventListener('DOMContentLoaded', () => {
  renderDynamicRooms();
});
