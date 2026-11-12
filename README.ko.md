# JOONS MCP Report Hub

MCP 진단 및 테스트 결과를 통합 리포트, 대시보드, CI 배지로 만듭니다.

![Status: Preview](https://img.shields.io/badge/status-Preview-orange)
![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)
![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D%2020-green)
![CI](https://github.com/dbdefault/joons-mcp-report-hub/actions/workflows/ci.yml/badge.svg)

JOONS MCP Report Hub는 [JOONS 생태계](https://github.com/dbdefault/joons-ecosystem)의
MCP 진단 도구 — Probe, Diff, Policy Gate, Mock Server, Contract Test Runner — 가 만드는
JSON 리포트를 읽어, 하나로 정규화된 요약과 자급자족형 오프라인 HTML 대시보드,
README와 CI용 SVG 배지를 만들어 줍니다.

다른 제품들이 설치되어 있을 필요도 없고, **MCP 서버에 접속하지도 않으며, 도구나 다른
프로그램을 실행하지도 않고, 어떤 네트워크 요청도 하지 않습니다.** 지정한 JSON 파일만
읽고 자신의 출력 파일만 씁니다.

[JOONS 생태계](https://github.com/dbdefault/joons-ecosystem)의 일부입니다.

## 왜 필요한가

JOONS 제품 각각은 서로 다른 질문에 답하고 서로 다른 JSON 방언을 씁니다.

- **Probe** — 특정 시점의 하나의 실제 MCP 서버 상태 (PASS / WARNING / FAIL).
- **Diff** — 두 스냅숏 사이의 변경 위험도 (BREAKING / NON_BREAKING / UNKNOWN).
- **Policy Gate** — 기록된 하나의 스냅숏에 대한 정책 준수 여부 (PASS / WARN / FAIL).
- **Mock Server** — 목 서버이며, `--report`는 *호출 녹음*이지 테스트 결과가 아닙니다.
- **Contract Test Runner** — 목에 대한 행위 테스트 결과 (테스트별 PASS / FAIL).

Report Hub는 이 전부를 한곳에서 볼 수 있게 해 줍니다. 전체 최종 판정, 제품별 상태,
테스트 성공률, 대시보드, 배지까지 — 다섯 제품의 의미를 섞지 않으면서, 리포트 내용이
대시보드로 새어 나가지 않으면서 말입니다.

## 안전을 먼저

리포트 내용은 **신뢰할 수 없는 입력**으로 취급합니다.

- **기본 출력은 허용 목록(allowlist)입니다.** Report Hub 자신의 고정 어휘, 알려진 집합에서
  온 열거 토큰(알 수 없는 토큰은 `unknown`이 됨), 검증된 숫자, 제품 버전 문자열, 검증된
  타임스탬프, 익명 출처 레이블(`report-<n>` + SHA-256 접두사)만 출력에 도달할 수 있습니다.
  도구 이름, 서버 이름, 메시지, 라벨, 경로, URL, 명령줄, 인자, stderr, 오류 텍스트는
  기본 모드에서 **버려집니다**.
- **`--details`** (명시적 옵트인)는 추가로 finding당 짧은 자유 텍스트를 허용합니다. 단,
  제어 문자 제거, 고정 정규식 기반 낙서 제거(URL, 경로, 이메일, IP, Bearer/JWT 등의
  비밀값), 200자 잘라내기를 거친 뒤이며, 출력에는 "details: may contain internal names"
  표시가 붙습니다.
- **`--show-file-names`** (명시적 옵트인)는 입력 파일의 기본 이름(디렉터리는 절대 아님)을
  같은 정제를 거쳐 보여 줍니다. 기본값은 `report-<n>` + 해시뿐입니다.
- **낙서(redaction)**는 양자화 상한이 있는 고정 정규식 세트를 씁니다. 사용자 입력이
  `RegExp`, 명령, 경로, URL이 되는 일은 없습니다.
- **네트워크 없음.** 대시보드는 CDN, 폰트, 이미지, 링크, fetch/XHR, 폼 같은 외부 리소스를
  전혀 참조하지 않고, 외부 것은 아무것도 허용하지 않는 Content-Security-Policy를 달고
  있으며, 리포트 데이터는 이스케이프된 텍스트로만 넣습니다 — 스크립트 안에 JSON으로
  심어 넣는 일은 없습니다.
- **프로토타입 오염 방지.** 리포트 데이터로 만드는 맵은 `Map` 또는
  `Object.create(null)`을 사용하고, 필드는 `hasOwn`과 일반 객체 검사로만 읽습니다.

필드별 정확한 개인정보 보호 모형은 [docs/PRIVACY.md](docs/PRIVACY.md)를, 위협 모형은
[SECURITY.md](SECURITY.md)를 참고하세요.

## 빠른 시작

Node.js >= 20이 필요합니다. 런타임 의존성이 전혀 없어, 패키지 자체 외에 설치할 것이
없습니다.

```bash
npm install -g github:dbdefault/joons-mcp-report-hub#v0.1.0
```

다른 JOONS 제품으로 리포트를 만듭니다(각 제품별 예시 명령 하나씩. Report Hub는 이 명령들이
쓰는 파일만 읽습니다):

```bash
# Probe: 하나의 실제 MCP 서버 상태
joons-mcp-probe stdio --format json --json-out probe.json -- node server.js

# Diff: 두 스냅숏 사이의 변경 위험도
joons-mcp-diff compare before.json after.json --format json --json-out diff.json

# Policy Gate: 하나의 스냅숏에 대한 정책 준수
joons-mcp-policy-gate check snapshot.json --policy policy.json --format json --json-out policy.json

# Contract Test Runner: 목에 대한 행위 테스트
joons-mcp-contract-test run suite.json --snapshot snapshot.json --fixtures fixtures.json --format json --json-out contract.json

# Mock Server: 목 세션 녹음 (--report는 호출 녹음이지 테스트 결과가 아님)
joons-mcp-mock-server start --snapshot snapshot.json --report mock.json
```

그리고 이것들을 대시보드, 요약, 배지, 검증으로 바꿉니다:

```bash
# 자급자족형 오프라인 대시보드 + summary.json/md + badges/
joons-mcp-report-hub build probe.json diff.json policy.json contract.json mock.json --out dashboard

# 터미널 요약 (--format json | markdown, --out FILE도 가능)
joons-mcp-report-hub summary probe.json diff.json

# SVG 배지만
joons-mcp-report-hub badge . --out badges

# 이 입력들을 쓸 수 있는가? (종료 코드 0 = 전부 사용 가능, 무시된 스냅숏과 중복은 허용)
joons-mcp-report-hub validate reports/
```

바로 써 볼 수 있는 입력 세트는 [examples/reports](examples/reports)에 있고,
정확한 명령과 기대 결과는 [examples/README.md](examples/README.md)에 적어 두었습니다.

## 지원하는 리포트 유형

모든 형식은 현재 `schemaVersion: 1`입니다.

| 입력 | 제품 | 감지 방법 | 정규화된 유형 |
| --- | --- | --- | --- |
| Probe 리포트 | probe | `format` 키 없음; `schemaVersion === 1`, `tool.name === "joons-mcp-probe"`, `status`와 `target` 보유 | `probe_report` |
| `joons-mcp-diff/result` | diff | `format` 문자열 | `diff_result` |
| `joons-mcp-policy-gate/result` | policy-gate | `format` 문자열 | `policy_check` |
| `joons-mcp-mock-server/report` | mock-server | `format` 문자열 | `mock_session` — 호출 **녹음**. 판정이 없으며 절대 테스트 결과가 아님 |
| `joons-mcp-contract-test/report` | contract-runner | `format` 문자열 | `contract_run` |
| `joons-mcp-policy-gate/policy-validation`, `joons-mcp-mock-server/validation`, `joons-mcp-contract-test/validation` | policy-gate / mock-server / contract-runner | `format` 문자열 | `validation` |

리포트로 인식하지만 **대상이 아닌 것**: `joons-mcp-diff/snapshot` 파일은 `ignored_input`으로
목록에 올라가며 오류가 아닙니다 — 그 파일들은 다른 제품들의 *입력*이지 결과가 아닙니다.
그 외는 문제로 분류됩니다(`unknown_format`), 알려진 형식인데 `schemaVersion !== 1`이면
`unsupported_version`입니다. 무엇을 읽고 어떻게 상태/레벨에 매핑하고 무엇을 버리는지는
[docs/REPORTS.md](docs/REPORTS.md)를 참고하세요.

Guard와 Allocator 리포트는 0.1.0에서 **지원하지 않습니다**(아직 안정된 리포트 형식이
없습니다).

## 상태 의미 — 여섯 종류, 절대 섞이지 않음

모든 상태는 **종류(kind)**와 함께 다니며, 렌더러는 값 옆에 종류 라벨을 항상 보여 줍니다.

| 종류 | 라벨 | 제품 | 값 |
| --- | --- | --- | --- |
| `health` | Server health | probe | `PASS` / `WARNING` / `FAIL` |
| `change_risk` | Change risk | diff | `none` / `low` / `unknown` / `high` (`summary.risk`에서) |
| `policy` | Policy compliance | policy-gate | `PASS` / `WARN` / `FAIL` |
| `tests` | Test results | contract-runner | `PASS` / `FAIL` |
| `recording` | Mock recording | mock-server | `RECORDED` — 항상 info 수준이며 절대 초록색이나 빨간색이 아님 |
| `validation` | Input validation | policy-gate, mock-server, contract-runner | `VALID` / `VALID_WITH_WARNINGS` / `INVALID` |

레벨은 `ok` > `warning` > `failure`이고, 여기에 `info`(목 녹음)와 `none`(리포트 없음)이
있습니다. 목 녹음은 어떤 것도 초록색이나 빨간색으로 바꾸지 않고, diff의 `unknown` 위험은
실패가 아니라 *경고*입니다 — 이 의미들은 절대 섞이지 않습니다.

## 전체 최종 판정

정확한 규칙은 다음과 같습니다:

1. `failure` 레벨 리포트가 하나라도 있으면 → **FAIL** (`failing_report`).
2. 그렇지 않고 `warning` 레벨 리포트가 있거나, 거부/미지원 입력 파일이 있으면
   (`duplicate`/`ignored_input` 외의 어떤 문제라도) → **WARN** (`warning_report`
   및/또는 `input_problem`). 거부된 입력이 있으면 절대 PASS가 될 수 없습니다.
3. 그렇지 않고 `ok`/`warning`/`failure` 레벨 리포트가 하나도 없으면(목 녹음뿐이거나 받아들인
   것이 없으면) → **NO_DATA** (`no_verdict_reports`).
4. 나머지 경우 **PASS**.

info 수준의 목 녹음은 판정에 영향을 주지 않습니다.

## 대시보드

`build`가 정적 `index.html` 하나를 씁니다.

- 헤더에는 전체 배지, 생성 시각(`--stable`이면 "not recorded"), 모드 안내(`--details`
  사용 시 경고 문구 포함)가 있습니다.
- 전체 판정 이유가 있는 overall 카드, 다섯 제품 전부의 제품 카드(리포트가 없으면
  "no reports" 상태), 실패 항목을 먼저(실패, 그다음 경고) 보여 주는 목록.
- 테스트 성공률, 리포트별 표(id, 제품, 상태 종류 + 값, 타임스탬프 또는 "not available",
  소요 시간), 리포트별 `<details>`(건수와 findings).
- 문제 목록("unsupported or rejected inputs")과 "missing information" 목록.
- 판정 집계 방식을 설명하는 링크 없는 푸터.

페이지는 완전히 오프라인(외부 리소스 전혀 없음)이고, 유일한 인라인 `<style>`과
`<script>`의 실제 SHA-256 해시를 담은 `Content-Security-Policy` 메타 태그를 달고 있으며,
리포트 데이터는 이스케이프된 텍스트로만 넣습니다(스크립트 안의 JSON은 절대 아님).
스크립트를 꺼도 전부 보이고, 360px까지 반응형이며, `prefers-color-scheme: dark`를
지원하고, 시맨틱 랜드마크를 쓰며, 색만으로 상태를 표시하지 않습니다.

## 배지

`badge`(또는 `build`)가 고정 템플릿의 SVG 배지를 씁니다. 동적 텍스트는 고정 어휘나
숫자뿐이고 모두 이스케이프되며, `role="img"`와 `<title>`이 있고 스크립트나 외부 참조,
이벤트 핸들러는 없습니다.

| 배지 파일 | 라벨 | 값 | 색 |
| --- | --- | --- | --- |
| `badges/overall.svg` | `MCP reports` | 전체 상태: `PASS` / `WARN` / `FAIL` / `NO DATA` | 전체 레벨에 따라 |
| `badges/probe.svg` | `MCP Probe` | 최악의 상태: `PASS` / `WARNING` / `FAIL` | 최악의 레벨에 따라 |
| `badges/diff.svg` | `MCP Diff` | 최악의 위험: `BREAKING` / `UNKNOWN` / `NON-BREAKING` / `NO CHANGES` | 최악의 위험 레벨에 따라 |
| `badges/policy-gate.svg` | `Policy Gate` | `PASS` / `WARN` / `FAIL` | 최악의 레벨에 따라 |
| `badges/mock-server.svg` | `Mock Server` | `<calls> calls` | 항상 info 회색 — 절대 초록/빨강 아님 |
| `badges/contract-runner.svg` | `Contract Tests` | `<percent>% PASS`, 테스트 없으면 `NO TESTS` | 실패한 실행이 있으면 빨강, 아니면 초록 |

배지의 값은 언제나 `summary.json`에서 도출할 수 있고 그것과 일치합니다.

GitHub Actions 예시 — 대시보드를 만들고 배지와 함께 아티팩트로 올립니다:

```yaml
- name: Build MCP report dashboard
  run: node path/to/joons-mcp-report-hub/bin/joons-mcp-report-hub.js build reports/ --out dashboard-out --stable

- name: Upload dashboard and badges
  uses: actions/upload-artifact@v4
  with:
    name: mcp-report-hub
    path: dashboard-out
```

(`--stable`이면 출력이 실행마다 바이트 단위로 동일해서 아티팩트가 재현 가능합니다.)

## 종료 코드

| 코드 | 의미 |
| --- | --- |
| `0` | 전체 PASS, 또는 받아들인 리포트가 1개 이상인 NO_DATA, 또는 `--fail-on none`이면 어떤 결과든 |
| `1` | 전체 FAIL, 또는 `--fail-on warning`일 때 WARN |
| `2` | 받아들인 리포트가 전혀 없음; 또는 `--strict`일 때 입력 문제 있음; 또는 입력 인자가 잘못됨 |
| `3` | 사용법 오류 (알 수 없는 명령/옵션, 값 누락 등) |
| `4` | 출력 오류 (출력 디렉터리가 거부되었거나 쓰기 실패) |

`validate`: 모든 입력을 쓸 수 있으면 `0`(중복과 무시된 스냅숏은 허용), 아니면 `2`,
사용법 오류는 `3`. NO_DATA와 WARN은 기본으로 실패하지 않습니다.

## 한계

가능하면 파싱 전에 강제합니다: 파일당 8 MiB(stat 먼저), 전체 64 MiB, 파일 500개,
JSON 깊이 64, 노드 500,000개, 문자열이나 키는 코드 단위로 100,000자 이하(초과 시
`limit_exceeded`), 유지하는 리포트 엔트리는 500개 이하. 잘못된 UTF-8은 치명적 디코딩
오류이고, BOM 하나는 제거하며, JSON 파싱 오류는 `line:column`만 담습니다 — 내용도 경로도
절대 담지 않습니다.

## 개인정보 보호 모형

- **기본 모드**: 리포트에서 나온 것은 [docs/PRIVACY.md](docs/PRIVACY.md)에 적힌 허용
  목록 — 고정 어휘, 알려진 집합의 토큰, 검증된 숫자, 검증된 버전과 타임스탬프,
  `report-<n>` + SHA-256 접두사 레이블 — 외에는 출력에 도달하지 않습니다.
- **`--details`**: finding별로 낙서된, 제어 문자가 제거된, 200자로 제한된 자유 텍스트를
  추가하고, 그에 따라 출력에 표시를 합니다.
- **`--show-file-names`**: 정제된 기본 파일 이름을 추가합니다.
- 리포트 데이터는 어디로도 본내지 않고, 실행되거나 평가되거나, 정규식·명령·경로·URL의
  재료가 되지도 않습니다.

## 0.1.0에는 없는 것

- Guard와 Allocator 리포트(아직 안정된 리포트 형식이 없음).
- npm 레지스트리 배포 — GitHub에서 설치하세요(빠른 시작 참고).
- 재귀적 디렉터리 입력 (디렉터리 입력은 직속 `*.json` 자식만 읽습니다).

## 상태

**Preview.** 0.1.0은 첫 공개 릴리스입니다. 리포트 입력 형식과 요약/대시보드 출력 형식은
1.0 전에 바뀔 수 있습니다. 이 패키지는 npm에 게시되어 있지 않습니다.
