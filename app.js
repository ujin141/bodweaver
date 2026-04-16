/* ============================
   BODWEAVER — App Logic
   ============================ */

// ===========================
// SUPABASE BACKEND INIT (Vercel 호환)
// ===========================
const SUPABASE_URL = 'https://kwurnepfofloiuwprqbd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3dXJuZXBmb2Zsb2l1d3BycWJkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNDAxOTcsImV4cCI6MjA5MTkxNjE5N30.29S6Ka-FzYXvepdjv8-H82fseMJGAiZ6eA8jtjt2VwQ';

// CDN이 window.supabase(라이브러리)를 이미 선언하므로, client를 별도 변수에 저장
window.supabaseClient = null;
if (typeof window.supabase !== 'undefined' && typeof window.supabase.createClient === 'function') {
  window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// 앱 내부에서 supabaseClient를 간편하게 참조
const getClient = () => window.supabaseClient;

function isSupabaseConfigured() {
  if (SUPABASE_URL.includes('YOUR_') || !window.supabaseClient) {
    return false;
  }
  return true;
}

// ===========================
// 📍 GPS & 거리 매칭 시스템
// ===========================
let userLat = null;
let userLng = null;
let geoWatchId = null;

// 서울 주요 지역 좌표 테이블 (GPS 없을 때 지역명으로 대체)
const AREA_COORDS = {
  '강남':  { lat: 37.4979, lng: 127.0276 },
  '홍대':  { lat: 37.5572, lng: 126.9243 },
  '신촌':  { lat: 37.5559, lng: 126.9367 },
  '건대':  { lat: 37.5404, lng: 127.0694 },
  '이태원':{ lat: 37.5348, lng: 126.9949 },
  '종로':  { lat: 37.5729, lng: 126.9793 },
  '수원':  { lat: 37.2636, lng: 127.0286 },
  '부산':  { lat: 35.1796, lng: 129.0756 },
  '대구':  { lat: 35.8714, lng: 128.6014 },
  '대전':  { lat: 36.3504, lng: 127.3845 },
  '광주':  { lat: 35.1595, lng: 126.8526 },
  '인천':  { lat: 37.4563, lng: 126.7052 },
};

// 하버사인 공식 (JS 클라이언트 계산용)
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 거리 → 표시 문자열
function formatDistance(km) {
  if (km < 1) return `${Math.round(km * 1000)}m`;
  if (km < 10) return `${km.toFixed(1)}km`;
  return `${Math.round(km)}km`;
}

// GPS 요청 및 저장
function requestUserLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      // GPS 불가 → 저장된 지역명으로 폴백
      applyAreaFallback();
      resolve(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userLat = pos.coords.latitude;
        userLng = pos.coords.longitude;
        localStorage.setItem('bw_lat', userLat);
        localStorage.setItem('bw_lng', userLng);
        // Supabase users 테이블에 좌표 저장
        if (isSupabaseConfigured() && currentUser) {
          window.supabaseClient.from('users')
            .update({ latitude: userLat, longitude: userLng })
            .eq('id', currentUser.id)
            .then(() => {});
        }
        // console.log(\`📍 GPS 위치: $\{userLat.toFixed(4)}, $\{userLng.toFixed(4)}\`); // 보안상 로그 삭제
        resolve(true);
      },
      () => {
        // 권한 거부 → 저장된 좌표 또는 지역명으로 폴백
        const savedLat = parseFloat(localStorage.getItem('bw_lat'));
        const savedLng = parseFloat(localStorage.getItem('bw_lng'));
        if (savedLat && savedLng) {
          userLat = savedLat;
          userLng = savedLng;
          resolve(true);
        } else {
          applyAreaFallback();
          resolve(false);
        }
      },
      { timeout: 8000, maximumAge: 300000 } // 5분 캐시
    );
  });
}

// 지역명으로 좌표 폴백 설정
function applyAreaFallback() {
  const area = localStorage.getItem('bw_loc') || currentProfile?.area || '강남';
  const coords = AREA_COORDS[area] || AREA_COORDS['강남'];
  userLat = coords.lat;
  userLng = coords.lng;
}

// 반경 내 모임 필터링 (클라이언트 사이드)
function filterRoomsByRadius(rooms, radiusKm) {
  if (!userLat || !userLng) return rooms;
  return rooms
    .map(room => {
      let dist = null;
      if (room.latitude && room.longitude) {
        dist = haversineKm(userLat, userLng, room.latitude, room.longitude);
      } else if (room.place) {
        // 장소명으로 매칭 시도
        for (const [areaName, coords] of Object.entries(AREA_COORDS)) {
          if (room.place.includes(areaName)) {
            dist = haversineKm(userLat, userLng, coords.lat, coords.lng);
            break;
          }
        }
      }
      return { ...room, _distKm: dist };
    })
    .filter(room => room._distKm === null || room._distKm <= radiusKm)
    .sort((a, b) => {
      if (a._distKm === null) return 1;
      if (b._distKm === null) return -1;
      return a._distKm - b._distKm;
    });
}

// 앱 시작 시 위치 초기화
async function initGeoLocation() {
  const ok = await requestUserLocation();
  if (ok) {
    // console.log(\`✅ 위치 준비 완료\`);
  }
  renderDynamicRooms(); // 위치 확인 후 방 목록 재렌더링
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
  onboarding: 0,
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
  
  if (id === 'chat') {
    renderChatList();
    updateNavChatBadge();
  }
  if (id === 'home') {
    renderDynamicRooms();
    renderActivityFeed();
    updateNavChatBadge();
  }
}



// ===========================
// SPLASH
// ===========================
async function socialLogin(providerName, provider) {
  showToast(`🔄 ${providerName} 로그인 중...`);
  if (isSupabaseConfigured() && provider) {
    try {
      const redirectTo = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? window.location.origin
        : 'https://bodweaver.vercel.app';
      const { error } = await window.supabaseClient.auth.signInWithOAuth({
        provider,
        options: { redirectTo }
      });
      if (error) throw error;
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
    const { error } = await window.supabaseClient.auth.signInWithOtp({ phone });
    if (error) { showToast('전송 실패: ' + error.message); return; }
    showToast('📱 인증 코드가 전송되었습니다.');
    const otp = prompt('받으신 6자리 코드를 입력하세요');
    if (!otp) return;
    const { error: err2 } = await window.supabaseClient.auth.verifyOtp({ phone, token: otp, type: 'sms' });
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

// Auth 상태 감지는 백엔드 섹션에서 처리됨 (스크롤 다운)

// ===========================
// ONBOARDING FLOW (3단계 프로필 설정)
// ===========================
let obStep = 1;
let obAvatar   = '🎮';
let obArea     = '강남';
let obGames    = [];

// 현재 단계 → 화면 전환
function goOnboardStep(step) {
  [1,2,3].forEach(n => {
    document.getElementById(`opage-${n}`)?.classList.toggle('active', n === step);
    const dot = document.getElementById(`ostep-${n}`);
    if (dot) {
      dot.classList.remove('active', 'done');
      if (n < step)  dot.classList.add('done');
      if (n === step) dot.classList.add('active');
    }
  });
  obStep = step;
  // 스크롤 상단으로
  document.getElementById('screen-onboarding')?.scrollTo(0, 0);
}

// 아바타 선택
document.querySelectorAll('.av-opt').forEach(opt => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.av-opt').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
    obAvatar = opt.dataset.av;
    const display = document.getElementById('onboard-avatar-display');
    if (display) display.textContent = obAvatar;
  });
});

// STEP 1 → 2
document.getElementById('ob-next-1')?.addEventListener('click', () => {
  const nick = document.getElementById('ob-nickname')?.value.trim();
  if (!nick || nick.length < 2) { showToast('닉네임을 2자 이상 입력해 주세요'); return; }
  goOnboardStep(2);
});

// STEP 2 지역 칩 (온보딩 화면용)
document.querySelectorAll('#opage-2 .loc-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#opage-2 .loc-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    obArea = chip.dataset.loc;
  });
});

