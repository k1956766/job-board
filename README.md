# 관심 채용공고 (개인용)

사람인·잡코리아·인크루트·자소설닷컴·캐치·링커리어·잡알리오·클린아이·하이브레인넷에서 관심 분야 공고를 모아 한 화면에 보여 주는 개인용 사이트입니다.

- **GitHub Actions**: 정해진 간격마다 공고를 수집해 Cloudflare 저장소(KV)에 넣습니다. (`collector/`)
- **Cloudflare Workers**: 사이트 화면과 API를 제공하고, Cloudflare Access로 본인만 들어갈 수 있게 잠급니다. (`worker.js`, `wrangler.jsonc`, `public/`, `functions/`)
- 찜·숨긴 기업·설정은 Cloudflare KV에만 저장됩니다. 이 저장소(공개)에는 코드만 있습니다.
- 지금 운영 주소: https://job-board.k1956766.workers.dev/ (이메일 일회용 번호로 로그인)
- 이 저장소에 올리면(main) Cloudflare가 자동으로 다시 배포합니다 (Workers Builds).

## 처음 설정

### 1. Cloudflare 저장소(KV) 만들기
Cloudflare 대시보드 → **Storage & Databases → Workers KV** → **Create** → 이름 `job-board` → 만든 뒤 **ID**를 복사해 둡니다.
그 ID를 [`wrangler.jsonc`](wrangler.jsonc)의 `kv_namespaces` → `id`에 넣고 이 저장소에 올립니다. (사이트와 저장 공간의 연결은 이 설정 파일이 합니다. 대시보드에서 따로 연결하지 않습니다.)

### 2. 사이트(Workers) 만들고 잠그기
1. **Workers & Pages → Create application → Import a repository** → 이 저장소 선택
2. 설정
   - Project name: `job-board` (`wrangler.jsonc`의 `name`과 같아야 합니다)
   - Build command: **비움**
   - Deploy command: `npx wrangler deploy` (기본값 그대로)
   - **Protect with Cloudflare Access: 켜기** — 이게 사이트 잠금입니다. 로그인은 이메일로 받은 일회용 번호(One-time PIN)
3. **Deploy** → `job-board.<계정>.workers.dev` 주소가 생깁니다. 시크릿 창으로 열어 이메일을 묻는 화면이 나오면 잠금이 된 것입니다.
4. (선택, 이중 잠금) Workers → job-board → **Settings → Variables and Secrets**에 `ALLOWED_EMAILS` = 본인 이메일을 **Secret**으로 추가

> 화면 설정에서 일반 값(Text)으로 넣은 변수는 다음 배포 때 `wrangler.jsonc` 내용으로 덮어써져 사라집니다. 바뀌면 안 되는 값은 **Secret**으로 넣거나 `wrangler.jsonc`의 `vars`에 적습니다.

### 3. 수집기에 쓸 Cloudflare API 토큰
1. 오른쪽 위 프로필 → **My Profile → API Tokens → Create Token → Custom token**
2. Permissions: **Account → Workers KV Storage → Edit**, Account Resources: 본인 계정 → 만들기 → 토큰 복사
3. **Account ID**: Workers & Pages 첫 화면 오른쪽(또는 대시보드 주소의 숫자·영문 32자리)

### 4. GitHub에 비밀값 넣기
이 저장소 → **Settings → Secrets and variables → Actions → New repository secret** 으로 세 개:

| 이름 | 값 |
|---|---|
| `CF_ACCOUNT_ID` | Cloudflare Account ID |
| `CF_API_TOKEN` | 3번에서 만든 토큰 |
| `KV_NAMESPACE_ID` | 1번 KV ID |

그다음 **Actions → collect → Run workflow** 로 첫 수집을 실행합니다 (10~20분).
이후에는 매시 17분에 깨어나서, 사이트 설정의 수집 간격(기본 6시간)이 됐을 때만 수집합니다.

### 5. (선택) "지금 수집" 버튼으로 바로 실행
버튼은 기본적으로 *다음 정기 실행(최대 1시간 안)에 수집*하도록 요청만 남깁니다. 누르는 즉시 시작하게 하려면:
1. GitHub → Settings → Developer settings → **Fine-grained tokens** → 이 저장소만, **Actions: Read and write** 권한으로 생성
2. Cloudflare → Workers & Pages → job-board → **Settings → Variables and Secrets → Add**: `GH_TOKEN` = 그 토큰, 반드시 **Secret**으로
3. 저장소 이름·브랜치는 `wrangler.jsonc`의 `vars`(`GH_REPO`, `GH_BRANCH`)에 이미 들어 있습니다. 저장소 이름을 바꾸면 여기도 고칩니다.

