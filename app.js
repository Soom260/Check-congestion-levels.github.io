// ── 상수 ──────────────────────────────────────────────
const DATA_URL = "data/congestion.json";
const REFRESH_INTERVAL_MS = 60 * 1000; // 페이지를 열어둔 동안 1분마다 새로고침
const STORAGE_KEY = "selectedPlaces";
const MAX_CANDIDATES = 5;

// 혼잡도 단계를 숫자로 바꿔서 비교(정렬/추천)에 쓴다. 값이 작을수록 한산하다.
const LEVEL_ORDER = { "여유": 0, "보통": 1, "약간 붐빔": 2, "붐빔": 3 };

// 카드 배지와 같은 색을 지도 마커에도 써서 한눈에 매칭되게 한다.
const LEVEL_COLOR = {
  "여유": "#2fb872",
  "보통": "#4d90fe",
  "약간 붐빔": "#f5a623",
  "붐빔": "#e5484d",
};
const LEVEL_COLOR_UNKNOWN = "#9aa0ab";

// 서울시 API 응답에는 좌표가 없어서 지도 표시용 위경도를 직접 넣어둔다 (장소 20곳 고정).
const PLACE_COORDS = {
  "강남역": [37.4979, 127.0276],
  "홍대입구역(2호선)": [37.5563, 126.9236],
  "이태원 관광특구": [37.5344, 126.9946],
  "명동 관광특구": [37.5636, 126.9834],
  "성수카페거리": [37.5446, 127.0559],
  "여의도한강공원": [37.5285, 126.9335],
  "잠실역": [37.5133, 127.1001],
  "잠실롯데타워·석촌호수": [37.5125, 127.1025],
  "압구정로데오거리": [37.5273, 127.0402],
  "건대입구역": [37.5403, 127.0699],
  "신촌·이대역": [37.5599, 126.9425],
  "종로·청계 관광특구": [37.5703, 126.9910],
  "광화문·덕수궁": [37.5759, 126.9769],
  "동대문 관광특구": [37.5709, 127.0095],
  "인사동": [37.5744, 126.9856],
  "익선동": [37.5730, 126.9910],
  "연남동": [37.5629, 126.9254],
  "서울숲공원": [37.5443, 127.0374],
  "가로수길": [37.5202, 127.0229],
  "청담동 명품거리": [37.5245, 127.0473],
};
const SEOUL_CENTER = [37.5665, 126.9780];

// ── 상태 ──────────────────────────────────────────────
let congestionData = null; // 마지막으로 불러온 data/congestion.json 전체
let selectedPlaces = loadSelectedPlaces();
let chart = null;
let leafletMap = null;
let mapMarkers = {}; // 장소명 -> L.marker

// ── localStorage ──────────────────────────────────────
function loadSelectedPlaces() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSelectedPlaces() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedPlaces));
}