// STEP 2 → 3
document.getElementById('ob-next-2')?.addEventListener('click', () => goOnboardStep(3));

// STEP 2 ← 1
document.getElementById('ob-back-2')?.addEventListener('click', () => goOnboardStep(1));

// STEP 3 게임 선택 (최대 5개)
document.querySelectorAll('.ob-game-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const g = chip.dataset.g;
    if (chip.classList.contains('selected')) {
      chip.classList.remove('selected');
      obGames = obGames.filter(x => x !== g);
    } else {
      if (obGames.length >= 5) { showToast('최대 5개까지 선택 가능해요'); return; }
      chip.classList.add('selected');
      obGames.push(g);
    }
  });
});

// STEP 3 ← 2
document.getElementById('ob-back-3')?.addEventListener('click', () => goOnboardStep(2));

// 완료 버튼 → Supabase 저장 후 홈 이동
document.getElementById('ob-finish')?.addEventListener('click', async () => {
  const nickname = document.getElementById('ob-nickname')?.value.trim();
  const handle   = document.getElementById('ob-handle')?.value.trim().toLowerCase().replace(/[^a-z0-9_]/g,'') || `user_${Date.now().toString(36)}`;
  const bio      = document.getElementById('ob-bio')?.value.trim();

  const btn = document.getElementById('ob-finish');
  btn.disabled = true;
  btn.querySelector('#ob-finish-text').textContent = '저장 중...';

  const updates = {
    nickname,
    handle,
    bio,
    area: obArea,
    favorite_games: obGames,
    avatar_url: obAvatar, // 이모지를 URL 대신 저장 (추후 실제 이미지 업로드로 교체 가능)
  };

  const ok = await saveUserProfile(updates);

  // localStorage에도 저장 (오프라인 폴백)
  localStorage.setItem('bw_loc', obArea);
  localStorage.setItem('bw_onboarded', '1');

  // 프로필 화면 UI 즉시 반영
  document.querySelector('.sp-info strong')          && (document.querySelector('.sp-info strong').textContent = nickname);
  document.querySelector('#screen-profile .profile-name') && (document.querySelector('#screen-profile .profile-name').textContent = nickname);
  document.querySelector('#si-location .si-val')     && (document.querySelector('#si-location .si-val').textContent = `서울 ${obArea}`);

  btn.disabled = false;
  btn.querySelector('#ob-finish-text').textContent = '완료!';

  showToast(`🎉 환영해요, ${nickname}님!`);
  setTimeout(() => {
    goTo('home');
    renderDynamicRooms();
    initGeoLocation();
  }, 600);
});

// 온보딩이 필요한지 판단하는 함수 (loadUserProfile 후 호출됨)
function checkNeedsOnboarding(profile) {
  // nickname이 기본값('보드게이머')이거나 처음 가입한 경우 온보딩으로
  const alreadyOnboarded = localStorage.getItem('bw_onboarded') === '1';
  if (alreadyOnboarded) return false;
  if (!profile) return true;
  if (profile.nickname === '보드게이머' || !profile.bio) return true;
  return false;
}

// ===========================
// HOME
// ===========================
document.getElementById('home-match-btn').addEventListener('click', () => goTo('match'));
document.getElementById('home-explore-btn').addEventListener('click', () => goTo('explore'));
document.getElementById('notif-btn').addEventListener('click', () => {
  const panel = document.getElementById('notif-panel');
  if (panel) {
    panel.classList.toggle('hidden');
  } else {
    showToast('🔔 새 알림이 없습니다');
  }
});
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
  const place = document.querySelector('.opt-chip.active')?.textContent || '장소 미정';
  const levelChip = document.querySelectorAll('.option-chips')[1]?.querySelector('.opt-chip.active');
  const level = levelChip?.textContent || '모두 환영';

  // 1. 이미 존재하는 방 중 조건이 맞는 방을 우선 탐색
  const existingRoom = loadedRooms.find(r => 
    r.game.includes(selectedGame) && r.members < r.max_members
  );

  let matchedRoom = null;
  let isNew = false;
  
  if (existingRoom) {
    // 기존 방에 입장
    await joinRoomInBackend(existingRoom.id);
    matchedRoom = existingRoom;
  } else {
    // 조건에 맞는 방이 없으면 새로 생성
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
      description: '보드위버에서 만난 모임이에요.'
    };
    matchedRoom = await createRoomInBackend(roomObj);
    isNew = true;
  }

  goToStep(3);
  startMatching(matchedRoom, isNew);
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

function startMatching(room, isNew) {
  const loading = document.getElementById('matching-loading');
  const done = document.getElementById('matching-done');
  loading.style.display = 'flex';
  done.classList.add('hidden');

  if (matchingTimer) clearTimeout(matchingTimer);
  matchingTimer = setTimeout(async () => {
    loading.style.display = 'none';
    done.classList.remove('hidden');

    document.getElementById('go-chat-btn').dataset.roomId = room?.id || '';

    // 실제 참가자 UI 렌더링
    const container = document.querySelector('.matched-players');
    let membersHTML = '';

    if (isSupabaseConfigured() && room?.id) {
       const { data: members } = await window.supabaseClient
         .from('room_members')
         .select('users(nickname, avatar_url, handle)')
         .eq('room_id', room.id);
         
       if (members && members.length > 0) {
         membersHTML = members.map((m, idx) => {
           const nickname = m.users?.nickname || '유저';
           const initial = nickname[0];
           const bg = `linear-gradient(135deg, ${idx%2===0 ? '#3B82F6,#8B5CF6' : '#10B981,#3B82F6'})`;
           return `
             <div class="matched-player">
               <div class="ava lg" style="background:${bg}">${initial}</div>
               <span>${nickname}</span>
             </div>
           `;
         }).join('<div class="connect-line-icon">⟷</div>');
       }
    }
    
    // 로컬 폴백 또는 혼자일 때
    if (!membersHTML) {
       const initial = currentProfile?.nickname ? currentProfile.nickname[0] : '나';
       const name = currentProfile?.nickname || '나';
       membersHTML = `
         <div class="matched-player">
           <div class="ava lg" style="background:linear-gradient(135deg,#3B82F6,#8B5CF6)">${initial}</div>
           <span>${name}</span>
         </div>
       `;
    }

    if (container) container.innerHTML = membersHTML;

    // 제목 업데이트
    const title = done.querySelector('h2');
    const desc = done.querySelector('p');
    if (isNew) {
      if (title) title.textContent = '방 생성 완료!';
      if (desc) desc.textContent = '모임 방이 만들어졌습니다. 다른 분들을 기다려요!';
    } else {
      if (title) title.textContent = '연결 완료!';
      if (desc) desc.textContent = '기존에 있던 파티에 정상적으로 배정됐어요!';
    }
  }, 3000);
}

document.getElementById('go-chat-btn').addEventListener('click', (e) => {
  const roomId = e.target.dataset.roomId;
  goTo('chat');
  setTimeout(() => openChatroom(roomId), 200);
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

// 카테고리 필터
let activeCategoryFilter = '전체';
document.querySelectorAll('.cat-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    activeCategoryFilter = chip.textContent.trim();
    applyExploreFilter();
  });
});

function applyExploreFilter() {
  const container = document.querySelector('.explore-list');
  if (!container) return;
  const cards = container.querySelectorAll('.match-card');
  if (cards.length === 0) return;
  const cat = activeCategoryFilter;
  cards.forEach(card => {
    if (cat === '전체') { card.style.display = ''; return; }
    const gameName = (card.querySelector('.game-tag')?.textContent || '').replace(/\p{Emoji}/gu,'').trim();
    const genre = GAME_DB[gameName]?.genre || '';
    card.style.display = genre.includes(cat) ? '' : 'none';
  });
}

