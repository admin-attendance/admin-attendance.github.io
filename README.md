# HG Attendance Admin

GitHub Pages에서 바로 실행할 수 있는 관리자 웹 콘솔입니다.

## 포함 기능
- Firebase Google 관리자 로그인
- 관리자 권한(`admins/{uid}`) 확인
- 대시보드 실시간 집계
- 학교 추가/수정/활성화
- 반 조회/활성화/출석 인정 반경(150~1000m) 수정
- 선생님 조회/활성·비활성 처리
- 학생 학번/이름 수정, 활성·비활성, PIN 초기화 요청 플래그
- 전체 시스템 기본 출석반경/신규가입/유지보수 설정
- 관리자 변경 Audit Log
- 모바일 반응형 UI

## 1. Firebase 웹 앱 등록
Firebase Console > 프로젝트 설정 > 내 앱 > `웹(</>)` 앱 추가.
앱 이름 예: `HG Attendance Admin`.
Firebase가 보여주는 firebaseConfig 값을 `firebase-config.js`에 복사합니다.

## 2. Authentication
Firebase Console > Authentication > Sign-in method > Google 을 활성화합니다.

GitHub Pages 배포 후 Authentication > Settings > Authorized domains에 실제 Pages 도메인을 추가하세요.
예: `사용자명.github.io`

## 3. 첫 관리자 등록
1. 사이트에서 Google 로그인을 한 번 시도합니다.
2. 권한 없음 화면에 UID가 표시됩니다.
3. Firebase Console > Firestore > `admins` 컬렉션 생성
4. 문서 ID를 해당 UID로 지정
5. 필드 생성:
   - `active` : boolean = `true`
   - `role` : string = `super_admin`
   - `displayName` : string = 원하는 관리자 이름
6. 사이트에서 다시 로그인합니다.

## 4. GitHub Pages 배포
ZIP의 **내용물 전체**를 새 GitHub 저장소의 루트에 업로드합니다.

GitHub 저장소 > Settings > Pages:
- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/ (root)`

저장 후 Pages 주소가 생성됩니다.

## 5. Firestore Security Rules
현재 Firestore를 Test Mode로 사용 중이라면 개발 중에는 작동하지만 외부 접근이 열려 있을 수 있습니다.
실서비스 전에 이 폴더의 `firestore.rules`를 기준으로 규칙을 적용해야 합니다.

Firebase CLI를 사용할 경우 예:
```bash
firebase init firestore
# 프로젝트에서 firestore.rules 경로를 이 파일로 맞춘 뒤
firebase deploy --only firestore:rules
```

중요: 현재 rules는 **관리자 웹 영역을 보호하는 기본 규칙**입니다. 학생/교사용 앱을 연결할 때 TEACHER/STUDENT 역할별 세부 규칙을 합쳐야 하므로, 그대로 덮어쓰기 전에 기존 규칙과 통합하세요.

## Firestore 컬렉션 호환
관리자 사이트는 다음 구조를 사용합니다.
- `admins/{uid}`
- `schools/{schoolId}`
- `classes/{classId}`
- `teachers/{teacherUid}`
- `students/{studentUid}`
- `system/config`
- `auditLogs/{logId}`

현재 교사용 Flutter 앱의 `classes`와 `teachers` 문서 구조와 호환되도록 작성되어 있습니다.

## PIN 보안
관리자 사이트는 학생의 현재 PIN을 읽거나 표시하지 않습니다.
`PIN 초기화 요청`을 누르면 학생 문서에 다음만 기록합니다.
- `pinResetRequired: true`
- `pinResetRequestedAt: serverTimestamp()`

실제 PIN 검증/재설정은 이후 Cloud Functions 서버 측 인증으로 구현해야 합니다.