사이트에서 **지금 수집**을 눌러 "수집을 시작했습니다"가 뜨면 성공입니다. 토큰이 만료되면 버튼만 다음 정기 실행으로 돌아가고 자동 수집은 계속됩니다. (지금 토큰 만료일: 2027-02-22)

## 일부 사이트가 GitHub에서 막힐 때 (집 PC 보조 수집)
GitHub Actions는 해외(미국) 서버에서 실행돼서, 일부 국내 사이트가 접속을 막을 수 있습니다 (사이트 상태줄에 "실패"로 표시).
그럴 때는 항상 켜 두는 집 PC가 그 사이트만 맡게 할 수 있습니다.

1. GitHub 저장소 → Settings → Secrets and variables → Actions → **Variables** 탭 → `SKIP_SOURCES` = 막힌 사이트 (예: `캐치,자소설닷컴,하이브레인넷,클린아이`)
2. 집 PC에 [Node.js LTS](https://nodejs.org) 설치, 이 저장소를 내려받기 (Code → Download ZIP 후 압축 풀기)
3. `home-pc\install.bat` 실행 → 메모장이 열리면 Cloudflare 값 세 개와 `ONLY_SOURCES`(집 PC가 맡을 사이트)를 채우고 저장
4. 끄려면 `home-pc\uninstall.bat`

### 자소설닷컴 (브라우저로 받아 두기)
자소설닷컴은 프로그램 접속을 Cloudflare 봇 차단으로 막아서(국내 IP에서도 403) 수집기가 직접 받지 못합니다.
대신 사람이 쓰는 크롬에서 채용 달력을 열고 받아 둔 파일을 집 PC 수집기가 읽습니다.

1. `node --env-file=home-pc\home.env home-pc\jasoseol-terms.mjs` → 현재 검색어가 들어간 브라우저 코드가 출력됩니다.
2. 크롬에서 https://jasoseol.com/recruit 를 열고, 그 탭에서 1번 코드를 실행합니다 (Claude in Chrome 등). 관심 분야 공고만 추린 JSON이 탭 화면에 뜹니다.
3. 그 글자를 `home-pc\jasoseol.json`으로 저장합니다 (GitHub에 올라가지 않음).
4. `node --env-file=home-pc\home.env collector\run.js --force` → 자소설닷컴을 포함해 집 PC가 맡은 사이트를 수집해 올립니다.

수집기는 파일을 읽을 때 검사합니다. 제대로 된 파일은 `home-pc\jasoseol.last-good.json`으로 보관해 두고, 새 파일이 깨졌으면(잘린 JSON, 공고 수 불일치, 브라우저 오류 등) 보관본을 대신 쓰며 상태줄에 **"자소설닷컴 N건 (이전 파일)"**로 표시합니다.
받아 둔 자료가 하루 넘게 지나면 상태줄에 **"(자료 N일 전)"**이 붙고, 4일보다 오래되면 쓰지 않고 '실패'로 표시합니다. (주말에는 금요일 자료라 "자료 2~3일 전"이 보이는 게 정상입니다.) 이 PC에서는 Claude 예약 작업이 평일 아침마다 1~4를 합니다.

## 무료 한도
- Cloudflare KV 무료: 하루 쓰기 1,000회 / 읽기 100,000회. 수집 1회에 쓰기 약 12회, 찜·숨기기 1번에 1회라 충분합니다.
- 공개 저장소의 GitHub Actions는 무료이며 시간 제한이 없습니다. 저장소에 60일간 변경이 없으면 예약 실행이 꺼지는데, 수집할 때마다 자동으로 다시 켜 둡니다.

## 파일 구성
- `public/` 화면 (index.html, view.js, view.css) + 공통 로직 (lib.js 목록 해석·묶기, orgs.js 기관 분류, similar.js 찜 일수도)
- `worker.js` Workers 진입점 (`/api/*`는 API로, 나머지는 `public/` 화면 파일로)
- `wrangler.jsonc` Workers 설정 (KV 연결 `JOBS`, 저장소 이름 `GH_REPO`)
- `functions/api/[[path]].js` 사이트 API (KV 읽기·쓰기, 원문 중계)
- `collector/` 수집기 (run.js 실행, sites.js 사이트별 수집, kv.js 저장)
- `.github/workflows/collect.yml` 정기 실행
- `home-pc/` 집 PC 보조 수집 (선택)