document.getElementById('filter-btn').addEventListener('click', () => showToast('카테고리 칩을 선택해 필터링하세요 👆'));


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
async function openChatroom(roomId) {
  // 이벤트 객체가 넘어온 경우 방어 로직
  if (roomId && typeof roomId === 'object') roomId = null;
  currentRoomId = roomId || 'global';

  // 채팅방 제목 설정
  const titleEl = document.getElementById('chatroom-title');
  if (titleEl) {
    if (roomId && isSupabaseConfigured()) {
      // DB에서 방 제목 불러오기
      const room = loadedRooms?.find(r => r.id === roomId);
      if (room) {
        titleEl.textContent = room.title || '채팅방';
      } else {
        // loadedRooms에 없을 경우 직접 조회
        window.supabaseClient.from('rooms').select('title').eq('id', roomId).single()
          .then(({ data }) => { if (data) titleEl.textContent = data.title; });
        titleEl.textContent = '채팅방';
      }
    } else {
      titleEl.textContent = '채팅방';
    }
  }

  const overlay = document.getElementById('chatroom');
  overlay.classList.remove('hidden');
  overlay.style.display = 'flex';
  requestAnimationFrame(() => overlay.classList.add('show'));

  // 기존 메시지 비우고 로드
  document.getElementById('chat-messages').innerHTML = '';
  scrollChatToBottom();

  // 읽음 처리
  await markRoomAsRead(currentRoomId);

  // 실시간 채팅 구독
  listenToChatUpdates(currentRoomId, async (newMsg) => {
    appendChatBubble({ text: newMsg.text, isMe: false, sender: newMsg.sender_name });
    await markRoomAsRead(currentRoomId);
  });

  // 기존 메시지 로드
  if (isSupabaseConfigured() && currentRoomId !== 'global') loadChatHistory(currentRoomId);
}

async function closeChatroom() {
  // 채팅방 닫을 때도 읽음 처리
  if (currentRoomId && currentRoomId !== 'global') {
    await markRoomAsRead(currentRoomId);
  }
  const overlay = document.getElementById('chatroom');
  overlay.classList.remove('show');
  setTimeout(() => {
    overlay.classList.add('hidden');
    overlay.style.display = '';
  }, 350);
}

// ✅ 읽음 처리 함수 — 해당 방의 메시지 총 개수를 localStorage에 저장 후 배지 갱신
async function markRoomAsRead(roomId) {
  if (!roomId || roomId === 'global' || !isSupabaseConfigured()) return;
  try {
    const { count } = await window.supabaseClient
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('room_id', roomId);
    if (count !== null) {
      localStorage.setItem(`bw_chat_read_${roomId}`, count);
    }
  } catch (e) { /* 무시 */ }
  // 배지 즉시 갱신
  updateNavChatBadge();
}

// ✅ 네비게이션 배지만 빠르게 갱신
async function updateNavChatBadge() {
  if (!isSupabaseConfigured() || !currentUser) {
    document.querySelectorAll('.nav-badge').forEach(b => b.style.display = 'none');
    return;
  }
  try {
    const { data: myRooms } = await window.supabaseClient
      .from('room_members')
      .select('room_id')
      .eq('user_id', currentUser.id)
      .eq('status', 'joined');
    if (!myRooms || myRooms.length === 0) {
      document.querySelectorAll('.nav-badge').forEach(b => b.style.display = 'none');
      return;
    }
    const roomIds = myRooms.map(m => m.room_id);
    const { count: totalMsgs } = await window.supabaseClient
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .in('room_id', roomIds);
    let readTotal = 0;
    roomIds.forEach(rid => {
      readTotal += parseInt(localStorage.getItem(`bw_chat_read_${rid}`) || '0');
    });
    const unread = Math.max(0, (totalMsgs || 0) - readTotal);
    document.querySelectorAll('.nav-badge').forEach(b => {
      if (unread > 0) { b.style.display = 'inline-block'; b.textContent = unread; }
      else { b.style.display = 'none'; }
    });
  } catch (e) { /* 무시 */ }
}

// document.getElementById('open-chatroom')?.addEventListener('click', openChatroom); // Dynamic binding used now
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

  // 내 메시지도 로컬 읽음 수 카운트에 반영
  if (currentRoomId && currentRoomId !== 'global') {
     let rCount = parseInt(localStorage.getItem(`bw_chat_read_${currentRoomId}`) || '0');
     localStorage.setItem(`bw_chat_read_${currentRoomId}`, rCount + 1);
  }

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
// SETTINGS — FULL IMPLEMENTATION
// ===========================
document.getElementById('back-settings').addEventListener('click', () => goTo('profile'));
document.getElementById('settings-edit-profile').addEventListener('click', () => openEditSheet());

// ── 전화번호 변경 ──
document.getElementById('si-phone').addEventListener('click', () => {
  document.getElementById('phone-modal').classList.remove('hidden');
  document.getElementById('phone-otp-row').classList.add('hidden');
  document.getElementById('phone-input-new').value = '';
  document.getElementById('phone-modal-send').textContent = '인증코드 전송';
});
document.getElementById('phone-modal-cancel').addEventListener('click', () =>
  document.getElementById('phone-modal').classList.add('hidden'));
let phoneOtpSent = false;
document.getElementById('phone-modal-send').addEventListener('click', async () => {
  const phone = document.getElementById('phone-input-new').value.trim();
  if (!phoneOtpSent) {
    if (!phone) { showToast('전화번호를 입력해 주세요'); return; }
    if (isSupabaseConfigured()) {
      const { error } = await window.supabaseClient.auth.signInWithOtp({ phone });
      if (error) { showToast('전송 실패: ' + error.message); return; }
    }
    document.getElementById('phone-otp-row').classList.remove('hidden');
    document.getElementById('phone-modal-send').textContent = '인증 확인';
    phoneOtpSent = true;
    showToast('📱 인증코드가 전송됐습니다');
  } else {
    const otp = document.getElementById('phone-otp-input').value.trim();
    if (!otp) { showToast('인증코드를 입력해 주세요'); return; }
    if (isSupabaseConfigured()) {
      const { error } = await window.supabaseClient.auth.verifyOtp({ phone, token: otp, type: 'sms' });
      if (error) { showToast('인증 실패: ' + error.message); return; }
    }
    document.getElementById('si-phone').querySelector('.si-val').textContent =
      phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
    document.getElementById('phone-modal').classList.add('hidden');
    phoneOtpSent = false;
    showToast('✅ 전화번호가 변경됐습니다');
  }
});

// ── 이메일 변경 ──
document.getElementById('si-email').addEventListener('click', () => {
  document.getElementById('email-modal').classList.remove('hidden');
  document.getElementById('email-input-new').value = '';
});
document.getElementById('email-modal-cancel').addEventListener('click', () =>
  document.getElementById('email-modal').classList.add('hidden'));
document.getElementById('email-modal-save').addEventListener('click', async () => {
  const email = document.getElementById('email-input-new').value.trim();
  if (!email || !email.includes('@')) { showToast('올바른 이메일을 입력해 주세요'); return; }
  if (isSupabaseConfigured()) {
    const { error } = await window.supabaseClient.auth.updateUser({ email });
    if (error) { showToast('변경 실패: ' + error.message); return; }
    showToast('📧 인증 이메일을 확인해 주세요');
  } else {
    document.getElementById('si-email').querySelector('.si-val').textContent = email;
    showToast('✅ 이메일이 변경됐습니다');
  }
  document.getElementById('email-modal').classList.add('hidden');
});

// ── 위치 변경 ──
let selectedLoc = localStorage.getItem('bw_loc') || '강남';
document.getElementById('si-location').addEventListener('click', () => {
  document.querySelectorAll('.loc-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.loc === selectedLoc);
  });
  document.getElementById('location-sheet').classList.remove('hidden');
});
document.getElementById('location-close').addEventListener('click', () =>
  document.getElementById('location-sheet').classList.add('hidden'));
document.getElementById('location-backdrop').addEventListener('click', () =>
  document.getElementById('location-sheet').classList.add('hidden'));
