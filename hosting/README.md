# sadoloverme.xyz 웹호스팅 배포 준비

이 폴더는 HostingKorea cPanel 웹호스팅에 올릴 공개 파일만 포함합니다. Client Secret, Access Token, Refresh Token, Steam API 키, Wheel of Names API 키는 절대로 업로드하지 않습니다.

## 권장 역할

- `https://sadoloverme.xyz/`: 프로젝트 안내 및 GitHub Release 연결
- `https://sadoloverme.xyz/health.json`: 도메인·SSL·정적 파일 확인
- `https://sadoloverme.xyz/chzzk/callback/`: 선택적으로 사용할 치지직 OAuth 콜백 중계
- EXE, 룰렛 엔진, 치지직 실시간 Socket.IO, OBS 서버: 방송 PC에서 계속 실행

## cPanel 설치 후

1. 도메인의 문서 루트가 `public_html`인지 확인합니다.
2. 무료 SSL 인증서가 발급되어 `https://sadoloverme.xyz/`가 경고 없이 열리는지 먼저 확인합니다.
3. 이 저장소의 `hosting/public_html` **안쪽 파일들**을 호스팅의 `public_html`에 업로드합니다.
4. `/health.json`이 `status: ok`로 열리는지 확인합니다.
5. `/chzzk/callback/`을 매개변수 없이 열었을 때 안전한 오류 안내가 보이는지 확인합니다.

## 치지직 콜백 시험 전 주의

현재 앱 기본값과 개발자센터 등록값은 기존 로컬 주소 `http://127.0.0.1:17554/oauth/callback`을 유지합니다. 호스팅 설치만으로 값을 바꾸지 마세요.

호스팅 콜백을 시험할 때만 다음을 같은 시점에 맞춥니다.

1. 치지직 개발자센터 로그인 리디렉션 URL: `https://sadoloverme.xyz/chzzk/callback/`
2. 앱 실행 환경: `ROULETTE_CHZZK_REDIRECT_URI=https://sadoloverme.xyz/chzzk/callback/`
3. 앱에서 연결 시작 후 웹 콜백 페이지의 `앱으로 돌아가기` 선택

요청 URL의 인증 코드는 웹서버 접근 로그에 짧게 남을 가능성이 있습니다. 콜백 PHP는 이를 DB나 파일에 별도 저장하지 않습니다. 시험 후 최종 방식으로 채택할지는 로컬 콜백과 안정성·보안을 비교해 결정합니다.
