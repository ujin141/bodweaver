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
-- 중복 실행해도 에러 안 나는 안전한 방식 (DO $$ ... EXCEPTION)
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

DROP POLICY IF EXISTS "users_select_all" ON public.users;
CREATE POLICY "users_select_all" ON public.users FOR SELECT USING (true);
DROP POLICY IF EXISTS "users_update_self" ON public.users;
CREATE POLICY "users_update_self" ON public.users FOR UPDATE USING (auth.uid() = id);
DROP POLICY IF EXISTS "users_insert_trigger" ON public.users;
CREATE POLICY "users_insert_trigger" ON public.users FOR INSERT WITH CHECK (true);

-- rooms
DROP POLICY IF EXISTS "rooms_select_all" ON public.rooms;
CREATE POLICY "rooms_select_all" ON public.rooms FOR SELECT USING (true);
DROP POLICY IF EXISTS "rooms_insert_auth" ON public.rooms;
CREATE POLICY "rooms_insert_auth" ON public.rooms FOR INSERT WITH CHECK (auth.uid() = host_id);
DROP POLICY IF EXISTS "rooms_update_host" ON public.rooms;
CREATE POLICY "rooms_update_host" ON public.rooms FOR UPDATE USING (auth.uid() = host_id);
DROP POLICY IF EXISTS "rooms_delete_host" ON public.rooms;
CREATE POLICY "rooms_delete_host" ON public.rooms FOR DELETE USING (auth.uid() = host_id);

-- room_members
DROP POLICY IF EXISTS "room_members_select" ON public.room_members;
CREATE POLICY "room_members_select" ON public.room_members FOR SELECT USING (true);
DROP POLICY IF EXISTS "room_members_insert" ON public.room_members;
CREATE POLICY "room_members_insert" ON public.room_members FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "room_members_delete" ON public.room_members;
CREATE POLICY "room_members_delete" ON public.room_members FOR DELETE USING (auth.uid() = user_id);

-- messages
DROP POLICY IF EXISTS "messages_select_all" ON public.messages;
CREATE POLICY "messages_select_all" ON public.messages FOR SELECT USING (true);
DROP POLICY IF EXISTS "messages_insert_auth" ON public.messages;
CREATE POLICY "messages_insert_auth" ON public.messages FOR INSERT WITH CHECK (auth.uid() = sender_id);

-- notifications
DROP POLICY IF EXISTS "notif_select_self" ON public.notifications;
CREATE POLICY "notif_select_self" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "notif_update_self" ON public.notifications;
CREATE POLICY "notif_update_self" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "notif_insert_system" ON public.notifications;
CREATE POLICY "notif_insert_system" ON public.notifications FOR INSERT WITH CHECK (true);

-- activity_feed
DROP POLICY IF EXISTS "activity_select_all" ON public.activity_feed;
CREATE POLICY "activity_select_all" ON public.activity_feed FOR SELECT USING (true);
DROP POLICY IF EXISTS "activity_insert_auth" ON public.activity_feed;
CREATE POLICY "activity_insert_auth" ON public.activity_feed FOR INSERT WITH CHECK (auth.uid() = actor_id);

-- reviews
DROP POLICY IF EXISTS "reviews_select_all" ON public.reviews;
CREATE POLICY "reviews_select_all" ON public.reviews FOR SELECT USING (true);
DROP POLICY IF EXISTS "reviews_insert_auth" ON public.reviews;
CREATE POLICY "reviews_insert_auth" ON public.reviews FOR INSERT WITH CHECK (auth.uid() = reviewer_id);

-- reports
DROP POLICY IF EXISTS "reports_insert" ON public.reports;
CREATE POLICY "reports_insert" ON public.reports FOR INSERT WITH CHECK (auth.uid() = reporter_id);
DROP POLICY IF EXISTS "reports_select" ON public.reports;
CREATE POLICY "reports_select" ON public.reports FOR SELECT USING (auth.uid() = reporter_id);

-- blocks
DROP POLICY IF EXISTS "blocks_self" ON public.blocks;
CREATE POLICY "blocks_self" ON public.blocks FOR ALL USING (auth.uid() = blocker_id);