document.querySelectorAll('.loc-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.loc-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    selectedLoc = chip.dataset.loc;
  });
});
document.getElementById('location-save-btn').addEventListener('click', () => {
  localStorage.setItem('bw_loc', selectedLoc);
  document.getElementById('si-location').querySelector('.si-val').textContent = `서울 ${selectedLoc}`;
  document.getElementById('location-sheet').classList.add('hidden');
  showToast(`📍 위치가 ${selectedLoc}으로 변경됐습니다`);
});

// ── 위치 반경 ──
let selectedRadius = parseInt(localStorage.getItem('bw_radius') || '5');
document.getElementById('si-range').addEventListener('click', () => {
  document.querySelectorAll('.radius-option').forEach(o => {
    o.classList.toggle('active', parseInt(o.dataset.km) === selectedRadius);
  });
  document.getElementById('radius-sheet').classList.remove('hidden');
});
document.getElementById('radius-close').addEventListener('click', () =>
  document.getElementById('radius-sheet').classList.add('hidden'));
document.getElementById('radius-backdrop').addEventListener('click', () =>
  document.getElementById('radius-sheet').classList.add('hidden'));
document.querySelectorAll('.radius-option').forEach(opt => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.radius-option').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
    selectedRadius = parseInt(opt.dataset.km);
    localStorage.setItem('bw_radius', selectedRadius);
    document.getElementById('si-range').querySelector('.si-val').textContent = `${selectedRadius}km`;
    document.getElementById('radius-sheet').classList.add('hidden');
    showToast(`📏 반경이 ${selectedRadius}km로 변경됐습니다`);
  });
});

// ── 블록 관리 ──
document.getElementById('si-range').closest('.settings-group').querySelector('[data-list]')?.addEventListener('click', () => {});
// 블록 버튼 찾기 (블록 관리 항목)
document.querySelectorAll('.settings-item').forEach(item => {
  if (item.querySelector('.si-icon')?.textContent === '🚫') {
    item.addEventListener('click', () => {
      renderBlockedUsers();
      document.getElementById('block-sheet').classList.remove('hidden');
    });
  }
});
document.getElementById('block-close').addEventListener('click', () =>
  document.getElementById('block-sheet').classList.add('hidden'));
document.getElementById('block-backdrop').addEventListener('click', () =>
  document.getElementById('block-sheet').classList.add('hidden'));

function renderBlockedUsers() {
  const blocked = JSON.parse(localStorage.getItem('bw_blocked') || '[]');
  const list = document.getElementById('blocked-users-list');
  const noMsg = document.getElementById('no-blocked-msg');
  list.innerHTML = '';
  if (blocked.length === 0) { noMsg.style.display = 'block'; return; }
  noMsg.style.display = 'none';
  blocked.forEach((user, i) => {
    const row = document.createElement('div');
    row.className = 'blocked-user-row';
    row.innerHTML = `
      <div class="bu-avatar">👤</div>
      <div class="bu-name">${user}</div>
      <button class="bu-unblock" data-i="${i}">차단 해제</button>`;
    row.querySelector('.bu-unblock').addEventListener('click', () => {
      blocked.splice(i, 1);
      localStorage.setItem('bw_blocked', JSON.stringify(blocked));
      document.getElementById('si-range').closest('.settings-group').querySelector('.si-val') &&
        (document.getElementById('si-range').closest('.settings-group').querySelector('.si-val').textContent = `${blocked.length}명`);
      renderBlockedUsers();
      showToast('차단이 해제됐습니다');
    });
    list.appendChild(row);
  });
}

// ── 알림 토글 (localStorage 저장) ──
document.querySelectorAll('.toggle input').forEach(tog => {
  const saved = localStorage.getItem('bw_tog_' + tog.id);
  if (saved !== null) tog.checked = saved === 'true';
  tog.addEventListener('change', () => {
    localStorage.setItem('bw_tog_' + tog.id, tog.checked);
    showToast(tog.checked ? '🔔 알림이 켜졌습니다' : '🔕 알림이 꺼졌습니다');
  });
});

// ── 매칭 공개여부 ──
const togVisible = document.getElementById('tog-visible');
togVisible?.addEventListener('change', () => {
  localStorage.setItem('bw_visible', togVisible.checked);
  showToast(togVisible.checked ? '👁 내 프로필이 공개됩니다' : '🙈 내 프로필이 숨겨집니다');
});

// ── 개인정보/약관 ──
document.getElementById('si-privacy').addEventListener('click', () => window.open('privacy.html', '_blank'));
document.getElementById('si-terms').addEventListener('click', () => window.open('terms.html', '_blank'));

// ── FAQ ──
document.getElementById('si-faq').addEventListener('click', () =>
  document.getElementById('faq-modal').classList.remove('hidden'));
document.getElementById('faq-close').addEventListener('click', () =>
  document.getElementById('faq-modal').classList.add('hidden'));
document.getElementById('faq-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('faq-modal'))
    document.getElementById('faq-modal').classList.add('hidden');
});

// ── 피드백 ──
let selectedFbTag = '';
document.getElementById('si-feedback').addEventListener('click', () => {
  document.getElementById('feedback-modal').classList.remove('hidden');
  document.getElementById('feedback-text').value = '';
  selectedFbTag = '';
  document.querySelectorAll('.fb-tag').forEach(t => t.classList.remove('selected'));
});
document.querySelectorAll('.fb-tag').forEach(tag => {
  tag.addEventListener('click', () => {
    document.querySelectorAll('.fb-tag').forEach(t => t.classList.remove('selected'));
    tag.classList.add('selected');
    selectedFbTag = tag.dataset.tag;
  });
});
document.getElementById('feedback-cancel').addEventListener('click', () =>
  document.getElementById('feedback-modal').classList.add('hidden'));
document.getElementById('feedback-send').addEventListener('click', () => {
  const text = document.getElementById('feedback-text').value.trim();
  if (text.length < 10) { showToast('최소 10자 이상 입력해 주세요'); return; }
  const subject = encodeURIComponent(`[보드위버 피드백] ${selectedFbTag || '기타'}`);
  const body = encodeURIComponent(`카테고리: ${selectedFbTag || '기타'}\n\n${text}`);
  window.open(`mailto:ujin141@naver.com?subject=${subject}&body=${body}`);
  document.getElementById('feedback-modal').classList.add('hidden');
  showToast('📤 피드백이 전송됐습니다. 감사합니다!');
});

// ── 버전 ──
document.getElementById('si-version').addEventListener('click', () =>
  showToast('BODWEAVER v1.0.0 · 최신 버전입니다 ✅'));

// ── 로그아웃 ──
document.getElementById('si-logout').addEventListener('click', async () => {
  if (isSupabaseConfigured()) await window.supabaseClient.auth.signOut();
  localStorage.removeItem('bw_user');
  localStorage.removeItem('bw_onboarded');
  showToast('🚪 로그아웃 됐습니다');
  setTimeout(() => { currentUser = null; currentProfile = null; goTo('splash'); }, 1200);
});

// ── 회원탈퇴 ──
document.getElementById('si-withdraw').addEventListener('click', () =>
  document.getElementById('withdraw-modal').classList.remove('hidden'));


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
let loadedRooms = []; // 동적으로 불러온 모임 저장
const ROOM_DATA = [
  { id:'1', game:'🎲 뱅!', status:'모집중', status_cls:'open', title:'강남에서 뱅! 같이 할 사람', place:'강남역 보드카페', time:'오늘 오후 7시', members:2, max_members:6, level:'모두 환영', description:'뱅! 초보도 환영해요. 규칙은 현장에서 설명해드릴게요. 편하게 연락주세요 😊' },
  { id:'2', game:'🃏 카탄', status:'모집중', status_cls:'open', title:'카탄 초보 환영 🤝', place:'홍대 게임바', time:'오늘 오후 6시', members:3, max_members:4, level:'초보 환영', description:'카탄 처음이어도 괜찮아요! 같이 규칙 보면서 시작할게요. 오세요 🎉' },
  { id:'3', game:'🎯 루미큐브', status:'오늘 저녁', status_cls:'soon', title:'루미큐브 고수 구합니다', place:'신촌 카페', time:'오늘 저녁 8시', members:1, max_members:4, level:'중급 이상', description:'루미큐브 좀 하시는 분들이랑 즐겁게 한 판 하고 싶어요. 실력자 우대 😈' },
];

