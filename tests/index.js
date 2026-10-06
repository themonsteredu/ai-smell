/* `node --test tests/` 진입점.
   Node 22 는 `tests/` 를 폴더가 아니라 모듈 경로로 읽기 때문에, 이 파일이 폴더 안의
   *.test.js 를 모두 불러옵니다. 새 테스트는 이름만 xxx.test.js 로 만들면 자동으로 포함됩니다. */
const fs=require("fs"),path=require("path");
for(const f of fs.readdirSync(__dirname).sort())if(/\.test\.c?js$/.test(f))require(path.join(__dirname,f));
