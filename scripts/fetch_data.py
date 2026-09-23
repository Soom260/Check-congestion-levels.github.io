"""
서울시 실시간 도시데이터(인구현황) 수집 스크립트

- 환경변수 SEOUL_API_KEY로 인증키를 읽는다 (로컬 테스트 시 .env 파일 사용).
- places.py에 정의된 장소들을 순회하며 citydata_ppltn API를 호출한다.
- 결과는 data/congestion.json 에 저장한다.
- 일부 장소가 실패해도 나머지는 저장하고, 실패한 장소는 이전 데이터를 유지하면서
  status를 "error"로 표시한다 (화면에는 "정보 없음"으로 노출됨).
"""

import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta

# 로컬 실행 시 .env 파일에서 SEOUL_API_KEY를 읽어온다 (배포 환경에서는 Actions Secrets가 대신 주입).
# scripts/ 어디서 실행하든 찾을 수 있도록 프로젝트 루트의 .env를 명시적으로 지정한다.
try:
    from dotenv import load_dotenv

    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
except ImportError:
    pass

from places import PLACES

API_KEY = os.environ.get("SEOUL_API_KEY")
KST = timezone(timedelta(hours=9))
DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "congestion.json")


def now_kst_iso() -> str:
    return datetime.now(KST).isoformat()


def load_previous_data() -> dict:
    """이전 수집 결과를 불러온다. 실패한 장소의 데이터를 유지하는 데 쓴다."""
    if not os.path.exists(DATA_PATH):
        return {"collected_at": None, "places": {}}
    try:
        with open(DATA_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {"collected_at": None, "places": {}}


def fetch_place(area_nm: str) -> dict:
    """장소 하나를 조회해 화면에 필요한 필드만 정리한 dict를 반환한다.
    실패하면 status="error"와 이유를 담아 반환한다 (예외를 던지지 않음)."""
    encoded_name = urllib.parse.quote(area_nm)
    url = f"http://openapi.seoul.go.kr:8088/{API_KEY}/json/citydata_ppltn/1/5/{encoded_name}"

    try:
        with urllib.request.urlopen(url, timeout=10) as res:
            raw = res.read().decode("utf-8")
    except (urllib.error.URLError, TimeoutError) as e:
        return {"status": "error", "error": f"네트워크 오류: {e}"}

    # 인증키가 잘못되면 JSON 요청에도 XML 에러 응답이 온다 (실제 확인됨).
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return {"status": "error", "error": f"응답 파싱 실패(XML/비정상 응답): {raw[:200]}"}

    result_code = payload.get("RESULT", {}).get("RESULT.CODE")
    if result_code and result_code != "INFO-000":
        message = payload.get("RESULT", {}).get("RESULT.MESSAGE", "알 수 없는 오류")
        return {"status": "error", "error": f"{result_code}: {message}"}

    items = payload.get("SeoulRtd.citydata_ppltn")
    if not items:
        return {"status": "error", "error": "SeoulRtd.citydata_ppltn 필드 없음"}

    item = items[0]

    forecast = [
        {
            "time": f.get("FCST_TIME"),
            "level": f.get("FCST_CONGEST_LVL"),
            "population_min": int(f.get("FCST_PPLTN_MIN", 0)),
            "population_max": int(f.get("FCST_PPLTN_MAX", 0)),
        }
        for f in item.get("FCST_PPLTN", [])
    ]

    return {
        "status": "ok",
        "error": None,
        "area_nm": item.get("AREA_NM"),
        "congest_level": item.get("AREA_CONGEST_LVL"),
        "congest_message": item.get("AREA_CONGEST_MSG"),
        "population_min": int(item.get("AREA_PPLTN_MIN", 0)),
        "population_max": int(item.get("AREA_PPLTN_MAX", 0)),
        "updated_at": item.get("PPLTN_TIME"),
        "forecast": forecast,
    }


def main():
    if not API_KEY:
        print("SEOUL_API_KEY 환경변수가 설정되지 않았습니다.", file=sys.stderr)
        sys.exit(1)

    previous = load_previous_data()
    places_result = {}
    success_count = 0

    for area_nm in PLACES:
        result = fetch_place(area_nm)

        if result["status"] == "ok":
            success_count += 1
            places_result[area_nm] = result
            print(f"성공: {area_nm} ({result['congest_level']})")
        else:
            # 실패 시 이전 데이터가 있으면 유지하고 실패 표시만 남긴다.
            prev_entry = previous.get("places", {}).get(area_nm)
            if prev_entry:
                prev_entry = dict(prev_entry)
                prev_entry["status"] = "error"
                prev_entry["error"] = result["error"]
                places_result[area_nm] = prev_entry
            else:
                places_result[area_nm] = {
                    "status": "error",
                    "error": result["error"],
                    "area_nm": area_nm,
                }
            print(f"실패: {area_nm} - {result['error']}")

    output = {
        "collected_at": now_kst_iso(),
        "places": places_result,
    }

    os.makedirs(os.path.dirname(DATA_PATH), exist_ok=True)
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n총 {len(PLACES)}곳 중 {success_count}곳 성공. {DATA_PATH} 저장 완료.")


if __name__ == "__main__":
    main()