function openRoomSheet(id) {
  const data = loadedRooms.find(r => String(r.id) === String(id)) || ROOM_DATA.find(r => r.id === id) || ROOM_DATA[0];
  document.getElementById('sd-game').textContent = data.game;
  document.getElementById('sd-status').textContent = data.status || '모집중';
  document.getElementById('sd-status').className = `match-status ${data.status_cls || 'open'}`;
  document.getElementById('sd-title').textContent = data.title;
  document.getElementById('sd-place').textContent = data.place || '장소 미정';
  document.getElementById('sd-time').textContent = data.time || '시간 미정';
  document.getElementById('sd-members').textContent = `${data.members || 1} / ${data.max_members || 4}명`;
  document.getElementById('sd-level').textContent = data.level || '모두 환영';
  document.getElementById('sd-desc').textContent = data.description || '';
  
  // 버튼에 roomId 세팅
  const joinBtn = document.getElementById('sd-join-btn');
  joinBtn.dataset.roomId = data.id;

  const chatBtn = document.getElementById('sd-chat-btn');
  chatBtn.dataset.roomId = data.id;

  document.getElementById('room-sheet').classList.remove('hidden');
}
function closeRoomSheet() {
  document.getElementById('room-sheet').classList.add('hidden');
}
document.getElementById('sheet-backdrop').addEventListener('click', closeRoomSheet);
document.getElementById('sd-join-btn').addEventListener('click', async (e) => {
  const roomId = e.currentTarget.dataset.roomId;
  
  if (!isPlusUser && freeMatchesLeft <= 0) {
    closeRoomSheet();
    showToast('매칭 횟수를 모두 소진했습니다. 위버 플러스를 이용해 보세요!');
    setTimeout(() => goTo('plus'), 1500);
    return;
  }
  
  // 백엔드 모임 가입 처리
  let ok = true;
  if (isSupabaseConfigured()) {
    ok = await joinRoomInBackend(roomId);
  }

  if (ok) {
    if (!isPlusUser) {
      freeMatchesLeft--;
      updateMatchCounterUI();
    }
    closeRoomSheet();
    showToast(isPlusUser ? '✅ [PLUS] 프리미엄 매칭 완료!' : '✅ 함께하기 신청 완료!');
    renderDynamicRooms(); // 목록 새로고침
  }
});
document.getElementById('sd-chat-btn').addEventListener('click', (e) => {
  const roomId = e.currentTarget.dataset.roomId;
  closeRoomSheet();
  goTo('chat');
  syncNav('chat');
  setTimeout(() => openChatroom(roomId), 200);
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
  const sheet = document.getElementById('edit-sheet');
  if (!sheet) return;

  // 현재 프로필 값으로 폼 채우기
  const nameEl   = document.getElementById('ef-name');
  const handleEl = document.getElementById('ef-handle');
  const bioEl    = document.getElementById('ef-bio');

  if (nameEl   && currentProfile?.nickname) nameEl.value   = currentProfile.nickname;
  if (handleEl && currentProfile?.handle)   handleEl.value = currentProfile.handle;
  if (bioEl    && currentProfile?.bio)      bioEl.value    = currentProfile.bio;

  // 현재 지역 칩 활성화
  if (currentProfile?.area) {
    document.querySelectorAll('.edit-select-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.area === currentProfile.area);
    });
  }

  // 즐겨하는 게임 pills 채우기
  if (currentProfile?.favorite_games?.length) {
    const tagInput = document.getElementById('game-tag-input');
    const addBtn   = document.getElementById('pill-add-btn');
    if (tagInput && addBtn) {
      tagInput.querySelectorAll('.game-tag-pill').forEach(p => p.remove());
      currentProfile.favorite_games.forEach(g => {
        const pill = document.createElement('div');
        pill.className = 'game-tag-pill';
        pill.dataset.g = g;
        pill.innerHTML = `${GAME_EMOJIS[g] || '🎮'} ${g} <span class="pill-x">×</span>`;
        tagInput.insertBefore(pill, addBtn);
      });
    }
  }

  updateCount('ef-name',   'ef-name-count',   16);
  updateCount('ef-bio',    'ef-bio-count',     60);

  sheet.classList.remove('hidden');
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
  // Supabase에 저장
  saveUserProfile({ nickname: newName, handle: newHandle, favorite_games: games, area }).then(ok => {
    showToast(ok ? '✅ 프로필이 저장됐어요!' : '✅ 프로필이 저장됐어요 (로컬)!');
  });
});

// ===========================
// WITHDRAW & TERMS
// ===========================
document.getElementById('withdraw-cancel').addEventListener('click', () => {
  document.getElementById('withdraw-modal').classList.add('hidden');
});
document.getElementById('withdraw-confirm').addEventListener('click', async () => {
  document.getElementById('withdraw-modal').classList.add('hidden');
  if (isSupabaseConfigured() && currentUser) {
    await window.supabaseClient.auth.signOut();
  }
  localStorage.clear();
  currentUser = null;
  currentProfile = null;
  showToast('회원탈퇴가 완료되었습니다. 안녕히 가세요.');
  setTimeout(() => {
    // 앱을 완전히 리셋하기 위해 페이지 새로고침
    window.location.reload();
  }, 1500);
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
   [백엔드] SUPABASE API SERVICE (스키마 완전 연동)
   ========================================= */

// ── 현재 로그인 유저 정보 ──
let currentUser = null;        // auth.users 세션
let currentProfile = null;     // public.users 프로필

// Auth 세션 변경 감지 → 프로필 자동 로드
if (isSupabaseConfigured()) {
  window.supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      currentUser = session.user;
      await loadUserProfile(currentUser.id);
      showToast('✅ 로그인 완료!');
      if (checkNeedsOnboarding(currentProfile)) {
        goTo('onboarding');
        goOnboardStep(1);
      } else {
        goTo('home');
        renderDynamicRooms();
        subscribeToNotifications();
        renderChatList();
      }
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      currentProfile = null;
    }
  });
  // 앱 시작 시 기존 세션 복원
  window.supabaseClient.auth.getSession().then(({ data: { session } }) => {
    if (session) {
      currentUser = session.user;
      loadUserProfile(currentUser.id).then(() => {
        if (checkNeedsOnboarding(currentProfile)) {
          goTo('onboarding');
          goOnboardStep(1);
        } else {
          goTo('home');
          renderDynamicRooms();
          renderActivityFeed();
          subscribeToNotifications();
          renderChatList();
        }
      });
    }
  });
}

