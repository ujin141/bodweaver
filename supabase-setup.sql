-- ============================================================
-- BODWEAVER — Supabase 완전 스키마 (Full Schema)
-- Supabase 대시보드 > SQL Editor 에서 전체 복사 후 RUN 클릭
-- ============================================================

-- ============================================================
-- 0. 확장 기능 활성화
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ============================================================
-- 1. 유저 프로필 (users)
-- Supabase Auth 가입 시 자동 생성되도록 트리거 사용
-- ============================================================
CREATE TABLE IF NOT EXISTS public.users (
    id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    nickname    TEXT NOT NULL DEFAULT '보드게이머',
    handle      TEXT UNIQUE,                      -- @아이디
    avatar_url  TEXT,                             -- 프로필 사진 URL
    area        TEXT DEFAULT '서울',              -- 거주 지역
    bio         TEXT,                             -- 한줄 소개
    is_plus     BOOLEAN DEFAULT FALSE,            -- 위버 플러스 여부
    plus_expire TIMESTAMP WITH TIME ZONE,         -- 플러스 만료일
    free_matches_left INT DEFAULT 5,              -- 무료 매칭 잔여 횟수
    login_provider TEXT DEFAULT 'phone',          -- 로그인 방법 (kakao/google/apple/phone)
    favorite_games TEXT[],                        -- 즐겨하는 게임 목록 (배열)
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 신규 Supabase Auth 유저 가입 시 users 테이블에 자동 INSERT 트리거
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, nickname, handle, login_provider)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '보드게이머'),
    CONCAT('user_', SUBSTRING(NEW.id::text, 1, 8)),
    COALESCE(NEW.raw_app_meta_data->>'provider', 'email')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ============================================================