// ── 데이터 로딩 ────────────────────────────────────────
async function loadCongestionData() {
  // 캐시 때문에 옛 데이터가 보이지 않도록 쿼리스트링에 현재 시각을 붙인다.
  const res = await fetch(`${DATA_URL}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`데이터를 불러오지 못했습니다 (${res.status})`);
  congestionData = await res.json();
  renderAll();
}

// ── 렌더링 ────────────────────────────────────────────
function renderAll() {
  renderSearchAvailability();
  renderCards();
  renderRecommendBanner();
  renderFooter();
  renderChart();
  renderMap();
}

function levelClass(level) {
  // CSS 클래스명에는 공백이 못 들어가므로 "약간 붐빔" → "약간-붐빔"으로 변환
  if (!level || !(level in LEVEL_ORDER)) return "알수없음";
  return level.replace(" ", "-");
}

function renderSearchAvailability() {
  const input = document.getElementById("place-search");
  input.disabled = selectedPlaces.length >= MAX_CANDIDATES;
  input.placeholder =
    selectedPlaces.length >= MAX_CANDIDATES
      ? `최대 ${MAX_CANDIDATES}곳까지 선택할 수 있어요`
      : "예: 강남역, 홍대, 성수...";
}

function renderCards() {
  const container = document.getElementById("cards-container");
  const emptyMessage = document.getElementById("empty-message");
  container.innerHTML = "";

  if (selectedPlaces.length === 0) {
    emptyMessage.style.display = "block";
    return;
  }
  emptyMessage.style.display = "none";

  const places = congestionData?.places || {};
  const mostRelaxedName = findMostRelaxedPlace();

  for (const name of selectedPlaces) {
    const info = places[name];
    container.appendChild(buildCard(name, info, name === mostRelaxedName));
  }
}

function buildCard(name, info, isRecommended) {
  const card = document.createElement("div");
  const cls = levelClass(info?.status === "ok" ? info.congest_level : null);
  card.className = `card level-${cls}${isRecommended ? " recommended" : ""}`;

  const header = document.createElement("div");
  header.className = "card-header";

  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = name;
  if (isRecommended) {
    const crown = document.createElement("span");
    crown.className = "card-crown";
    crown.textContent = "👑 추천";
    title.appendChild(crown);
  }

  const removeBtn = document.createElement("button");
  removeBtn.className = "card-remove";
  removeBtn.textContent = "✕";
  removeBtn.setAttribute("aria-label", `${name} 후보지에서 삭제`);
  removeBtn.onclick = () => removePlace(name);

  header.appendChild(title);
  header.appendChild(removeBtn);
  card.appendChild(header);

  if (!info || info.status !== "ok") {
    const badge = document.createElement("span");
    badge.className = "card-badge level-알수없음";
    badge.textContent = "정보 없음";
    card.appendChild(badge);

    const err = document.createElement("p");
    err.className = "card-error";
    err.textContent = info?.congest_level
      ? `최근 수집 실패 (이전 데이터: ${info.congest_level})`
      : "아직 수집된 데이터가 없어요";
    card.appendChild(err);
    return card;
  }

  const badge = document.createElement("span");
  badge.className = `card-badge level-${cls}`;
  badge.textContent = info.congest_level;
  card.appendChild(badge);

  const population = document.createElement("p");
  population.className = "card-population";
  population.textContent = `추정 인구 ${info.population_min.toLocaleString()} ~ ${info.population_max.toLocaleString()}명`;
  card.appendChild(population);

  const updated = document.createElement("p");
  updated.className = "card-updated";
  updated.textContent = `이 장소 갱신: ${info.updated_at ?? "-"}`;
  card.appendChild(updated);

  if (info.status === "error") {
    const err = document.createElement("p");
    err.className = "card-error";
    err.textContent = `⚠ 최신 수집 실패: ${info.error}`;
    card.appendChild(err);
  }

  return card;
}

// 선택된 후보지 중 혼잡도가 가장 낮은(=가장 한산한) 곳을 찾는다.
// 혼잡도가 같으면 추정 인구 평균이 더 적은 쪽을 우선한다.
function findMostRelaxedPlace() {
  const places = congestionData?.places || {};
  let best = null;
  let bestScore = null;

  for (const name of selectedPlaces) {
    const info = places[name];
    if (!info || info.status !== "ok" || !(info.congest_level in LEVEL_ORDER)) continue;

    const avgPop = (info.population_min + info.population_max) / 2;
    const score = LEVEL_ORDER[info.congest_level] * 1e8 + avgPop;

    if (bestScore === null || score < bestScore) {
      bestScore = score;
      best = name;
    }
  }
  return best;
}

function renderRecommendBanner() {
  const text = document.getElementById("recommend-text");
  if (selectedPlaces.length === 0) {
    text.textContent = "후보지를 추가해 보세요";
    return;
  }
  const best = findMostRelaxedPlace();
  text.textContent = best
    ? `지금은 ${best}이(가) 가장 한산해요`
    : "아직 혼잡도 정보를 불러오는 중이에요";
}

function renderFooter() {
  const el = document.getElementById("last-updated");
  const collectedAt = congestionData?.collected_at;
  if (!collectedAt) {
    el.textContent = "데이터 수집 시각을 확인할 수 없어요";
    return;
  }
  const minutesAgo = Math.max(0, Math.round((Date.now() - new Date(collectedAt).getTime()) / 60000));
  el.textContent = `전체 데이터 ${minutesAgo}분 전 갱신 (Actions 실행 주기에 따라 지연될 수 있어요)`;
}

function renderChart() {
  const section = document.getElementById("chart-section");
  const places = congestionData?.places || {};
  const withForecast = selectedPlaces.filter((n) => places[n]?.status === "ok" && places[n]?.forecast?.length);

  // Chart.js CDN 로드가 실패해도(네트워크 문제 등) 나머지 화면은 정상 동작해야 한다.
  if (typeof Chart === "undefined" || withForecast.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  // 후보지 중 하나라도 forecast 시간대가 있으면 그걸 x축 라벨로 쓴다 (모두 동일한 시간대를 제공함).
  const labels = places[withForecast[0]].forecast.map((f) => f.time.slice(11, 16));

  const palette = ["#5b5fef", "#2fb872", "#e5484d", "#f5a623", "#4d90fe"];
  const datasets = withForecast.map((name, i) => ({
    label: name,
    data: places[name].forecast.map((f) => (f.population_min + f.population_max) / 2),
    borderColor: palette[i % palette.length],
    backgroundColor: palette[i % palette.length],
    tension: 0.3,
  }));

  const ctx = document.getElementById("forecast-chart");
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: { legend: { position: "bottom" } },
      scales: { y: { title: { display: true, text: "추정 인구(명)" } } },
    },
  });
}

// ── 지도 ──────────────────────────────────────────────
function initMap() {
  // Leaflet CDN 로드가 실패해도(네트워크 문제 등) 나머지 화면은 정상 동작해야 한다.
  if (typeof L === "undefined") return;
  leafletMap = L.map("map").setView(SEOUL_CENTER, 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(leafletMap);
}

function renderMap() {
  if (!leafletMap) return;

  const places = congestionData?.places || {};

  // 더 이상 선택되지 않은 장소의 마커는 지운다.
  for (const name of Object.keys(mapMarkers)) {
    if (!selectedPlaces.includes(name)) {
      leafletMap.removeLayer(mapMarkers[name]);
      delete mapMarkers[name];
    }
  }

  for (const name of selectedPlaces) {
    const coords = PLACE_COORDS[name];
    if (!coords) continue;

    const info = places[name];
    const level = info?.status === "ok" ? info.congest_level : null;
    const color = LEVEL_COLOR[level] || LEVEL_COLOR_UNKNOWN;
    const popupText = level ? `${name} · ${level}` : `${name} · 정보 없음`;

    if (mapMarkers[name]) {
      mapMarkers[name].setStyle({ color, fillColor: color });
      mapMarkers[name].setPopupContent(popupText);
    } else {
      mapMarkers[name] = L.circleMarker(coords, {
        radius: 10,
        color,
        fillColor: color,
        fillOpacity: 0.9,
        weight: 2,
      })
        .addTo(leafletMap)
        .bindPopup(popupText);
    }
  }

  const activeCoords = selectedPlaces.map((name) => PLACE_COORDS[name]).filter(Boolean);
  if (activeCoords.length > 0) {
    leafletMap.fitBounds(activeCoords, { padding: [40, 40], maxZoom: 15 });
  } else {
    leafletMap.setView(SEOUL_CENTER, 11);
  }
}

// ── 장소 검색/추가/삭제 ────────────────────────────────
function renderSearchResults(query) {
  const resultsEl = document.getElementById("search-results");
  resultsEl.innerHTML = "";
  if (!query) return;

  const allPlaces = Object.keys(congestionData?.places || {});
  const matches = allPlaces
    .filter((name) => !selectedPlaces.includes(name))
    .filter((name) => name.includes(query))
    .slice(0, 8);

  for (const name of matches) {
    const item = document.createElement("div");
    item.className = "search-result-item";
    item.textContent = name;
    item.onclick = () => addPlace(name);
    resultsEl.appendChild(item);
  }
}

function addPlace(name) {
  if (selectedPlaces.includes(name) || selectedPlaces.length >= MAX_CANDIDATES) return;
  selectedPlaces.push(name);
  saveSelectedPlaces();

  const input = document.getElementById("place-search");
  input.value = "";
  document.getElementById("search-results").innerHTML = "";

  renderAll();
}

function removePlace(name) {
  selectedPlaces = selectedPlaces.filter((n) => n !== name);
  saveSelectedPlaces();
  renderAll();
}

// ── 초기화 ────────────────────────────────────────────
initMap();

document.getElementById("place-search").addEventListener("input", (e) => {
  renderSearchResults(e.target.value.trim());
});

document.addEventListener("click", (e) => {
  const searchSection = document.querySelector(".search-section");
  if (!searchSection.contains(e.target)) {
    document.getElementById("search-results").innerHTML = "";
  }
});

loadCongestionData().catch((err) => {
  document.getElementById("last-updated").textContent = `오류: ${err.message}`;
});

setInterval(() => {
  loadCongestionData().catch(() => {
    // 새로고침 실패는 조용히 무시하고 다음 주기에 다시 시도한다.
  });
}, REFRESH_INTERVAL_MS);