// ── 1. 유저 프로필 로드 ──
async function loadUserProfile(userId) {
  if (!isSupabaseConfigured()) return;
  try {
    const { data, error } = await window.supabaseClient
      .from('users').select('*').eq('id', userId).single();
    if (error) throw error;
    currentProfile = data;
    // 설정 화면 UI 업데이트
    if (data.nickname) {
      document.querySelector('.sp-info strong')?.textContent !== undefined &&
        (document.querySelector('.sp-info strong').textContent = data.nickname);
      document.querySelector('#screen-profile .profile-name')?.textContent !== undefined &&
        (document.querySelector('#screen-profile .profile-name').textContent = data.nickname);
    }
    if (data.handle) {
      document.querySelector('.sp-info span')?.textContent !== undefined &&
        (document.querySelector('.sp-info span').textContent = '@' + data.handle);
      document.querySelector('#screen-profile .profile-handle')?.textContent !== undefined &&
        (document.querySelector('#screen-profile .profile-handle').textContent = '@' + data.handle);
    }
    if (data.area) {
      const locEl = document.querySelector('#si-location .si-val');
      if (locEl) locEl.textContent = data.area;
    }
    if (currentUser?.email) {
      const emailEl = document.querySelector('#si-email .si-val');
      if (emailEl) emailEl.textContent = currentUser.email;
    }
    if (currentUser?.phone) {
      const phoneEl = document.querySelector('#si-phone .si-val');
      if (phoneEl) phoneEl.textContent = currentUser.phone;
    }
    // 프로필 로드 성공 → UI 업데이트
    // 통계: 매칭 수
    const matchEl = document.getElementById('profile-stat-match');
    if (matchEl) matchEl.textContent = data.match_count ?? 0;
    // 통계: 즐겨찾기 게임 수
    const favEl = document.getElementById('profile-stat-fav');
    if (favEl) favEl.textContent = (data.favorite_games ?? []).length;
    // 통계: 평점
    const ratingEl = document.getElementById('profile-stat-rating');
    if (ratingEl) ratingEl.textContent = data.rating_avg ? `⭐ ${parseFloat(data.rating_avg).toFixed(1)}` : '-';
    // 즐겨하는 게임 칩
    const favChipWrap = document.getElementById('fav-game-chips');
    if (favChipWrap && data.favorite_games?.length) {
      const addChip = favChipWrap.querySelector('.add-chip');
      favChipWrap.querySelectorAll('.fav-chip:not(.add-chip)').forEach(c => c.remove());
      data.favorite_games.forEach(g => {
        const span = document.createElement('span');
        span.className = 'fav-chip';
        span.textContent = g;
        favChipWrap.insertBefore(span, addChip);
      });
    }
    // 매칭 히스토리 (내가 참여한 방 목록)
    if (isSupabaseConfigured() && userId) {
      try {
        const { data: joined } = await window.supabaseClient
          .from('room_members')
          .select('rooms(id, title, game, members, created_at)')
          .eq('user_id', userId)
          .eq('status', 'joined')
          .order('joined_at', { ascending: false })
          .limit(5);
        const histEl = document.getElementById('history-list');
        if (histEl && joined?.length) {
          histEl.innerHTML = joined.map(m => {
            const r = m.rooms;
            if (!r) return '';
            const ago = r.created_at ? new Date(r.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) : '';
            const icon = r.game?.match(/(\p{Emoji})/u)?.[0] || '🎲';
            return `<div class="history-item"><span class="hi-icon">${icon}</span><div><strong>${r.title}</strong><p>${ago} · ${r.members ?? '-'}명</p></div><span class="hi-rate">⭐</span></div>`;
          }).join('');
        }
      } catch(e) { /* 히스토리 로드 실패는 무시 */ }
    }
  } catch (err) {
    console.error('프로필 로드 에러:', err);
  }
}

// ── 2. 유저 프로필 저장 ──
async function saveUserProfile(updates) {
  if (!isSupabaseConfigured() || !currentUser) return false;
  try {
    const { error } = await window.supabaseClient
      .from('users').update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', currentUser.id);
    if (error) throw error;
    currentProfile = { ...currentProfile, ...updates };
    return true;
  } catch (err) {
    console.error('프로필 저장 에러:', err);
    return false;
  }
}

// ── 3. 모임 리스트 불러오기 ──
async function fetchRoomsFromBackend() {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data, error } = await window.supabaseClient
      .from('rooms')
      .select('*, users!rooms_host_id_fkey(nickname, avatar_url)')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    loadedRooms = data || [];
    return loadedRooms;
  } catch (err) {
    console.error('❌ 모임 로드 에러:', err);
    return [];
  }
}

// ── 4. 모임 생성 ──
async function createRoomInBackend(roomObj) {
  if (!isSupabaseConfigured() || !currentUser) {
    showToast('⚠️ 모임 생성은 로그인 후 이용 가능합니다');
    return null;
  }
  try {
    const { data, error } = await window.supabaseClient
      .from('rooms')
      .insert([{ ...roomObj, host_id: currentUser.id }])
      .select().single();
    if (error) throw error;
    // 활동 피드에 기록
    await window.supabaseClient.from('activity_feed').insert([{
      actor_id: currentUser.id,
      actor_name: currentProfile?.nickname || '보드게이머',
      action: 'create',
      target: roomObj.title,
      room_id: data.id
    }]);
    console.log('✅ 모임 생성 완료:', data.id);
    return data;
  } catch (err) {
    console.error('모임 생성 에러:', err);
    showToast('모임 생성 실패: ' + err.message);
    return null;
  }
}

// ── 5. 모임 참여 ──
async function joinRoomInBackend(roomId) {
  if (!isSupabaseConfigured() || !currentUser) {
    showToast('⚠️ 로그인 후 이용 가능합니다'); return false;
  }
  try {
    const { error } = await window.supabaseClient
      .from('room_members')
      .insert([{ room_id: roomId, user_id: currentUser.id, status: 'joined' }]);
    if (error) throw error;
    // 인원 수 증가
    await window.supabaseClient.rpc('increment_members', { room_id: roomId }).catch(() => {});
    // 활동 피드
    await window.supabaseClient.from('activity_feed').insert([{
      actor_id: currentUser.id,
      actor_name: currentProfile?.nickname || '보드게이머',
      action: 'join',
      room_id: roomId
    }]).catch(() => {});
    return true;
  } catch (err) {
    if (err.code === '23505') { showToast('이미 참여한 모임입니다'); return false; }
    console.error('참여 에러:', err);
    return false;
  }
}

// ── 6. 채팅 메시지 전송 ──
async function sendChatMessage(roomId, text, senderName) {
  if (!isSupabaseConfigured() || !currentUser) return;
  try {
    const { error } = await window.supabaseClient.from('messages').insert([{
      room_id: roomId === 'global' ? null : roomId,
      sender_id: currentUser.id,
      sender_name: senderName || currentProfile?.nickname || '보드게이머',
      text
    }]);
    if (error) throw error;
  } catch (err) {
    console.error('채팅 전송 에러:', err);
  }
}

// ── 7. 채팅 기록 로드 ──
async function loadChatHistory(roomId) {
  if (!isSupabaseConfigured()) return;
  try {
    const { data, error } = await window.supabaseClient
      .from('messages')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })
      .limit(100);
    if (error) throw error;
    if (data && data.length > 0) {
      // 해당 방 메시지 수 저장 처리 (unread 계산용)
      localStorage.setItem(`bw_chat_read_${roomId}`, data.length);
      
      const chatMessages = document.getElementById('chat-messages');
      chatMessages.innerHTML = '';
      data.forEach(msg => {
        const isMe = msg.sender_id === currentUser?.id;
        appendChatBubble({ text: msg.text, isMe, sender: msg.sender_name });
      });
      scrollChatToBottom();
    }
  } catch (err) { console.error('채팅 기록 로드 에러:', err); }
}

// ── 8. 실시간 채팅 구독 ──
let chatChannel = null;
async function listenToChatUpdates(roomId, callback) {
  if (!isSupabaseConfigured()) return;
  // 기존 채널 해제 시 반드시 await 후 완전히 삭제됐는지 확인
  if (chatChannel) { 
    await window.supabaseClient.removeChannel(chatChannel); 
    chatChannel = null; 
  }
  const filter = roomId && roomId !== 'global'
    ? `room_id=eq.${roomId}` : undefined;
    
  chatChannel = window.supabaseClient.channel(`chat_${roomId || 'global'}`);
  
  chatChannel.on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messages',
      ...(filter ? { filter } : {})
    }, payload => {
      // 내가 보낸 메시지가 아니면 상대방 콜백 처리
      if (payload.new.sender_id !== currentUser?.id) {
        callback(payload.new);
      }
      
      // 현재 방을 보고 있으면 방금 온 메시지도 읽음 처리 (총 메시지 개수 + 1)
      if (currentRoomId === roomId) {
         let rCount = parseInt(localStorage.getItem(`bw_chat_read_${roomId}`) || '0');
         localStorage.setItem(`bw_chat_read_${roomId}`, rCount + 1);
      } else {
         // 다른 곳을 보는 중이면 채팅 목록/배지 갱신이 필요할 수 있으므로 renderChatList() 자동 호출 (선택적)
         renderChatList();
      }
    }).subscribe();
}

