# 관심 채용공고 (개인용)

사람인·잡코리아·인크루트·자소설닷컴·캐치·링커리어·잡알리오·클린아이·하이브레인넷에서 관심 분야 공고를 모아 한 화면에 보여 주는 개인용 사이트입니다.

- **GitHub Actions**: 정해진 간격마다 공고를 수집해 Cloudflare 저장소(KV)에 넣습니다. (`collector/`)
- **Cloudflare Pages**: 사이트 화면과 API를 제공하고, Cloudflare Access로 본인만 들어갈 수 있게 잠급니다. (`public/`, `functions/`)
- 찜·숨긴 기업·설정은 Cloudflare KV에만 저장됩니다. 이 저장소(공개)에는 코드만 있습니다.

## 처음 설정

### 1. Cloudflare 저장소(KV) 만들기
Cloudflare 대시보드 → **Storage & Databases → Workers KV** → **Create** → 이름 `job-board` → 만든 뒤 **Namespace ID**를 복사해 둡니다.

### 2. Cloudflare Pages 사이트 만들기
1. **Workers & Pages → Create → Pages → Connect to Git** → 이 저장소 선택
2. 빌드 설정: Framework preset **None**, Build command **비움**, Build output directory **`public`** → Save and Deploy
3. 만든 프로젝트 → **Settings → Bindings → Add → KV namespace**
   변수 이름 **`JOBS`**, 네임스페이스 `job-board` 선택 → 저장 후 **Deployments**에서 최신 배포를 **Retry deployment** (바인딩은 다시 배포해야 적용)

### 3. 사이트 잠그기 (Cloudflare Access)
1. Pages 프로젝트 → **Settings → General → Access policy → Enable**
2. **Manage** → Zero Trust 화면에서 이 앱의 **Configure**
   - **Policies**: Action *Allow*, Include **Emails** = 본인 이메일
   - **Overview(도메인)**: 목록의 `*.프로젝트.pages.dev` 처럼 맨 앞이 `*`인 주소의 `*`를 지워 `프로젝트.pages.dev` 자체도 잠기게 저장
     (기본값은 미리보기 주소만 잠그고 실제 주소는 열려 있습니다. 미리보기 주소도 잠그려면 같은 정책으로 `*` 항목을 하나 더 추가)
3. 로그인 방법은 기본값 **One-time PIN**(이메일로 받은 번호 입력)이면 됩니다.
4. (선택, 이중 잠금) Pages → Settings → **Variables and Secrets**에 `ALLOWED_EMAILS` = 본인 이메일 추가 → 다시 배포

### 4. 수집기에 쓸 Cloudflare API 토큰
1. 오른쪽 위 프로필 → **My Profile → API Tokens → Create Token → Custom token**
2. Permissions: **Account → Workers KV Storage → Edit**, Account Resources: 본인 계정 → 만들기 → 토큰 복사
3. **Account ID**: Workers & Pages 첫 화면 오른쪽(또는 대시보드 주소의 숫자·영문 32자리)

### 5. GitHub에 비밀값 넣기
이 저장소 → **Settings → Secrets and variables → Actions → New repository secret** 으로 세 개:

| 이름 | 값 |
|---|---|
| `CF_ACCOUNT_ID` | Cloudflare Account ID |
| `CF_API_TOKEN` | 4번에서 만든 토큰 |
| `KV_NAMESPACE_ID` | 1번 Namespace ID |

그다음 **Actions → collect → Run workflow** 로 첫 수집을 실행합니다 (10~20분).
이후에는 매시 17분에 깨어나서, 사이트 설정의 수집 간격(기본 6시간)이 됐을 때만 수집합니다.

### 6. (선택) "지금 수집" 버튼으로 바로 실행
버튼은 기본적으로 *다음 정기 실행(최대 1시간 안)에 수집*하도록 요청만 남깁니다. 누르는 즉시 시작하게 하려면:
1. GitHub → Settings → Developer settings → **Fine-grained tokens** → 이 저장소만, **Actions: Read and write** 권한으로 생성
2. Cloudflare Pages → Settings → Variables and Secrets: `GH_TOKEN`(Secret) = 그 토큰, `GH_REPO` = `계정/저장소이름` → 다시 배포

## 일부 사이트가 GitHub에서 막힐 때 (집 PC 보조 수집)
GitHub Actions는 해외(미국) 서버에서 실행돼서, 일부 국내 사이트가 접속을 막을 수 있습니다 (사이트 상태줄에 "실패"로 표시).
그럴 때는 항상 켜 두는 집 PC가 그 사이트만 맡게 할 수 있습니다.

1. GitHub 저장소 → Settings → Secrets and variables → Actions → **Variables** 탭 → `SKIP_SOURCES` = 막힌 사이트 (예: `캐치,자소설닷컴,하이브레인넷,클린아이`)
2. 집 PC에 [Node.js LTS](https://nodejs.org) 설치, 이 저장소를 내려받기 (Code → Download ZIP 후 압축 풀기)
3. `home-pc\install.bat` 실행 → 메모장이 열리면 Cloudflare 값 세 개와 `ONLY_SOURCES`(집 PC가 맡을 사이트)를 채우고 저장
4. 끄려면 `home-pc\uninstall.bat`

## 무료 한도
- Cloudflare KV 무료: 하루 쓰기 1,000회 / 읽기 100,000회. 수집 1회에 쓰기 약 12회, 찜·숨기기 1번에 1회라 충분합니다.
- 공개 저장소의 GitHub Actions는 무료이며 시간 제한이 없습니다. 저장소에 60일간 변경이 없으면 예약 실행이 꺼지는데, 수집할 때마다 자동으로 다시 켜 둡니다.

## 파일 구성
- `public/` 화면 (index.html, view.js, view.css) + 공통 로직 (lib.js 목록 해석·묶기, orgs.js 기관 분류, similar.js 찜 일수도)
- `functions/api/[[path]].js` 사이트 API (KV 읽기·쓰기, 원문 중계)
- `collector/` 수집기 (run.js 실행, sites.js 사이트별 수집, kv.js 저장)
- `.github/workflows/collect.yml` 정기 실행
- `home-pc/` 집 PC 보조 수집 (선택)
