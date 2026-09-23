# 지금 어디가 한산해?

서울시 "실시간 도시데이터" 오픈 API로 약속 장소 후보지들의 현재 혼잡도를 비교해 주는 웹서비스입니다.
후보지를 3~5곳 고르면 각 장소의 혼잡도를 카드로 보여주고, 가장 한산한 곳을 추천합니다.

## 아키텍처

GitHub Pages는 정적 호스팅이라 서버 코드를 실행할 수 없고, 서울시 API는 http라서 https 페이지에서
브라우저가 직접 호출하면 차단됩니다. 그래서 브라우저는 서울시 API를 직접 호출하지 않습니다.

```
GitHub Actions (30분마다 자동 실행)
  → scripts/fetch_data.py 가 서울시 API 호출 (인증키는 Secrets에서 주입)
  → data/congestion.json 에 결과 저장 후 저장소에 커밋·푸시
  → GitHub Pages가 저장소 내용을 그대로 정적 서빙
  → 브라우저(app.js)는 data/congestion.json 만 fetch
```

인증키는 GitHub Secrets에만 저장되고, 프론트엔드 코드나 저장소 파일에는 절대 들어가지 않습니다.

## 폴더 구조

```
seoul-congestion/
├── .github/workflows/update.yml   # 주기적 데이터 수집 Actions
├── scripts/
│   ├── fetch_data.py              # 서울시 API 수집 스크립트
│   └── places.py                  # 수집 대상 장소 20곳 목록
├── data/congestion.json           # 수집 결과 (Actions가 자동 갱신)
├── index.html / style.css / app.js
├── requirements.txt
└── .env.example
```

## 로컬에서 실행하기

1. 서울 열린데이터광장(data.seoul.go.kr)에서 인증키를 발급받습니다.
2. `.env.example`을 복사해 `.env`를 만들고 키를 입력합니다.
   ```
   cp .env.example .env
   ```
3. 의존성 설치 후 수집 스크립트를 실행합니다.
   ```
   pip install -r requirements.txt
   python scripts/fetch_data.py
   ```
   `data/congestion.json`이 생성/갱신됩니다.
4. 프론트엔드는 정적 파일이라 로컬 서버로 열면 됩니다.
   ```
   python -m http.server 8000
   ```
   브라우저에서 `http://localhost:8000` 접속.

## GitHub에 배포하기

### 1. Secrets 등록

1. GitHub 저장소 페이지에서 **Settings → Secrets and variables → Actions** 로 이동합니다.
2. **New repository secret** 클릭.
3. Name: `SEOUL_API_KEY`, Value: 발급받은 인증키 입력 후 저장합니다.

### 2. GitHub Pages 활성화

1. **Settings → Pages** 로 이동합니다.
2. **Source**를 **Deploy from a branch**로 선택합니다.
3. Branch를 `main`, 폴더를 `/ (root)`로 선택하고 저장합니다.
4. 잠시 후 `https://<사용자명>.github.io/<저장소명>/` 주소로 접속하면 사이트가 보입니다.

### 3. 워크플로 수동 실행

Actions는 30분마다 자동 실행되지만, 최초 배포 직후나 시연 직전에는 수동으로 즉시 실행할 수 있습니다.

1. 저장소의 **Actions** 탭으로 이동합니다.
2. 왼쪽 목록에서 **혼잡도 데이터 갱신** 워크플로를 클릭합니다.
3. 오른쪽의 **Run workflow** 버튼 → **Run workflow**를 클릭합니다.
4. 실행이 끝나면(초록 체크) `data/congestion.json`이 자동으로 커밋되고, Pages에도 곧 반영됩니다.

> GitHub Actions의 cron 스케줄은 정확한 시각에 실행되지 않고 지연될 수 있습니다. 화면 하단에
> "○분 전 갱신"으로 표시되는 이유입니다.

## 주요 화면 기능

- **지도**: 페이지 상단에 Leaflet(OpenStreetMap 타일) 지도를 띄워 선택한 후보지 위치를 혼잡도 색상과 같은 색 마커로 보여줍니다. API 키가 필요 없는 무료 지도라서 별도 설정 없이 동작합니다. 장소 좌표는 `app.js`의 `PLACE_COORDS`에 고정값으로 들어있습니다.
- **장소 검색/추가**: 상단 검색창에 입력하면 수집 대상 20곳 중 일치하는 곳을 보여주고, 클릭하면
  후보지로 추가됩니다(최대 5곳). 선택한 후보지는 브라우저 `localStorage`에 저장되어 다음 방문 때도 유지됩니다.
- **혼잡도 카드**: 장소명, 혼잡도 단계(색상), 추정 인구, 해당 장소의 갱신 시각을 보여줍니다.
- **추천 배너**: 후보지 중 혼잡도가 가장 낮은 곳을 "지금은 ○○이 가장 한산해요"로 안내합니다.
- **12시간 예측 그래프**: 선택한 후보지에 예측 데이터가 있으면 Chart.js로 그래프를 그립니다.
- 페이지를 열어 둔 상태에서도 1분마다 `data/congestion.json`을 다시 불러와 화면을 갱신합니다.

## 장소 목록 변경하기

`scripts/places.py`의 `PLACES` 리스트를 수정하면 됩니다. 단, 값은 서울시 실시간 도시데이터의
공식 지역명(`AREA_NM`)과 정확히 일치해야 합니다. 목록에 없는 이름을 넣으면 해당 장소만 수집에
실패합니다.