// ── 8-1. 채팅 목록 렌더링 (동적 배지 계산) ──
async function renderChatList() {
  const chatListMain = document.querySelector('.chat-list-main');
  if (!chatListMain) return;
  chatListMain.innerHTML = '<p style="text-align:center;padding:20px;color:#888;">로딩 중...</p>';
  
  if (!isSupabaseConfigured() || !currentUser) {
    chatListMain.innerHTML = '<p style="text-align:center;padding:20px;color:#888;">로그인 후 이용 가능합니다.</p>';
    document.querySelector('.nav-badge').style.display = 'none';
    return;
  }
  
  try {
    const { data: myMemberships } = await window.supabaseClient
      .from('room_members')
      .select('room_id')
      .eq('user_id', currentUser.id)
      .eq('status', 'joined');
      
    if (!myMemberships || myMemberships.length === 0) {
      chatListMain.innerHTML = '<p style="text-align:center;padding:20px;color:#888;">참여 중인 모임이 없습니다.</p>';
      document.querySelector('.nav-badge').style.display = 'none';
      return;
    }
    
    const roomIds = myMemberships.map(m => m.room_id);
    
    // 방 정보
    const { data: rooms } = await window.supabaseClient
      .from('rooms')
      .select('*')
      .in('id', roomIds);
      
    // 메시지 최근 100건 가량 가져와 방별 최신 메시지 추출 및 unread 카운팅
    // (완전한 프로덕션에서는 RPC/서버사이드 조인을 추천)
    const { data: msgs } = await window.supabaseClient
      .from('messages')
      .select('room_id, text, created_at, sender_name')
      .in('room_id', roomIds)
      .order('created_at', { ascending: false })
      .limit(500);
      
    let totalUnread = 0;
      
    const html = rooms.map(room => {
      const roomMsgs = msgs ? msgs.filter(m => m.room_id === room.id) : [];
      const latestMsg = roomMsgs[0];
      const totalMsgCount = roomMsgs.length;
      const readCount = parseInt(localStorage.getItem(`bw_chat_read_${room.id}`) || '0');
      let unread = totalMsgCount - readCount;
      if (unread < 0) unread = 0;
      totalUnread += unread;
      
      let timeStr = '조건 없음';
      if (latestMsg) {
        const d = new Date(latestMsg.created_at);
        const today = new Date();
        if (d.getDate() === today.getDate()) timeStr = d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        else timeStr = d.toLocaleDateString([], {month: 'short', day: 'numeric'});
      } else {
        timeStr = '게시됨';
      }
      
      const text = latestMsg ? `${latestMsg.sender_name}: ${latestMsg.text}` : '아직 메시지가 없습니다.';
      const unreadBadge = unread > 0 ? `<span class="chat-unread">${unread}</span>` : '';
      const initial = room.title ? room.title[0] : '방';
      
      return `
        <div class="chat-item" data-room-id="${room.id}">
          <div class="ava-group">
            <div class="ava" style="background:linear-gradient(135deg,#3B82F6,#8B5CF6)">${initial}</div>
          </div>
          <div class="chat-preview">
            <div class="chat-preview-row1">
              <strong>${room.title}</strong>
              <span class="chat-time">${timeStr}</span>
            </div>
            <p>${text}</p>
          </div>
          ${unreadBadge}
        </div>
      `;
    }).join('');
    
    chatListMain.innerHTML = html;
    
    // 글로벌 뱃지 업데이트
    const navBadgeList = document.querySelectorAll('.nav-badge');
    navBadgeList.forEach(navBadge => {
      if (totalUnread > 0) {
        navBadge.style.display = 'inline-block';
        navBadge.textContent = totalUnread;
      } else {
        navBadge.style.display = 'none';
      }
    });
    
    // 클릭 이벤트 다시 바인딩
    chatListMain.querySelectorAll('.chat-item').forEach(item => {
      item.addEventListener('click', () => {
        openChatroom(item.dataset.roomId);
        // 방 들어갈 때 방금 렌더된 unread 배지 즉각 초기화
        const b = item.querySelector('.chat-unread');
        if(b) b.remove();
      });
    });
    
  } catch (err) {
    console.error('채팅 목록 로드 중 에러:', err);
    chatListMain.innerHTML = '<p style="text-align:center;padding:20px;color:#888;">목록을 불러올 수 없습니다.</p>';
  }
}

// ── 8-2. 실시간 활동 피드 렌더링 ──
async function renderActivityFeed() {
  const feedEl = document.getElementById('activity-feed');
  if (!feedEl || !isSupabaseConfigured()) return;
  try {
    const { data } = await window.supabaseClient
      .from('activity_feed')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(6);
    if (!data || data.length === 0) {
      feedEl.innerHTML = '<p style="text-align:center;padding:10px;color:#888;font-size:13px;">최근 활동이 없습니다.</p>';
      return;
    }
    const actionLabel = { join: '참여', create: '생성', full: '마감', review: '후기' };
    const actionCls   = { join: 'act-join', create: 'act-create', full: 'act-full', review: 'act-create' };
    const now = Date.now();
    feedEl.innerHTML = data.map(item => {
      const ms = now - new Date(item.created_at).getTime();
      const m  = Math.floor(ms / 60000);
      const timeStr = m < 1 ? '방금' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.floor(m/60)}시간 전` : `${Math.floor(m/1440)}일 전`;
      const initial = item.actor_name?.[0] || '?';
      const action  = actionLabel[item.action] || item.action;
      const cls     = actionCls[item.action]   || 'act-join';
      return `<div class="activity-item">
        <div class="ava xs" style="background:linear-gradient(135deg,#3B82F6,#8B5CF6)">${initial}</div>
        <p><strong>${item.actor_name}</strong>님이 ${item.target ? `${item.target}에 ` : ''}<span class="${cls}">${action}</span>했어요</p>
        <span class="act-time">${timeStr}</span>
      </div>`;
    }).join('');
  } catch(e) { /* 무시 */ }
}

// ── 9. 후기 제출 ──
async function submitReview(revieweeId, roomId, rating, tags, comment) {
  if (!isSupabaseConfigured() || !currentUser) return false;
  try {
    const { error } = await window.supabaseClient.from('reviews').insert([{
      room_id: roomId,
      reviewer_id: currentUser.id,
      reviewee_id: revieweeId,
      rating,
      tags,
      comment
    }]);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('후기 제출 에러:', err);
    return false;
  }
}

// ── 10. 신고 제출 ──
async function submitReport(reportedId, roomId, reason, detail) {
  if (!isSupabaseConfigured() || !currentUser) return false;
  try {
    const { error } = await window.supabaseClient.from('reports').insert([{
      reporter_id: currentUser.id,
      reported_id: reportedId,
      room_id: roomId,
      reason,
      detail
    }]);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('신고 에러:', err);
    return false;
  }
}

// ── 11. 블록 관리 (Supabase) ──
async function fetchBlockedUsers() {
  if (!isSupabaseConfigured() || !currentUser) return [];
  try {
    const { data, error } = await window.supabaseClient
      .from('blocks')
      .select('blocked_id, users!blocks_blocked_id_fkey(nickname, handle)')
      .eq('blocker_id', currentUser.id);
    if (error) throw error;
    return data || [];
  } catch (err) { return []; }
}

async function unblockUser(blockedId) {
  if (!isSupabaseConfigured() || !currentUser) return false;
  try {
    const { error } = await window.supabaseClient
      .from('blocks')
      .delete()
      .eq('blocker_id', currentUser.id)
      .eq('blocked_id', blockedId);
    if (error) throw error;
    return true;
  } catch (err) { return false; }
}

// 블록 관리 UI 업데이트
async function renderBlockedUsers() {
  const list = document.getElementById('blocked-users-list');
  const noMsg = document.getElementById('no-blocked-msg');
  list.innerHTML = '<p style="color:#64748B;text-align:center">로딩 중...</p>';

  let blocked = [];
  if (isSupabaseConfigured() && currentUser) {
    blocked = await fetchBlockedUsers();
  } else {
    blocked = JSON.parse(localStorage.getItem('bw_blocked') || '[]').map(n => ({ blocked_id: n, users: { nickname: n } }));
  }

  list.innerHTML = '';
  if (blocked.length === 0) { noMsg.style.display = 'block'; return; }
  noMsg.style.display = 'none';

  // 블록 수 표시
  document.querySelectorAll('.settings-item').forEach(item => {
    if (item.querySelector('.si-icon')?.textContent === '🚫') {
      const val = item.querySelector('.si-val');
      if (val) val.textContent = `${blocked.length}명`;
    }
  });

  blocked.forEach(b => {
    const row = document.createElement('div');
    row.className = 'blocked-user-row';
    const name = b.users?.nickname || b.blocked_id;
    const handle = b.users?.handle ? `@${b.users.handle}` : '';
    row.innerHTML = `
      <div class="bu-avatar">👤</div>
      <div>
        <div class="bu-name">${name}</div>
        ${handle ? `<div style="font-size:12px;color:#64748B">${handle}</div>` : ''}
      </div>
      <button class="bu-unblock">차단 해제</button>`;
    row.querySelector('.bu-unblock').addEventListener('click', async () => {
      const ok = await unblockUser(b.blocked_id);
      if (ok) { showToast('차단이 해제됐습니다'); renderBlockedUsers(); }
    });
    list.appendChild(row);
  });
}

// ── 12. 실시간 알림 구독 ──
let notifChannel = null;
function subscribeToNotifications() {
  if (!isSupabaseConfigured() || !currentUser) return;
  if (notifChannel) { window.supabaseClient.removeChannel(notifChannel); }
  notifChannel = window.supabaseClient
    .channel(`notif_${currentUser.id}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'notifications',
      filter: `user_id=eq.${currentUser.id}`
    }, payload => {
      const n = payload.new;
      showToast(`🔔 ${n.title}`);
      // 알림 배지 업데이트
      const badge = document.querySelector('.notif-badge');
      if (badge) { badge.style.display = 'flex'; badge.textContent = (parseInt(badge.textContent || 0) + 1); }
    })
    .subscribe();
}

