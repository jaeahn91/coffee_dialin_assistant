# AI Coffee Dial-in Assistant

스페셜티 로스터의 고객(홈카페 유저)이 QR로 접속해 추천 레시피를 받고, 맛 피드백을 입력하면 다음 추출 레시피를 조정해주는 서비스. 쌓이는 원두-레시피-피드백 데이터는 로스터에게 돌려준다.

> 핵심 가설: **피드백 한 번이 실제로 다음 잔을 더 낫게 만든다.**

## 현재 상태

기획(PRD) 단계. 코드 없음.

- 최신 PRD: [docs/PRD_coffee_dialin_assistant_v0.2.md](docs/PRD_coffee_dialin_assistant_v0.2.md)
- 이전 버전: [docs/PRD_coffee_dialin_assistant_v0.1.md](docs/PRD_coffee_dialin_assistant_v0.1.md)

## 저장소 구조

```
docs/    # PRD 및 설계 문서 (버전별 파일 보존)
```

코드 작업이 시작되면 `src/` 등을 추가한다. 구조는 필요해질 때 바꾼다.

## 문서 규칙

- PRD는 버전별로 새 파일을 만들어 이전 버전을 보존한다 (`_vX.Y.md`).
- 미결정 항목은 문서 내 `[미결정]` 표기 + 부록의 미결정 목록으로 관리한다.