-- 2. 모임 방 (rooms)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rooms (
    id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    host_id     UUID REFERENCES public.users(id) ON DELETE SET NULL,
    game        TEXT NOT NULL,                    -- 게임 이름 (이모지 포함)
    title       TEXT NOT NULL,                    -- 모임 제목
    place       TEXT,                             -- 장소
    time        TEXT,                             -- 시간 (텍스트)
    scheduled_at TIMESTAMP WITH TIME ZONE,        -- 정확한 예정 시간
    members     INT DEFAULT 1,                    -- 현재 인원
    max_members INT DEFAULT 4,                    -- 최대 인원
    level       TEXT DEFAULT '모두 환영',         -- 실력 요건
    description TEXT,                             -- 상세 설명
    status      TEXT DEFAULT '모집중',            -- 모집중 / 마감 / 취소
    status_cls  TEXT DEFAULT 'open',              -- CSS 클래스 (open/soon/full)
    is_plus_only BOOLEAN DEFAULT FALSE,           -- 플러스 전용 방
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


-- ============================================================
-- 3. 모임 참여자 (room_members)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.room_members (
    id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    room_id     UUID REFERENCES public.rooms(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES public.users(id) ON DELETE CASCADE,
    status      TEXT DEFAULT 'joined',            -- joined / pending / left
    joined_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(room_id, user_id)
);


-- ============================================================
-- 4. 채팅 메시지 (messages)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.messages (
    id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    room_id     UUID REFERENCES public.rooms(id) ON DELETE CASCADE,
    sender_id   UUID REFERENCES public.users(id) ON DELETE SET NULL,
    sender_name TEXT NOT NULL DEFAULT '알 수 없음',
    text        TEXT NOT NULL,
    is_system   BOOLEAN DEFAULT FALSE,            -- 시스템 메시지 여부 (입장/퇴장)
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


-- ============================================================
-- 5. 알림 (notifications)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notifications (
    id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id     UUID REFERENCES public.users(id) ON DELETE CASCADE,  -- 알림 받을 유저
    type        TEXT NOT NULL,
    -- 타입 목록:
    --   'join'      → 누군가 내 방에 참여
    --   'match'     → 매칭 성공
    --   'chat'      → 새 채팅 메시지
    --   'review'    → 새 후기 등록
    --   'system'    → 공지 / 시스템 알림
    --   'plus'      → 플러스 만료 예정
    title       TEXT NOT NULL,
    body        TEXT,
    room_id     UUID REFERENCES public.rooms(id) ON DELETE SET NULL,
    is_read     BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


-- ============================================================
-- 6. 실시간 활동 피드 (activity_feed)
-- 홈 화면 "실시간 활동" 섹션
-- ============================================================
CREATE TABLE IF NOT EXISTS public.activity_feed (
    id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    actor_id    UUID REFERENCES public.users(id) ON DELETE SET NULL,
    actor_name  TEXT NOT NULL,
    action      TEXT NOT NULL,                   -- 'join' / 'create' / 'full' / 'review'
    target      TEXT,                            -- 대상 모임 이름
    room_id     UUID REFERENCES public.rooms(id) ON DELETE SET NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


-- ============================================================
-- 7. 후기 및 평점 (reviews)
-- 모임 후 상대 유저에게 남기는 평가
-- ============================================================
CREATE TABLE IF NOT EXISTS public.reviews (
    id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    room_id     UUID REFERENCES public.rooms(id) ON DELETE CASCADE,
    reviewer_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    reviewee_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    rating      INT CHECK (rating BETWEEN 1 AND 5) DEFAULT 5,
    tags        TEXT[],                          -- ['친절해요', '실력자', '시간 잘 지켜요']
    comment     TEXT,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(room_id, reviewer_id, reviewee_id)    -- 한 모임에서 동일인에게 1번만
);


-- ============================================================
-- 8. 신고 및 차단 (reports / blocks)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.reports (
    id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    reporter_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    reported_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    room_id     UUID REFERENCES public.rooms(id) ON DELETE SET NULL,
    reason      TEXT NOT NULL,                   -- 신고 사유
    detail      TEXT,                            -- 상세 입력
    status      TEXT DEFAULT 'pending',          -- pending / reviewed / resolved
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.blocks (
    id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    blocker_id  UUID REFERENCES public.users(id) ON DELETE CASCADE,
    blocked_id  UUID REFERENCES public.users(id) ON DELETE CASCADE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(blocker_id, blocked_id)
);


-- ============================================================
-- 9. 위버 플러스 구독 내역 (plus_subscriptions)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.plus_subscriptions (
    id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id     UUID REFERENCES public.users(id) ON DELETE CASCADE,
    plan        TEXT DEFAULT 'monthly',          -- monthly / yearly
    price       INT,                             -- 결제 금액 (원)
    started_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at  TIMESTAMP WITH TIME ZONE,
    is_active   BOOLEAN DEFAULT TRUE,
    receipt     TEXT                             -- 앱스토어 영수증 ID
);


-- ============================================================
-- 10. Row Level Security (RLS) 정책 설정
-- 내 데이터는 내가, 공용 데이터는 누구나 읽도록
-- ============================================================

ALTER TABLE public.users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_feed     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plus_subscriptions ENABLE ROW LEVEL SECURITY;

-- users: 누구나 읽기, 본인만 수정
CREATE POLICY "users_select_all"   ON public.users FOR SELECT USING (true);
CREATE POLICY "users_update_self"  ON public.users FOR UPDATE USING (auth.uid() = id);

-- rooms: 누구나 읽기, 로그인 유저는 생성 가능, 본인(방장)만 수정/삭제
CREATE POLICY "rooms_select_all"   ON public.rooms FOR SELECT USING (true);
CREATE POLICY "rooms_insert_auth"  ON public.rooms FOR INSERT WITH CHECK (auth.uid() = host_id);
CREATE POLICY "rooms_update_host"  ON public.rooms FOR UPDATE USING (auth.uid() = host_id);
CREATE POLICY "rooms_delete_host"  ON public.rooms FOR DELETE USING (auth.uid() = host_id);

-- room_members: 누구나 읽기, 로그인 유저 참여 가능
CREATE POLICY "room_members_select" ON public.room_members FOR SELECT USING (true);
CREATE POLICY "room_members_insert" ON public.room_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "room_members_delete" ON public.room_members FOR DELETE USING (auth.uid() = user_id);

-- messages: 누구나 읽기, 로그인 유저 전송 가능
CREATE POLICY "messages_select_all" ON public.messages FOR SELECT USING (true);
CREATE POLICY "messages_insert_auth" ON public.messages FOR INSERT WITH CHECK (auth.uid() = sender_id);

-- notifications: 본인 알림만
CREATE POLICY "notif_select_self"  ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "notif_update_self"  ON public.notifications FOR UPDATE USING (auth.uid() = user_id);

-- activity_feed: 누구나 읽기
CREATE POLICY "activity_select_all" ON public.activity_feed FOR SELECT USING (true);
CREATE POLICY "activity_insert_auth" ON public.activity_feed FOR INSERT WITH CHECK (auth.uid() = actor_id);

-- reviews: 누구나 읽기, 본인이 작성
CREATE POLICY "reviews_select_all"  ON public.reviews FOR SELECT USING (true);
CREATE POLICY "reviews_insert_auth" ON public.reviews FOR INSERT WITH CHECK (auth.uid() = reviewer_id);

-- reports: 본인이 작성한 신고만 볼 수 있음
CREATE POLICY "reports_insert"     ON public.reports FOR INSERT WITH CHECK (auth.uid() = reporter_id);
CREATE POLICY "reports_select"     ON public.reports FOR SELECT USING (auth.uid() = reporter_id);

-- blocks: 본인
CREATE POLICY "blocks_self"        ON public.blocks FOR ALL USING (auth.uid() = blocker_id);

-- plus_subscriptions: 본인
CREATE POLICY "plus_select_self"   ON public.plus_subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "plus_insert_self"   ON public.plus_subscriptions FOR INSERT WITH CHECK (auth.uid() = user_id);


-- ============================================================
-- 11. 실시간(Realtime) WebSocket 구독 활성화
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_feed;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_members;


-- ============================================================
-- 12. 샘플 데이터 (테스트용)
-- 주의: users 테이블은 auth.users에 종속되어 있어
--       실제 로그인 후 자동 생성으로 채워지므로 여기서는 rooms만 삽입합니다.
-- ============================================================
-- (로그인 후 자동 inserts됨, 아래는 익명 샘플은 안전상 생략)
-- 모임은 실제 가입 유저가 앱에서 생성하면 자동으로 들어옵니다.


-- ============================================================
-- 완료! 모든 테이블이 생성되었습니다 ✅
-- 다음 단계:
--   1. Supabase > Settings > API 에서 URL, anon key 복사
--   2. app.js 8-9번 줄 YOUR_SUPABASE_URL_HERE / YOUR_SUPABASE_ANON_KEY_HERE 에 붙여넣기
--   3. 소셜 로그인: 대시보드 Authentication > Providers 에서 Google / Apple 활성화
-- ============================================================