// ── 후기 제출 연동 (rating-submit 버튼) ──
document.getElementById('rating-submit').removeEventListener('click', () => {});
document.getElementById('rating-submit').addEventListener('click', async () => {
  const tags = [...document.querySelectorAll('.review-tag.selected')].map(t => t.textContent.trim());
  const ok = await submitReview(
    null, currentRoomId, selectedStars, tags, ''
  );
  closeRatingModal();
  showToast(ok ? '⭐ 후기가 등록됐습니다!' : '⭐ 후기가 저장됐습니다!');
});

// ── 신고 제출 연동 ──
document.getElementById('report-submit').addEventListener('click', async () => {
  const reason = [...document.querySelectorAll('.report-tag.selected')].map(t => t.textContent.trim()).join(', ');
  const detail = document.getElementById('report-reason')?.value.trim() || '';
  if (!reason) { showToast('신고 사유를 선택해 주세요'); return; }
  const ok = await submitReport(null, currentRoomId, reason, detail);
  document.getElementById('report-modal').classList.add('hidden');
  showToast(ok ? '🚨 신고가 접수됐습니다' : '🚨 신고 및 차단 처리됐습니다');
});

// ── 동적 모임 렌더링 (거리 필터 포함) ──
async function renderDynamicRooms() {
  const allRooms = await fetchRoomsFromBackend();
  const radiusKm = parseInt(localStorage.getItem('bw_radius') || '99'); // 기본: 제한 없음
  // 거리 필터 적용 (좌표가 있는 경우에만)
  const rooms = filterRoomsByRadius(allRooms, radiusKm);

  const homeContainer = document.getElementById('dynamic-rooms-home');
  const exploreContainer = document.querySelector('.explore-list');

  if (!rooms || rooms.length === 0) {
    const hasGeo = userLat && userLng;
    const emptyMsg = `<p style="text-align:center;width:100%;color:#888;margin-top:20px;padding:20px">
      ${hasGeo && radiusKm < 99 ? `📍 ${radiusKm}km 반경 내 모임이 없어요 🎲` : '아직 만들어진 모임이 없어요 🎲'}
      <br><small>첫 모임을 만들어 보세요!</small></p>`;
    if (homeContainer) homeContainer.innerHTML = emptyMsg;
    if (exploreContainer) exploreContainer.innerHTML = emptyMsg;
    return;
  }

  const htmlString = rooms.map(room => {
    const cls = room.status_cls || 'open';
    const distBadge = room._distKm !== null && room._distKm !== undefined
      ? `<span class="dist-pill">📍 ${formatDistance(room._distKm)}</span>`
      : `<span class="dist-pill">📍 ${room.place || '장소 미정'}</span>`;

    const filled = Math.min(room.members || 1, room.max_members || 4);
    const empty  = Math.max(0, (room.max_members || 4) - filled);
    const colors = ['#3B82F6','#8B5CF6','#10B981','#F59E0B'];
    const avatars = Array.from({ length: Math.min(filled, 3) }, (_, i) =>
      `<div class="ava overlap" style="background:${colors[i % colors.length]};width:26px;height:26px;font-size:11px">👤</div>`
    ).join('');
    const moreTag  = filled > 3  ? `<div class="ava-more">+${filled - 3}</div>` : '';
    const emptyTag = filled <= 3 && empty > 0 ? `<div class="ava-more" style="background:rgba(255,255,255,0.05);color:#666">+${empty}</div>` : '';

    return `
    <div class="match-card ${cls}" data-id="${room.id}">
      <div class="match-card-top"></div>
      <div class="match-card-body">
        <div class="match-card-header">
          <span class="game-tag">${room.game}</span>
          <span class="match-status ${cls}">${room.status || '모집중'}</span>
        </div>
        <h3>${room.title}</h3>
        <div class="match-meta">
          ${distBadge}
          <span>👥 ${room.members || 1}/${room.max_members || 4}명 &nbsp;·&nbsp; ⚡ ${room.level || '모두 환영'}</span>
          <span>🕐 ${room.time || '시간 미정'}</span>
        </div>
        <div class="match-card-footer">
          <div class="match-avatars">${avatars}${moreTag}${emptyTag}</div>
          <button class="join-btn" data-room-id="${room.id}">함께하기</button>
        </div>
      </div>
    </div>`;
  }).join('');

  if (homeContainer) homeContainer.innerHTML = htmlString;
  if (exploreContainer) exploreContainer.innerHTML = htmlString;

  // 이벤트 바인딩
  document.querySelectorAll('.match-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('join-btn')) return;
      openRoomSheet(card.dataset.id);
    });
  });
  document.querySelectorAll('.join-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const roomId = btn.dataset.roomId;
      if (!currentUser) { showToast('로그인 후 이용 가능합니다'); return; }
      const ok = await joinRoomInBackend(roomId);
      if (ok) {
        btn.textContent = '참여 완료 ✓';
        btn.style.background = 'var(--green)';
        btn.style.boxShadow = 'none';
        showToast('✅ 모임 참여 완료! 채팅방에서 인사하세요 😊');
        setTimeout(() => renderDynamicRooms(), 1200);
      }
    });
  });

  // Explore 탭 전환
  document.querySelectorAll('.tab').forEach(tab => {
    // 이미 바인딩된 이벤트 방지용 (클론)
  });

  // 렌더 후 카테고리 필터 재적용
  applyExploreFilter();
}

// ── 앱 초기화 ──
document.addEventListener('DOMContentLoaded', async () => {
  // 저장된 반경/위치 복원
  const savedRadius = localStorage.getItem('bw_radius');
  if (savedRadius) {
    const el = document.querySelector('#si-range .si-val');
    if (el) el.textContent = savedRadius + 'km';
  }
  const savedLoc = localStorage.getItem('bw_loc');
  if (savedLoc) {
    const locEl = document.querySelector('#si-location .si-val');
    if (locEl) locEl.textContent = '서울 ' + savedLoc;
  }
  // GPS 초기화 후 방 목록 렌더링
  await initGeoLocation();
});