-- plus_subscriptions
DO $$ BEGIN CREATE POLICY "plus_select_self"       ON public.plus_subscriptions FOR SELECT USING (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "plus_insert_self"       ON public.plus_subscriptions FOR INSERT WITH CHECK (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ============================================================
-- 11. 실시간(Realtime) WebSocket 구독 활성화
-- ============================================================
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;          EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;       EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;  EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_feed;  EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.room_members;   EXCEPTION WHEN others THEN NULL; END $$;


-- ============================================================
-- 12. 샘플 데이터 (테스트용)
-- 모임은 실제 가입 유저가 앱에서 생성하면 자동으로 들어옵니다.
-- ============================================================


-- ============================================================
-- 13. 보조 함수 (Helper Functions)
-- ============================================================

-- 모임 참여 시 members 카운트 자동 증가
CREATE OR REPLACE FUNCTION public.increment_members(room_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.rooms
  SET members = members + 1
  WHERE id = room_id AND members < max_members;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 모임 탈퇴 시 members 카운트 자동 감소
CREATE OR REPLACE FUNCTION public.decrement_members(room_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.rooms
  SET members = GREATEST(members - 1, 1)
  WHERE id = room_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 인원 변경 시 status 자동 업데이트 트리거
CREATE OR REPLACE FUNCTION public.update_room_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.members >= NEW.max_members THEN
    NEW.status = '마감';     NEW.status_cls = 'full';
  ELSIF NEW.members >= NEW.max_members - 1 THEN
    NEW.status = '마감임박'; NEW.status_cls = 'soon';
  ELSE
    NEW.status = '모집중';   NEW.status_cls = 'open';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_room_members_change ON public.rooms;
CREATE TRIGGER on_room_members_change
  BEFORE UPDATE OF members ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.update_room_status();


-- ============================================================
-- 완료! 모든 테이블 및 함수가 생성되었습니다 ✅
-- 이 파일은 중복 실행해도 에러 없이 안전합니다.
-- ============================================================


-- ============================================================
-- 16. 거리 매칭을 위한 GPS 좌표 컬럼 추가
-- ============================================================

-- users 테이블에 위치 좌표 추가
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS latitude  DECIMAL(10, 8),  -- 위도 (예: 37.49794)
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8);  -- 경도 (예: 127.02764)

-- rooms 테이블에 모임 장소 좌표 추가
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS latitude  DECIMAL(10, 8),  -- 모임 장소 위도
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8);  -- 모임 장소 경도

-- ============================================================
-- Haversine 거리 계산 함수 (km 단위 반환)
-- 사용법: SELECT distance_km(37.497, 127.027, 37.560, 126.978);
-- ============================================================
CREATE OR REPLACE FUNCTION public.distance_km(
  lat1 DECIMAL, lon1 DECIMAL,
  lat2 DECIMAL, lon2 DECIMAL
)
RETURNS DECIMAL AS $$
DECLARE
  R CONSTANT DECIMAL := 6371; -- 지구 반지름 (km)
  dLat DECIMAL;
  dLon DECIMAL;
  a    DECIMAL;
BEGIN
  dLat := radians(lat2 - lat1);
  dLon := radians(lon2 - lon1);
  a    := sin(dLat/2)^2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dLon/2)^2;
  RETURN R * 2 * atan2(sqrt(a), sqrt(1 - a));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- 반경 내 모임 조회 함수
-- 사용법: SELECT * FROM rooms_within_radius(37.497, 127.027, 5);
-- ============================================================
CREATE OR REPLACE FUNCTION public.rooms_within_radius(
  user_lat  DECIMAL,
  user_lon  DECIMAL,
  radius_km DECIMAL DEFAULT 5
)
RETURNS TABLE (
  id UUID, host_id UUID, game TEXT, title TEXT, place TEXT, "time" TEXT,
  members INT, max_members INT, level TEXT, description TEXT,
  status TEXT, status_cls TEXT, is_plus_only BOOLEAN,
  latitude DECIMAL, longitude DECIMAL, created_at TIMESTAMPTZ,
  distance_km DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id, r.host_id, r.game, r.title, r.place, r.time,
    r.members, r.max_members, r.level, r.description,
    r.status, r.status_cls, r.is_plus_only,
    r.latitude, r.longitude, r.created_at,
    public.distance_km(user_lat, user_lon, r.latitude, r.longitude) AS distance_km
  FROM public.rooms r
  WHERE
    r.latitude IS NOT NULL AND r.longitude IS NOT NULL
    AND public.distance_km(user_lat, user_lon, r.latitude, r.longitude) <= radius_km
    AND r.status != '마감'
  ORDER BY distance_km ASC;
END;
$$ LANGUAGE plpgsql STABLE;
